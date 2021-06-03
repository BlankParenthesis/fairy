import ServerHandler from "./server";
import { MessageEmbed, Message, Guild, TextChannel } from "discord.js";
import { isObject, hasProperty } from "./util";

export default class Summary {
	private readonly serverHandler: ServerHandler;
	private readonly message: Message;
	private templates: string[];

	constructor(serverHandler: ServerHandler, message: Message, templates: string[] = []) {
		this.serverHandler = serverHandler;
		this.message = message;
		this.templates = templates;
	}

	static embed(serverHandler: ServerHandler, templates: string[], final = false) {
		const embedObject = new MessageEmbed();

		embedObject.setTitle("Template progress");
		embedObject.setDescription("");
		embedObject.setColor([179, 0, 0]); // Kaide`'s Reimu color ⛩
		embedObject.setTimestamp();
		if(!final) {
			embedObject.setFooter("updated every minute");
		}

		templates.map(t => serverHandler.findTemplate(t))
			.filter((t): t is Exclude<typeof t, null> => t !== null)
			.forEach(({ name, template }) => {
				embedObject.addField(name, template.summary, true);
			});

		return embedObject;
	}

	get id() {
		return this.message.id;
	}

	async update(final = false) {
		await this.message.edit(Summary.embed(this.serverHandler, this.templates, final));
	}

	async modify(templates: string[]) {
		this.templates = templates;
		await this.update();
	}

	async finalize() {
		await this.update(true);
	}

	static async from(serverHandler: ServerHandler, guild: Guild, data: unknown) {
		if(!isObject(data)
			|| !hasProperty(data, "channel")
			|| !hasProperty(data, "message")
			|| !hasProperty(data, "templates")
		) {
			console.warn(`Malformed summary in guild ${guild.id}`);
			return null;
		}

		const channel = guild.channels.cache.get(data.channel as string);
		if(typeof channel === "undefined") {
			console.warn(`Malformed channel for summary in guild ${guild.id}`);
			return null;
		}

		if(!["text", "news"].includes(channel.type)) {
			console.warn(`Invalid channel for summary in guild ${guild.id}`);
			return null;
		}

		const textChannel = channel as TextChannel;

		let message;
		try {
			message = await textChannel.messages.fetch(data.message as string);

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
			"channel": this.message.channel.id,
			"message": this.message.id,
			"templates": this.templates
		};
	}
}
