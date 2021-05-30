const { Constants, Permissions } = require("discord.js");

const { ApplicationCommandOptionTypes } = Constants;

const Summary = require("./summary");

class Command {
	constructor(name, description, options, execute, defaultPermission) {
		this.name = name;
		this.description = description;
		this.options = options;
		this._execute = execute;
		this.defaultPermission = defaultPermission;
	}

	async execute(interaction, server) {
		await this._execute(interaction, server);
	}

	async create(commandManager) {
		const { name, description, options, defaultPermission } = this;

		await commandManager.create({
			name, description, options, defaultPermission
		});
	}
}

const PRIVILEGED = [Permissions.FLAGS.MANAGE_GUILD, Permissions.FLAGS.ADMINISTRATOR];

const memberIsMod = member => member.permissions.has(PRIVILEGED);

const LACKS_PERMISSIONS_RESPONSE = "“Manage Server” permission required.";

const parseTemplates = input => input.split(",").map(t => t.trim());
const parseSummary = (input, server) => {
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

module.exports = new Map([
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
					"required": true
				}
			]
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
					"required": true
				}
			]
		}
	], async (interaction, server) => {
		if(!memberIsMod(interaction.member)) {
			await interaction.reply(LACKS_PERMISSIONS_RESPONSE);
			return;
		}

		const [subCommand] = interaction.options;

		if(subCommand.name === "add") {
			await interaction.defer();
			const url = subCommand.options[0].value;
			const { name, template } = await server.createTemplate(url);
			await interaction.editReply(`Template “[${name}](${url})” added (${template.size} pixels).`);
		} else if(subCommand.name === "remove") {
			const { name } = await server.removeTemplate(subCommand.options[0].value);
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
					"required": true
				}
			]
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
					"required": true
				},
				{
					"type": ApplicationCommandOptionTypes.STRING,
					"name": "template-names",
					"description": "A list of template names. Separated by commas.",
					"required": true
				}
			]
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
					"required": true
				}
			]
		}
	], async (interaction, server) => {
		if(!memberIsMod(interaction.member)) {
			await interaction.reply(LACKS_PERMISSIONS_RESPONSE);
			return;
		}

		const [subCommand] = interaction.options;

		if(subCommand.name === "post") {
			const templates = parseTemplates(subCommand.options[0].value);

			const embed = Summary.embed(server, templates);

			await interaction.reply(embed);
			const message = await interaction.fetchReply();

			await server.addSummary(message, templates);
		} else if(subCommand.name === "edit") {
			const [messageOption, templatesOption] = subCommand.options;

			const summary = parseSummary(messageOption.value, server);

			if(!summary) {
				throw new Error("Provided message is not an active summary");
			}

			const templates = parseTemplates(templatesOption.value);

			await summary.modify(templates);

			await interaction.reply(`Summary will now show ${templates.map(t => `“${t}”`).join(", ")}.`, { "ephemeral": true });
		} else if(subCommand.name === "freeze") {
			const summary = parseSummary(subCommand.options[0].value, server);

			if(!summary) {
				throw new Error("Provided message is not an active summary");
			}

			await server.dropSummary(summary);

			interaction.reply("Summary will no longer update.", { "ephemeral": true });
		}
	})
].map(c => [c.name, c]));
