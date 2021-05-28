const { MessageEmbed } = require("discord.js");

module.exports = class Summary {
	constructor(serverHandler, message, templates = []) {
		this._serverHandler = serverHandler;
		this._message = message;
		this._templates = templates;
	}

	static embed(serverHandler, templates) {
		const embedObject = new MessageEmbed();

		embedObject.setTitle("Template progress");
		embedObject.setDescription("");
		embedObject.setColor([179, 0, 0]); // Kaide`'s Reimu color ⛩
		embedObject.setTimestamp();
		embedObject.setFooter("updated every minute");

		templates.map(t => serverHandler.findTemplate(t))
			.filter(t => t !== null)
			.forEach(({ name, template }) => {
				embedObject.addField(name, template.summary, true);
			});

		return embedObject;
	}

	async update() {
		await this._message.edit(Summary.embed(this._serverHandler, this._templates));
	}

	static async create(serverHandler, channel, templates) {
		const message = await channel.send(Summary.embed(serverHandler, templates));

		return new Summary(serverHandler, message, templates);
	}

	static async from(serverHandler, guild, data) {
		const channel = guild.channels.cache.get(data.channel);
		if(!channel || !channel.messages) {
			console.warning(`Malformed channel for summary in guild ${guild.id}`);
			return null;
		}

		let message;
		try {
			message = await channel.messages.fetch(data.message);

			if(message === null) {
				console.warning(`Missing message for summary in guild ${guild.id}`);
				return null;
			}
		} catch(e) {
			console.warning(`Unable to fetch message for summary in guild ${guild.id}`);
			return null;
		}

		const { templates } = data;

		if(!(templates instanceof Array)) {
			console.warning(`Malformed template list for summary in guild ${guild.id}`);
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
