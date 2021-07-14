import { promises as fs } from "fs";
import { URL } from "url";
import * as path from "path";

import is = require("check-types");
import { 
	Constants, 
	Permissions, 
	CommandInteraction, 
	ApplicationCommand,
	ApplicationCommandManager, 
	GuildApplicationCommandManager,
	ApplicationCommandOptionData,
	ApplicationCommandOptionChoice,
	GuildMember,
	CommandInteractionOption,
	Message,
	Collection,
	GuildChannel,
	Channel,
} from "discord.js";

const { ApplicationCommandOptionTypes } = Constants;

import Summary from "./summary";
import { StylizedTemplateDesign, TemplateDesign, TrackableTemplate, TrackedTemplate } from "./template";
import { hashParams, parseIntOrDefault, zip } from "./util";
import Pxls from "@blankparenthesis/pxlsspace";

interface State {
	designs: Map<string, TemplateDesign>;
	templates: TrackableTemplate[];
	summaries: Summary[];
	pxls: Pxls;
}

type ExecuteFunction = (interaction: CommandInteraction, server: State) => Promise<void>;

class Command {
	constructor(
		readonly name: string, 
		readonly description: string, 
		readonly options: ApplicationCommandOptionData[], 
		private readonly executeFunction: ExecuteFunction, 
		readonly defaultPermission?: boolean,
	) {}

	async execute(interaction: CommandInteraction, state: State) {
		await this.executeFunction(interaction, state);
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

	static choicesAlike(as?: ApplicationCommandOptionChoice[], bs?: ApplicationCommandOptionChoice[]) {
		if(is.undefined(as) || is.undefined(bs)) {
			return as === bs;
		}

		if(as.length !== bs.length) {
			return false;
		}

		for(const [a, b] of zip(as, bs)) {
			const conditions = [
				a.name === b.name,
				a.value === b.value,
			];

			if(!conditions.every(_ => _)) {
				return false;
			}
		}

		return true;
	}

	static optionsAlike(as?: ApplicationCommandOptionData[], bs?: ApplicationCommandOptionData[]) {
		if(is.undefined(as) || is.undefined(bs)) {
			return as === bs;
		}

		if(as.length !== bs.length) {
			return false;
		}

		for(const [a, b] of zip(as, bs)) {
			const conditions = [
				// The type could be the key or the value part of the enum.
				// the type definition for discord.js assures me that ApplicationCommandOptionTypes
				// is ambient. In testing, it was not. Basically: 
				// FIXME: this could break later
				a.type === b.type || a.type === (Constants as any).ApplicationCommandOptionTypes[b.type],
				a.name === b.name,
				a.description === b.description,
				!a.required === !b.required,
				Command.choicesAlike(a.choices, b.choices),
				Command.optionsAlike(a.options, b.options),
			];

			if(!conditions.every(_ => _)) {
				return false;
			}
		}

		return true;
	}

	like(command: ApplicationCommand) {
		return this.name === command.name
			&& this.description === command.description
			&& Command.optionsAlike(this.options, command.options);
	}
}

const PRIVILEGED = [Permissions.FLAGS.MANAGE_GUILD, Permissions.FLAGS.ADMINISTRATOR];

function memberIsMod(member: GuildMember) {
	return member.permissions.has(PRIVILEGED);
}

const NON_GUILD_MEMBER_RESPONSE = "Commands must be used by a server member";
const LACKS_PERMISSIONS_RESPONSE = "“Manage Server” permission required";

function requireStringOption(command: CommandInteractionOption, index = 0) {
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
}

function getLinks(command: CommandInteractionOption, index = 0) {
	if(is.undefined(command.options)) {
		throw new Error("Internal Discord command malformed");
	}
	if(!(command.options instanceof Collection)) {
		throw new Error("Internal Discord command format unknown");
	}

	const first = requireStringOption(command, index).trim();
	const options = Array.from(command.options.values());
	const rest = options.slice(index + 1)
		.filter((option): option is typeof option & { value: string } => is.string(option.value))
		.map(option => option.value.trim());

	return [first, ...rest];
}

function parseMessageReference(input: string, channel: Channel) {
	if(/^[0-9]+$/.test(input)) {
		return input;
	} else {
		const match = input.match(/^https?:[/][/]discord[.]com[/]channels[/]([0-9]+)[/]([0-9]+)[/]([0-9]+)/);
		if(match === null) {
			throw new Error("Malformed message reference");
		}

		const [_, guild, _channel, message] = match;

		if(channel instanceof GuildChannel) {
			if(channel.guild.id !== guild) {
				throw new Error("Mismatched guild id in message reference");
			}
		}

		return message;
	}
}
// TODO: remove duplication with bot
const DATA_DIR = path.resolve(__dirname, "..", "data");
const DESIGN_FILE_EXTENSION = ".png";

async function createTemplate(url: string, state: State) {
	const { title, template, ox, oy, tw } = hashParams(url);

	if(is.undefined(template)) {
		throw new Error("Missing template source");
	}

	if(is.undefined(title) || title.trim() === "") {
		throw new Error("Template requires a title");
	}

	const source = new URL(template);
	const width = parseInt(tw) > 0 ? parseInt(tw) : undefined;

	let design = (await StylizedTemplateDesign.download(
		source,
		width,
		state.pxls.palette,
	)).unstylize();

	const { hash } = design;
	if(state.designs.has(hash)) {
		design = state.designs.get(hash) as TemplateDesign;
	} else {
		state.designs.set(hash, design);
		await fs.mkdir(
			path.resolve(DATA_DIR, "designs"),
			{ "recursive": true },
		);

		await design.save(
			path.resolve(DATA_DIR, "designs", `${hash}${DESIGN_FILE_EXTENSION}`),
			state.pxls.palette,
		);
	}

	let trackable = new TrackableTemplate(
		state.pxls,
		design,
		parseIntOrDefault(ox, 0),
		parseIntOrDefault(oy, 0),
		Date.now(),
	);

	const existingTrackable = state.templates.find(t => t.equals(trackable));
	if(!is.undefined(existingTrackable)) {
		trackable = existingTrackable;
	} else {
		state.templates.push(trackable);
	}

	return new TrackedTemplate(trackable, title, source);
}

function TEMPLATE_LINK_OPTION(index: number, required = false) {
	return {
		"type": ApplicationCommandOptionTypes.STRING,
		"name": `template-link-${index}`,
		"description": "A template link.",
		"required": required,
	};
}

export default new Map([
	// TODO: special summary entries for board buffers:
	/*

	heatmap:
	> **Activity**
	> x pixels per minute
	> y pixels per hour
	> z pixels per day
	
	virginmap:
	> **Original Pixels**
	> p% remaining
	> n of m pixels
	> 
	> -x pixels per minute
	> -y pixels per hour
	> -z pixels per day

	initial: use initial board as template

	placemap?:
	> Placeable pixels
	> p% of canvas
	> n of m pixels

	*/
	new Command("summary", "Manage summaries of template progress", [
		{
			"type": ApplicationCommandOptionTypes.SUB_COMMAND,
			"name": "post",
			"description": "Post a summary here. Summaries show the progress of templates every minute.",
			"options": Array(20).fill(null).map((_, i) => TEMPLATE_LINK_OPTION(i + 1, i === 0)),
		},
		{
			"type": ApplicationCommandOptionTypes.SUB_COMMAND,
			"name": "edit",
			"description": "Change the templates shown in a summary.",
			"options": [
				// TODO: use a message component select list for determining the summary
				{
					"type": ApplicationCommandOptionTypes.STRING,
					"name": "summary-message",
					"description": "The ID of the summary message or a link to it.",
					"required": true,
				},
				...Array(20).fill(null).map((_, i) => TEMPLATE_LINK_OPTION(i + 1, i === 0)),
			],
		},
		{
			"type": ApplicationCommandOptionTypes.SUB_COMMAND,
			"name": "freeze",
			"description": "Stop updating a summary. This is not reversible.",
			"options": [
				// TODO: use a message component select list for determining the summary
				{
					"type": ApplicationCommandOptionTypes.STRING,
					"name": "summary-message",
					"description": "The ID of the summary message or a link to it.",
					"required": true,
				},
			],
		},
	], async (interaction, state) => {
		if(interaction.member !== null) {
			if(!memberIsMod(interaction.member as GuildMember)) {
				await interaction.reply({
					"content": LACKS_PERMISSIONS_RESPONSE,
					"ephemeral": true,
				});
				return;
			}
		} else if(interaction.channel instanceof GuildChannel) {
			throw new Error(NON_GUILD_MEMBER_RESPONSE);
		}

		const [subCommand] = interaction.options.values();

		if(subCommand.name === "post") {
			await interaction.defer();

			/*
			let usedSpace = Array.from(this.templates.values())
				.map(t => t.template)
				.map(t => t.space)
				.reduce(sum, 0);

			const existingTemplate = this.templates.get(title);
			if(!is.undefined(existingTemplate)) {
				usedSpace = usedSpace - existingTemplate.template.space;
			}

			if(trackable.space + usedSpace > SPACE_LIMIT) {
				throw new Error(
					"Server memory limit reached — " +
					"use smaller templates if possible " +
					`(need ${trackable.space} bytes, used ${usedSpace} of ${SPACE_LIMIT} bytes)`
				);
			} 
			*/

			const links = getLinks(subCommand);
			const templates = [];

			for(const link of links) {
				const template = await createTemplate(link, state);

				templates.push(template);
			}

			if(interaction.guildID === null) {
				await interaction.user.createDM();
			}
			
			const message = await interaction.fetchReply();
			if(!(message instanceof Message)) {
				throw new Error("Internal error — interaction in unknown channel");
			}

			const summary = new Summary(templates, message);

			await interaction.editReply({
				"embeds": [summary.embed()],
			});

			state.summaries.push(summary);
		} else if(subCommand.name === "edit") {
			await interaction.defer({ "ephemeral": true });

			const messageOption = requireStringOption(subCommand, 0);
			const links = getLinks(subCommand, 1);

			const messageID = parseMessageReference(messageOption, interaction.channel);

			const summary = state.summaries.find(summary => summary.id === messageID);

			if(is.undefined(summary)) {
				throw new Error("Provided message is not an active summary");
			}

			const templates = [];

			for(const link of links) {
				const template = await createTemplate(link, state);

				templates.push(template);
			}

			await summary.modify(templates);

			await interaction.editReply({
				"content": `Summary will now show ${templates.map(t => `“${t.inline}”`).join(", ")}.`,
			});
		} else if(subCommand.name === "freeze") {
			await interaction.defer({ "ephemeral": true });

			const summaryId = requireStringOption(subCommand);
			const messageID = parseMessageReference(summaryId, interaction.channel);
			const summary = state.summaries.find(summary => summary.id === messageID);

			if(!summary) {
				throw new Error("Provided message is not an active summary");
			}

			await summary.finalize();

			state.summaries.splice(state.summaries.indexOf(summary), 1);

			interaction.editReply({
				"content": "Summary will no longer update.", 
			});
		}
	}),
].map(c => [c.name, c]));
