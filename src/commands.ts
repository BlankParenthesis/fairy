import is = require("check-types");
import { 
	Constants, 
	Permissions, 
	CommandInteraction, 
	ApplicationCommandManager, 
	GuildApplicationCommandManager,
	ApplicationCommandOptionData,
	GuildMember,
	CommandInteractionOption,
	Message,
	APIMessage,
	Collection,
} from "discord.js";

const { ApplicationCommandOptionTypes } = Constants;

import Summary from "./summary";
import Server from "./server";

class Command {
	readonly name: string;
	readonly description: string;
	readonly options: ApplicationCommandOptionData[];
	private readonly executeFunction: (interaction: CommandInteraction, server: Server) => Promise<void>;
	readonly defaultPermission?: boolean;

	constructor(
		name: string, 
		description: string, 
		options: ApplicationCommandOptionData[], 
		execute: (interaction: CommandInteraction, server: Server) => Promise<void>, 
		defaultPermission?: boolean,
	) {
		this.name = name;
		this.description = description;
		this.options = options;
		this.executeFunction = execute;
		this.defaultPermission = defaultPermission;
	}

	async execute(interaction: CommandInteraction, server: Server) {
		await this.executeFunction(interaction, server);
	}

	async create(commandManager: ApplicationCommandManager | GuildApplicationCommandManager) {
		const { name, description, options, defaultPermission } = this;

		await commandManager.create({
			name, 
			description, 
			options, 
			defaultPermission,
		});
	}
}

const PRIVILEGED = [Permissions.FLAGS.MANAGE_GUILD, Permissions.FLAGS.ADMINISTRATOR];

const memberIsMod = (member: GuildMember) => member.permissions.has(PRIVILEGED);

const NON_GUILD_MEMBER_RESPONSE = "Commands must be used by a server member";
const LACKS_PERMISSIONS_RESPONSE = "“Manage Server” permission required";

const requireStringOption = (command: CommandInteractionOption, index = 0) => {
	if(is.undefined(command.options)) {
		throw new Error("Internal Discord command malformed");
	}
	if(!(command.options instanceof Collection)) {
		throw new Error("Internal Discord command format unknown");
	}

	const options = Array.from(command.options.values());
	if(!(index in options)) {
		throw new Error(`Internal invalid command index: ${index}`);
	}
	const option = options[index].value;
	if(!is.string(option)) {
		throw new Error("Internal Discord command malformed");
	}
	return option;
};

const parseTemplates = (input: string) => input.split(",").map(t => t.trim());
const parseSummary = (input: string, server: Server) => {
	let messageId = input;
	if(!/^[0-9]+$/.test(messageId)) {
		const match = messageId.match(/^https?:[/][/]discord[.]com[/]channels[/]([0-9]+)[/]([0-9]+)[/]([0-9]+)/);
		if(match === null) {
			throw new Error("Malformed message reference");
		}

		const [_, guild, _channel, message] = match;

		if(server.id !== guild) {
			throw new Error("Mismatched guild id in message reference");
		}

		messageId = message;
	}

	return server.findSummary(messageId);
};

export default new Map([
	new Command("template", "Manage templates tracked for this server.", [
		{
			"type": ApplicationCommandOptionTypes.SUB_COMMAND,
			"name": "add",
			"description": "Track a template.",
			"options": [
				{
					"type": ApplicationCommandOptionTypes.STRING,
					"name": "template-url",
					"description": "A template url.",
					"required": true,
				},
			],
		},
		{
			"type": ApplicationCommandOptionTypes.SUB_COMMAND,
			"name": "remove",
			"description": "Stop tracking a template",
			"options": [
				{
					"type": ApplicationCommandOptionTypes.STRING,
					"name": "template-name",
					"description": "A tracked template name.",
					"required": true,
				},
			],
		},
	], async (interaction, server) => {
		if(interaction.member === null) {
			throw new Error(NON_GUILD_MEMBER_RESPONSE);
		}
		
		if(!memberIsMod(interaction.member as GuildMember)) {
			await interaction.reply(LACKS_PERMISSIONS_RESPONSE);
			return;
		}

		const [subCommand] = interaction.options.values();

		if(subCommand.name === "add") {
			await interaction.defer();
			const url = requireStringOption(subCommand);
			const { name, template } = await server.createTemplate(url);
			await interaction.editReply(`Template “[${name}](${url})” added (${template.size} pixels).`);
		} else if(subCommand.name === "remove") {
			const search = requireStringOption(subCommand);
			const { name } = await server.removeTemplate(search);
			await interaction.reply(`Template “${name}” removed.`);
		} else {
			throw new Error(`Unexpected subcommand “${subCommand.name}”`);
		}
	}),
	new Command("summary", "Manage summaries of template progress", [
		{
			"type": ApplicationCommandOptionTypes.SUB_COMMAND,
			"name": "post",
			"description": "Post a summary here. Summaries show the progress of templates every minute.",
			"options": [
				{
					"type": ApplicationCommandOptionTypes.STRING,
					"name": "template-names",
					"description": "A list of template names. Separated by commas.",
					"required": true,
				},
			],
		},
		{
			"type": ApplicationCommandOptionTypes.SUB_COMMAND,
			"name": "edit",
			"description": "Change the templates shown in a summary.",
			"options": [
				{
					"type": ApplicationCommandOptionTypes.STRING,
					"name": "summary-message",
					"description": "The ID of the summary message or a link to it.",
					"required": true,
				},
				{
					"type": ApplicationCommandOptionTypes.STRING,
					"name": "template-names",
					"description": "A list of template names. Separated by commas.",
					"required": true,
				},
			],
		},
		{
			"type": ApplicationCommandOptionTypes.SUB_COMMAND,
			"name": "freeze",
			"description": "Stop updating a summary. This is not reversible.",
			"options": [
				{
					"type": ApplicationCommandOptionTypes.STRING,
					"name": "summary-message",
					"description": "The ID of the summary message or a link to it.",
					"required": true,
				},
			],
		},
	], async (interaction, server) => {
		if(interaction.member === null) {
			throw new Error(NON_GUILD_MEMBER_RESPONSE);
		}

		if(!memberIsMod(interaction.member as GuildMember)) {
			await interaction.reply(LACKS_PERMISSIONS_RESPONSE);
			return;
		}

		const [subCommand] = interaction.options.values();

		if(subCommand.name === "post") {
			const templatesInput = requireStringOption(subCommand);
			const templates = parseTemplates(templatesInput);

			const embed = Summary.embed(server, templates);

			await interaction.reply(embed);
			const message = await interaction.fetchReply();

			const castToMessage = (message: any): message is Message => message instanceof Message;

			if(!castToMessage(message)) {
				throw new Error("Internal assertion failed: reply message is of wrong type");
			}

			await server.addSummary(message, templates);
		} else if(subCommand.name === "edit") {
			const messageOption = requireStringOption(subCommand, 0);
			const templatesOption = requireStringOption(subCommand, 1);

			const summary = parseSummary(messageOption, server);

			if(!summary) {
				throw new Error("Provided message is not an active summary");
			}

			const templates = parseTemplates(templatesOption);

			await summary.modify(templates);

			await interaction.reply(
				`Summary will now show ${templates.map(t => `“${t}”`).join(", ")}.`,
				{ "ephemeral": true }
			);
		} else if(subCommand.name === "freeze") {
			const summaryId = requireStringOption(subCommand);
			const summary = parseSummary(summaryId, server);

			if(!summary) {
				throw new Error("Provided message is not an active summary");
			}

			await server.dropSummary(summary);

			interaction.reply("Summary will no longer update.", { "ephemeral": true });
		}
	}),
].map(c => [c.name, c]));
