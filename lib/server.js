const fs = require("fs").promises;
const path = require("path");

const Summary = require("./summary");
const Template = require("./template");

const { hashParams, escapeRegExp } = require("./util");

module.exports = class ServerHandler {
	constructor(pxls, guild) {
		this._pxls = pxls;
		this._guild = guild;
		this.templates = new Map();
		this.summaries = [];
		this.canvasCode = null;

		this._pxls.on("sync", ({ metadata }) => {
			const { canvasCode } = metadata;

			if(this.canvasCode === null) {
				this.canvasCode = canvasCode;
			}

			if(this.canvasCode !== canvasCode) {
				this.reset();
				this.cleanUnusedTemplateFiles().catch(console.error);
				this.save().catch(console.error);
			}

			this.canvasCode = canvasCode;
		});
	}

	pixel(x, y, color, oldColor) {
		for(const template of this.templates.values()) {
			const templateColor = template.at(x, y);
			if(templateColor === 255) return;

			if(templateColor === color) {
				template.goodPixel();
			} else if(oldColor === template.at(x, y)) {
				template.badPixel();
			}
		}
	}

	async addSummary(message, templates) {
		this.summaries.push(new Summary(this, message, templates));
	}

	_forgetSummary(summary) {
		const index = this.summaries.indexOf(summary);
		if(index === -1) {
			throw new Error("Cannot drop unknown summary");
		}

		this.summaries.splice(index, 1);
	}

	async dropSummary(summary) {
		this._forgetSummary(summary);
		await summary.finalize();
	}

	async updateSummaries() {
		await Promise.all(this.summaries.map(async s => {
			try {
				await s.update();
			} catch(e) {
				console.warn(`Dropping summary which failed to update: ${e.message}`);
				this._forgetSummary(s);
			}
		}));
	}

	async createTemplate(url) {
		const name = hashParams(url).get("title");

		if(!name) {
			throw new Error("Template requires a title");
		}

		const template = await Template.download(this._pxls, url);
		template.save(path.resolve(this.templateDir, `${name}.png`));
		this.templates.set(name, template);

		return { name, template };
	}

	async removeTemplate(search) {
		const { name, template } = this.findTemplate(search);

		if(name === null) {
			throw new Error(`Failed to find template “${search}”`);
		}

		this.templates.delete(name);
		await this.cleanUnusedTemplateFiles();

		return { name, template };
	}

	async load() {
		await this._ensureDirectories();

		if(!this._guild.available) {
			await this._guild.fetch();
			console.assert(this._guild.available);
		}

		let persistentData = {};
		try {
			persistentData = JSON.parse(await fs.readFile(this.persistentDataPath));
		} catch(e) {
			// ignored
		}

		const templates = persistentData.templates || {};
		const summaries = persistentData.summaries || [];
		this.canvasCode = "canvasCode" in persistentData ? persistentData.canvasCode : this._pxls.canvasCode;

		this.templates.clear();

		await Promise.all(templates.map(async (name, data) => {
			let template = null;

			try {
				template = await Template.from(this._pxls, name, this.templateDir, data);
			} catch(e) {
				console.warn("Failed to load template: ", e);
			}

			if(template === null) {
				return;
			}

			this.templates.set(name, template);
		}));

		await this.cleanUnusedTemplateFiles();

		this.summaries = (await Promise.all(summaries
			.map(s => Summary.from(this, this._guild, s))))
			.filter(s => s !== null);
	}

	async save() {
		await fs.writeFile(this.persistentDataPath, JSON.stringify(this.persistent));
	}

	async cleanUnusedTemplateFiles() {
		const files = await fs.readdir(this.templateDir);

		const knownTemplatesRegExp = RegExp(`^(${this.templates.mapKeys(k => escapeRegExp(k)).join("|")}).png$`);

		const waywardFiles = files
			.filter(f => !knownTemplatesRegExp.test(f))
			.map(f => path.resolve(this.templateDir, f));

		await Promise.all(waywardFiles.map(f => fs.unlink(f)));
	}

	reset() {
		this.templates.clear();
		this.summaries = [];
	}

	get id() {
		return this._guild.id;
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
			"templates": Object.fromEntries(this.templates.map((name, template) => [name, template.persistent])),
			"summaries": this.summaries.map(s => s.persistent),
			"canvasCode": this.canvasCode
		};
	}

	async _ensureDirectories() {
		await Promise.all([
			this.templateDir
		].map(d => fs.mkdir(d, { "recursive": true })));
	}

	_findTemplateNameInString(s) {
		const matches = this.templates
			.mapKeys(name => ({ "i": s.toLowerCase().indexOf(name.toLowerCase()), name }))
			.filter(e => e.i !== -1);
		return matches.length === 0 ? null : matches.reduce((e, l) => l.i < e.i ? l : l.i > e.i ? e : l.name.length > e.name.length ? l : e).name;
	}

	_findTemplateNameWithString(s) {
		const matches = this.templates
			.mapKeys(name => ({ "i": name.toLowerCase().indexOf(s.toLowerCase()), name }))
			.filter(e => e.i !== -1);
		return matches.length === 0 ? null : matches.reduce((e, l) => l.i < e.i ? l : l.i > e.i ? e : l.name.length > e.name.length ? l : e).name;
	}

	findTemplate(searchString) {
		const name = this._findTemplateNameInString(searchString) || this._findTemplateNameWithString(searchString);

		if(name === null) {
			return null;
		}

		return {
			name,
			"template": this.templates.get(name)
		};
	}

	findSummary(messageId) {
		return this.summaries.find(s => s.id === messageId);
	}
};
