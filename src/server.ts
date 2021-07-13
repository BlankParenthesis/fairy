import { promises as fs } from "fs";
import * as path from "path";
import { URL } from "url";

import { DiscordAPIError, Guild, Message, Constants } from "discord.js";
import { Pixel, Pxls } from "@blankparenthesis/pxlsspace";
import * as is from "check-types";

import Summary from "./summary";
import { 
	TrackableTemplate, 
	TrackedTemplate, 
	StylizedTemplateDesign, 
	TemplateDesign, 
	SavedTrackedTemplate,
} from "./template";

import { hashParams, escapeRegExp, hasTypedProperty, sum, parseIntOrDefault } from "./util";

// TODO: config option for space limit and summary limit
// 25 MB of memory space in major buffers
const SPACE_LIMIT = 25 * 10 ** 6;
// 100 seems like a reasonably amount that might actually get used.
// if it ends up being too stressful, look at optimizing template summary generation first.
export const SUMMARY_LIMIT = 5;

export default class ServerHandler {
	private pxls: Pxls;
	private guild: Guild;

	readonly templates: Map<string, TrackedTemplate> = new Map();
	summaries: Summary[] = [];

	private canvasCode?: string;

	private loadjob?: Promise<any>;
	private loadedonce = false;

	constructor(pxls: Pxls, guild: Guild) {
		this.pxls = pxls;
		this.guild = guild;

		this.pxls.on("sync", async ({ metadata }) => {
			await this.maybeReset(metadata.canvasCode);

			const templates = Array.from(this.templates.values())
				.map(t => t.template);

			for(const template of templates) {
				template.sync();
			}
		});
	}

	pixel(pixel: Pixel & { oldColor: number }) {
		const templates = Array.from(this.templates.values())
			.map(t => t.template);

		for(const template of templates) {
			const x = pixel.x - template.x;
			const y = pixel.y - template.x;

			if(x > 0 && x < template.width && y > 0 && y < template.height) { 
				const i = y * template.width + x;
				template.sync(new Map([[i, pixel]]));
			}
		}
	}

	async addSummary(message: Message, templates: string[]) {
		const totalSummarizations = this.summaries
			.map(s => s.size)
			.reduce(sum, 0);
		
		if(totalSummarizations + templates.length > SUMMARY_LIMIT) {
			throw new Error(
				"Server summary limit reached; " +
				`no more than ${SUMMARY_LIMIT} templates between all summaries ` +
				"(including duplicates)"
			);
		}

		this.summaries.push(new Summary(this, message, templates));
	}

	private forgetSummary(summary: Summary) {
		const index = this.summaries.indexOf(summary);
		if(index === -1) {
			throw new Error("Cannot drop unknown summary");
		}

		this.summaries.splice(index, 1);
	}

	async dropSummary(summary: Summary) {
		this.forgetSummary(summary);
		await summary.finalize();
	}

	async updateSummaries() {
		await Promise.all(this.summaries.map(async s => {
			try {
				await s.update();
			} catch(e) {
				if(e instanceof DiscordAPIError && [
					Constants.APIErrors.UNKNOWN_GUILD, // we don't expect this but just in case…
					Constants.APIErrors.UNKNOWN_CHANNEL, 
					Constants.APIErrors.UNKNOWN_MESSAGE, 
				].includes(e.code as any)) {
					console.debug(`Dropping summary whose message seems deleted: ${e.message}`);
					this.forgetSummary(s);
				} else {
					console.debug("Failed to update summary:", e);
				}
			}
		}));
	}

	async createTemplate(url: string) {
		const { title, template, ox, oy, tw } = hashParams(url);

		if(is.undefined(template)) {
			throw new Error("Missing template source");
		}

		if(is.undefined(title) || title.trim() === "") {
			throw new Error("Template requires a title");
		}

		let usedSpace = Array.from(this.templates.values())
			.map(t => t.template)
			.map(t => t.space)
			.reduce(sum, 0);

		const existingTemplate = this.templates.get(title);
		if(!is.undefined(existingTemplate)) {
			usedSpace = usedSpace - existingTemplate.template.space;
		}

		const source = new URL(template);
		const width = parseInt(tw) > 0 ? parseInt(tw) : undefined;

		const design = (await StylizedTemplateDesign.download(
			source,
			width,
			this.pxls.palette,
		)).unstylize();

		const trackable = new TrackableTemplate(
			this.pxls,
			design,
			parseIntOrDefault(ox, 0),
			parseIntOrDefault(oy, 0),
			Date.now(),
		);

		if(trackable.space + usedSpace > SPACE_LIMIT) {
			throw new Error(
				"Server memory limit reached — " +
				"use smaller templates if possible " +
				`(need ${trackable.space} bytes, used ${usedSpace} of ${SPACE_LIMIT} bytes)`
			);
		} 

		// TODO: use file hash for saved templates
		await design.save(
			path.resolve(this.templateDir, `${title}.png`),
			this.pxls.palette
		);

		const tracked = new TrackedTemplate(trackable, title, source);
		
		this.templates.set(title, tracked);

		return tracked;
	}

	async removeTemplate(search: string) {
		const result = this.findTemplate(search);

		if(result === null) {
			throw new Error(`Failed to find template “${search}”`);
		}

		const { name, template } = result;

		this.templates.delete(name);
		await this.cleanUnusedTemplateFiles();

		return template;
	}

	async load() {
		// all the shenanigans with loadjob is just so that we can ensure
		// that this server handler is loaded before use.
		if(is.undefined(this.loadjob)) {
			this.loadjob = (async () => {
				await this.ensureDirectories();

				if(!this.guild.available) {
					await this.guild.fetch();
					console.assert(this.guild.available);
				}

				let persistentData: unknown;
				try {
					persistentData = JSON.parse((await fs.readFile(this.persistentDataPath)).toString()) as unknown;
				} catch(e) {
					console.debug(e);
				}

				if(is.object(persistentData)) {
					const templates = (hasTypedProperty(persistentData, "templates", is.array))
						? persistentData.templates as unknown[]
						: (hasTypedProperty(persistentData, "templates", is.object))
							? Array.from(Object.entries(persistentData.templates)).map(([name, saved]) => {
								// convert from old format
								try {
									const template = { name } as Partial<SavedTrackedTemplate>; 

									if(!is.object(saved)) {
										throw new Error("template not an object");
									}

									if(hasTypedProperty(saved, "x", is.number)) {
										template.x = saved.x;
									} else {
										throw new Error("template has no x");
									}
		
									if(hasTypedProperty(saved, "y", is.number)) {
										template.y = saved.y;
									} else {
										throw new Error("template has no y");
									}
									
									if(hasTypedProperty(saved, "started", is.number)) {
										template.started = saved.started;
									}

									if(hasTypedProperty(saved, "history", is.object)) {
										template.history = {};

										if(hasTypedProperty(saved.history, "good", is.array)) {
											template.history.positive = saved.history.good;
										}

										if(hasTypedProperty(saved.history, "bad", is.array)) {
											template.history.negative = saved.history.bad;
										}

										if(hasTypedProperty(saved.history, "progress", is.number)) {
											template.progress = saved.history.progress;
										}
									
										if(hasTypedProperty(saved.history, "timestamp", is.number)) {
											template.history.timestamp = saved.history.timestamp;
										}
									}

									if(hasTypedProperty(saved, "source", is.string)) {
										template.source = new URL(saved.source);
									}

									return template;
								} catch(e) {
									console.warn("Failed to convert old template: ", e);
								}
							})
							: [];
					const summaries = (hasTypedProperty(persistentData, "summaries", is.array))
						? persistentData.summaries as unknown[]
						: [];

					this.canvasCode = hasTypedProperty(persistentData, "canvasCode", is.string)
						? persistentData.canvasCode
						: this.pxls.canvasCode;

					this.templates.clear();

					await Promise.all(templates.map(async data => {
						try {
							if(!is.object(data)) {
								throw new Error("saved template not an object");
							}

							const saved = data as Partial<SavedTrackedTemplate>;

							if(!hasTypedProperty(saved, "name", is.string)) {
								throw new Error("template has no name");
							}

							if(!hasTypedProperty(saved, "x", is.number)) {
								throw new Error("template has no x");
							}

							if(!hasTypedProperty(saved, "y", is.number)) {
								throw new Error("template has no y");
							}

							if(!hasTypedProperty(saved, "started", is.number)) {
								saved.started = Date.now();
							}

							if(!hasTypedProperty(saved, "progress", is.number)) {
								(saved as any).progress = undefined;
								// convince typescript that the above assignment happened
								if(!hasTypedProperty(saved, "progress", is.undefined)) {
									throw new Error("never");
								}
							}

							const trackable = new TrackableTemplate(
								this.pxls, 
								await TemplateDesign.load(
									path.resolve(this.templateDir, `${saved.name}.png`),
									this.pxls.palette,
								),
								saved.x,
								saved.y,
								saved.started as number,
								saved.history, 
								saved.progress, 
							);

							if(this.templates.has(saved.name)) {
								throw new Error("duplicate template definition");
							}

							const tracked = new TrackedTemplate(trackable, saved.name, saved.source);
		
							this.templates.set(tracked.name, tracked);
						} catch(e) {
							console.warn("Failed to load template: ", e);
						}
					}));

					this.summaries = (await Promise.all(
						summaries.map(s => Summary.from(this, this.guild, s))
					)).filter((s): s is Exclude<typeof s, null> => s !== null);

					await this.maybeReset(this.pxls.canvasCode);
				}

				await this.cleanUnusedTemplateFiles();

				this.loadjob = undefined;
				this.loadedonce = true;
			})();
		}

		await this.loadjob;
	}

	async save() {
		if(!this.loadedonce) {
			await this.load();
		}
		await fs.writeFile(this.persistentDataPath, JSON.stringify(this));
	}

	private async ensureDirectories() {
		await Promise.all([
			this.templateDir,
		].map(d => fs.mkdir(d, { "recursive": true })));
	}

	async ensureLoaded() {
		if(!this.loadedonce) {
			await this.load();
		}
	}

	async cleanUnusedTemplateFiles() {
		const files = await fs.readdir(this.templateDir);

		const templateNames = Array.from(this.templates.keys());
		const knownTemplatesRegExp = RegExp(`^(${templateNames.map(k => escapeRegExp(k)).join("|")}).png$`);

		const waywardFiles = files
			.filter(f => !knownTemplatesRegExp.test(f))
			.map(f => path.resolve(this.templateDir, f));

		await Promise.all(waywardFiles.map(f => fs.unlink(f)));
	}

	private async maybeReset(canvasCode: string) {
		if(is.undefined(this.canvasCode)) {
			this.canvasCode = canvasCode;
		}

		if(this.canvasCode !== canvasCode) {
			await this.reset();
			this.cleanUnusedTemplateFiles().catch(console.error);
			this.save().catch(console.error);
		}

		this.canvasCode = canvasCode;
	}

	async reset() {
		const summaries = this.summaries.splice(0);
		await Promise.all(summaries.map(s => s.finalize()));
		this.templates.clear();
	}

	get id() {
		return this.guild.id;
	}

	get baseDir() {
		return path.resolve(__dirname, "..", "data", this.id);
	}

	get templateDir() {
		return path.resolve(this.baseDir, "templates");
	}

	// TODO: replace the server directory with a `${id}.json` file
	get persistentDataPath() {
		return path.resolve(this.baseDir, "persistent.json");
	}

	toJSON() {
		return {
			"templates": Array.from(this.templates.values()),
			"summaries": this.summaries,
			"canvasCode": this.canvasCode,
		};
	}

	_findTemplateNameInString(s: string) {
		const matches = Array.from(this.templates.keys())
			.map(name => ({ "i": s.toLowerCase().indexOf(name.toLowerCase()), name }))
			.filter(e => e.i !== -1);
		return matches.length === 0
			? null
			: matches.reduce((e, l) => l.i < e.i ? l : l.i > e.i ? e : l.name.length > e.name.length ? l : e).name;
	}

	_findTemplateNameWithString(s: string) {
		const matches = Array.from(this.templates.keys())
			.map(name => ({ "i": name.toLowerCase().indexOf(s.toLowerCase()), name }))
			.filter(e => e.i !== -1);
		return matches.length === 0
			? null
			: matches.reduce((e, l) => l.i < e.i ? l : l.i > e.i ? e : l.name.length > e.name.length ? l : e).name;
	}

	findTemplate(searchString: string) {
		const name = this._findTemplateNameInString(searchString) || this._findTemplateNameWithString(searchString);

		if(name === null) {
			return null;
		}

		const template = this.templates.get(name);

		if(is.undefined(template)) {
			return null;
		}

		return { name, template };
	}

	findSummary(messageId: string) {
		return this.summaries.find(s => s.id === messageId);
	}
}
