const { MessageEmbed } = require("discord.js");

module.exports = class Summary {
	constructor(serverHandler, message, templates = []) {
		this._serverHandler = serverHandler;
		this._message = message;
		this._templates = templates;
	}

	static embed(serverHandler, templates, final = false) {
		const embedObject = new MessageEmbed();

		embedObject.setTitle("Template progress");
		embedObject.setDescription("");
		embedObject.setColor([179, 0, 0]); // Kaide`'s Reimu color ⛩
		embedObject.setTimestamp();
		if(!final) {
			embedObject.setFooter("updated every minute");
		}

		templates.map(t => serverHandler.findTemplate(t))
			.filter(t => t !== null)
			.forEach(({ name, template }) => {
				embedObject.addField(name, template.summary, true);
			});

		return embedObject;
	}

	get id() {
		return this._message.id;
	}

	async update(final = false) {
		await this._message.edit(Summary.embed(this._serverHandler, this._templates, final));
	}

	async modify(templates) {
		this._templates = templates;
		await this.update();
	}

	async finalize() {
		await this.update(true);
	}

	static async from(serverHandler, guild, data) {
		const channel = guild.channels.cache.get(data.channel);
		if(!channel || !channel.messages) {
			console.warn(`Malformed channel for summary in guild ${guild.id}`);
			return null;
		}

		let message;
		try {
			message = await channel.messages.fetch(data.message);

			if(message === null) {
				console.warn(`Missing message for summary in guild ${guild.id}`);
				return null;
			}
		} catch(e) {
			console.warn(`Unable to fetch message for summary in guild ${guild.id}`);
			return null;
		}

		const { templates } = data;

		if(!(templates instanceof Array)) {
			console.warn(`Malformed template list for summary in guild ${guild.id}`);
			return null;
		}

		return new Summary(serverHandler, message, templates.filter(s => typeof s === "string"));
	}

	get persistent() {
		return {
			"channel": this._message.channel.id,
			"message": this._message.id,
			"templates": this._templates
		};
	}
};
