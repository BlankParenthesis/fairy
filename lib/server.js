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

	async postSummary(channel, templates) {
		this.summaries.push(await Summary.create(this, channel, templates));
	}

	async updateSummaries() {
		await Promise.all(this.summaries.map(s => s.update()));
	}

	async createTemplate(url) {
		const { title } = hashParams(url);

		if(!title) {
			throw new Error("Template requires a title");
		}

		const template = await Template.download(this._pxls, url);
		template.save(path.resolve(this.templateDir, `${title}.png`));
		this.templates.set(title, template);
	}

	async load() {
		await this._ensureDirectories();
		let persistentData = {};
		try {
			persistentData = JSON.parse(await fs.readFile(this.persistentDataPath));
		} catch(e) {
			// ignored
		}

		const templates = persistentData.templates || {};
		const summaries = persistentData.summaries || [];

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

		const files = await fs.readdir(this.templateDir);

		const knownTemplatesRegExp = RegExp(`^(${this.templates.mapKeys(k => escapeRegExp(k)).join("|")}).png$`);

		const waywardFiles = files
			.filter(f => !knownTemplatesRegExp.test(f))
			.map(f => path.resolve(this.templateDir, f));

		await Promise.all(waywardFiles.map(f => fs.unlink(f)));

		this.summaries = (await Promise.all(summaries
			.map(s => Summary.from(this, this._guild, s))))
			.filter(s => s !== null);
	}

	async save() {
		await fs.writeFile(this.persistentDataPath, JSON.stringify(this.persistent));
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
			"summaries": this.summaries.map(s => s.persistent)
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
};
