import { promises as fs } from "fs";
import * as path from "path";

import { DiscordAPIError, Guild, Message, Constants } from "discord.js";
import { Pxls, TRANSPARENT_PIXEL } from "@blankparenthesis/pxlsspace";
import * as is from "check-types";

import Summary from "./summary";
import Template from "./template";

import { hashParams, escapeRegExp, hasProperty, sum } from "./util";

// TODO: config option for space limit and summary limit
// 25 MB of memory space in major buffers
const SPACE_LIMIT = 25 * 10 ** 6;
// 100 seems like a reasonably amount that might actually get used.
// if it ends up being too stressful, look at optimizing template summary generation first.
export const SUMMARY_LIMIT = 5;

export default class ServerHandler {
	private pxls: Pxls;
	private guild: Guild;

	readonly templates: Map<string, Template> = new Map();
	summaries: Summary[] = [];

	private canvasCode?: string;

	private loadjob?: Promise<any>;
	private loadedonce = false;

	constructor(pxls: Pxls, guild: Guild) {
		this.pxls = pxls;
		this.guild = guild;

		this.pxls.on("sync", async ({ metadata }) => {
			await this.maybeReset(metadata.canvasCode);

			for(const template of this.templates.values()) {
				template.sync();
			}
		});
	}

	pixel(x: number, y: number, color: number, oldColor?: number) {
		for(const template of this.templates.values()) {
			const templateColor = template.at(x, y);
			if(templateColor === TRANSPARENT_PIXEL) {
				continue;
			}

			if(templateColor === color) {
				template.goodPixel();
			} else if(oldColor === template.at(x, y)) {
				template.badPixel();
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
					console.debug(`Failed to update summary: ${e.message}`);
				}
			}
		}));
	}

	async createTemplate(url: string) {
		const name = hashParams(url).get("title");

		if(!name) {
			throw new Error("Template requires a title");
		}

		let usedSpace = Array.from(this.templates.values())
			.map(t => t.space)
			.reduce(sum, 0);

		const existingTemplate = this.templates.get(name);
		if(!is.undefined(existingTemplate)) {
			usedSpace = usedSpace - existingTemplate.space;
		}

		const template = await Template.download(this.pxls, url);

		if(template.space + usedSpace > SPACE_LIMIT) {
			throw new Error(
				"Server memory limit reached — " +
				"use smaller templates if possible " +
				`(need ${template.space} bytes, used ${usedSpace} of ${SPACE_LIMIT} bytes)`
			);
		} 

		// TODO: use file hash for saved templates
		await template.save(path.resolve(this.templateDir, `${name}.png`));
		this.templates.set(name, template);

		return { name, template };
	}

	async removeTemplate(search: string) {
		const result = this.findTemplate(search);

		if(result === null) {
			throw new Error(`Failed to find template “${search}”`);
		}

		const { name, template } = result;

		this.templates.delete(name);
		await this.cleanUnusedTemplateFiles();

		return { name, template };
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
					// ignored
				}

				if(is.object(persistentData)) {
					const templates = (hasProperty(persistentData, "templates")
							&& is.object(persistentData.templates))
						? persistentData.templates
						: {};
					const summaries = (hasProperty(persistentData, "summaries")
							&& Array.isArray(persistentData.summaries))
						? persistentData.summaries as unknown[]
						: [];

					this.canvasCode = hasProperty(persistentData, "canvasCode")
							&& is.string(persistentData.canvasCode)
						? persistentData.canvasCode
						: this.pxls.canvasCode;

					this.templates.clear();

					await Promise.all(Object.entries(templates).map(async ([name, data]) => {
						let template = null;

						try {
							template = await Template.from(this.pxls, name, this.templateDir, data);
						} catch(e) {
							console.warn("Failed to load template: ", e);
						}

						if(template === null) {
							return;
						}

						this.templates.set(name, template);
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
		await fs.writeFile(this.persistentDataPath, JSON.stringify(this.persistent));
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

	get persistent() {
		return {
			"templates": Object.fromEntries(Array.from(this.templates.entries())
				.map(([name, template]) => [name, template.persistent])),
			"summaries": this.summaries.map(s => s.persistent),
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
