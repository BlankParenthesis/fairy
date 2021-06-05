import { promises as fs } from "fs";
import * as path from "path";

import { DiscordAPIError, Guild, Message, Constants } from "discord.js";
import Pxls = require("pxls");

import Summary from "./summary";
import Template from "./template";

import { hashParams, escapeRegExp, isObject, hasProperty, isUndefined, isString } from "./util";

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
			const { canvasCode } = metadata;

			if(isUndefined(this.canvasCode)) {
				this.canvasCode = canvasCode;
			}

			if(this.canvasCode !== canvasCode) {
				await this.reset();
				this.cleanUnusedTemplateFiles().catch(console.error);
				this.save().catch(console.error);
			}

			for(const template of this.templates.values()) {
				template.sync();
			}

			this.canvasCode = canvasCode;
		});
	}

	pixel(x: number, y: number, color: number, oldColor: number) {
		for(const template of this.templates.values()) {
			const templateColor = template.at(x, y);
			if(templateColor === Template.transparentPixel) {
				return;
			}

			if(templateColor === color) {
				template.goodPixel();
			} else if(oldColor === template.at(x, y)) {
				template.badPixel();
			}
		}
	}

	async addSummary(message: Message, templates: string[]) {
		this.summaries.push(new Summary(this, message, templates));
	}

	_forgetSummary(summary: Summary) {
		const index = this.summaries.indexOf(summary);
		if(index === -1) {
			throw new Error("Cannot drop unknown summary");
		}

		this.summaries.splice(index, 1);
	}

	async dropSummary(summary: Summary) {
		this._forgetSummary(summary);
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
					this._forgetSummary(s);
				}
			}
		}));
	}

	async createTemplate(url: string) {
		const name = hashParams(url).get("title");

		if(!name) {
			throw new Error("Template requires a title");
		}

		const template = await Template.download(this.pxls, url);
		template.save(path.resolve(this.templateDir, `${name}.png`));
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
		if(isUndefined(this.loadjob)) {
			this.loadjob = (async () => {
				await this._ensureDirectories();

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

				if(isObject(persistentData)) {
					const templates = (hasProperty(persistentData, "templates")
							&& isObject(persistentData.templates))
						? persistentData.templates
						: {};
					const summaries = (hasProperty(persistentData, "summaries")
							&& Array.isArray(persistentData.summaries))
						? persistentData.summaries as unknown[]
						: [];

					this.canvasCode = hasProperty(persistentData, "canvasCode")
							&& isString(persistentData.canvasCode)
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

	async _ensureDirectories() {
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

	async reset() {
		this.templates.clear();
		const summaries = this.summaries.splice(0);
		await Promise.all(summaries.map(s => s.finalize()));
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

		if(isUndefined(template)) {
			return null;
		}

		return { name, template };
	}

	findSummary(messageId: string) {
		return this.summaries.find(s => s.id === messageId);
	}
}
