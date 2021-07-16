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
	MessageSelectMenu,
	MessageActionRow,
	DMChannel,
	SelectMenuInteraction,
	Snowflake,
} from "discord.js";
import ExpiryMap from "expiry-map";

const { ApplicationCommandOptionTypes } = Constants;

import Summary from "./summary";
import { StylizedTemplateDesign, TemplateDesign, TrackableTemplate, TrackedTemplate } from "./template";
import { hashParams, parseIntOrDefault, sum, zip, humanTime, Interval } from "./util";
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

// 25 Megabytes
const SPACE_LIMIT = 25 * 10 ** 6;
const MAX_SUMMARIES = 10;

function selectFromSummaries(summaries: Summary[]) {
	return new MessageSelectMenu()
		.addOptions(summaries.map(summary => ({
			"label": `Summary ${summary.message.channel instanceof DMChannel
				? "here"
				: `in #${summary.message.channel.name.length > 13
					? `${summary.message.channel.name.slice(0, 12)}…`
					: summary.message.channel.name }`}`,
			"description": `Posted ${
				humanTime(Date.now() - summary.message.createdTimestamp).slice(0, 39)
			} ago`,
			"value": summary.message.id,
		})));
}

const queuedParams = new ExpiryMap<Snowflake, string[]>(Interval.MINUTE * 15);

async function editSummary(summaries: Summary[], editSummary: Summary, links: string[], state: State) {
	const templates = [];

	for(const link of links) {
		const template = await createTemplate(link, state);

		templates.push(template);
	}

	const allTemplates = [
		...templates.map(({ template }) => template), 
		...state.templates.filter(
			template => summaries
				// don't count the existing summary since it will be replaced
				.filter(summary => summary !== editSummary)
				.some(summary => summary.displays(template))
		),
	];

	const usedSpace = Array.from(new Set(allTemplates))
		.map(template => template.space)
		.reduce(sum, 0);
	
	if(usedSpace > SPACE_LIMIT) {
		throw new Error(
			"Memory limit reached — " +
			"use smaller templates if possible " +
			`(need ${usedSpace} bytes, limit is ${SPACE_LIMIT} bytes)`
		);
	} 

	await editSummary.modify(templates);

	return templates;
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
			"description": "Post a summary here.",
			"options": Array(20)
				.fill(null)
				.map((_, i) => TEMPLATE_LINK_OPTION(i + 1, i === 0)),
		},
		{
			"type": ApplicationCommandOptionTypes.SUB_COMMAND,
			"name": "edit",
			"description": "Change the templates shown in a summary…",
			"options": Array(20)
				.fill(null)
				.map((_, i) => TEMPLATE_LINK_OPTION(i + 1, i === 0)),
		},
		{
			"type": ApplicationCommandOptionTypes.SUB_COMMAND,
			"name": "freeze",
			"description": "Permanently stop updating a summary…",
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

		const summaries = state.summaries.filter(summary => {
			if(interaction.channel instanceof GuildChannel) {
				return interaction.channel.guild === summary.message.guild;
			} else {
				return summary.message.channel === interaction.channel;
			}
		});

		if(subCommand.name === "post") {
			await interaction.defer();

			if(summaries.length + 1 > MAX_SUMMARIES) {
				throw new Error("Max summaries reached, freeze some before posting any more");
			}

			const links = getLinks(subCommand);
			const templates = [];

			for(const link of links) {
				const template = await createTemplate(link, state);

				templates.push(template);
			}

			if(is.null(interaction.guild)) {
				await interaction.user.createDM();
			}

			const allTemplates = [
				...templates.map(({ template }) => template), 
				...state.templates.filter(
					template => summaries.some(
						summary => summary.displays(template)
					)
				),
			];

			const usedSpace = Array.from(new Set(allTemplates))
				.map(template => template.space)
				.reduce(sum, 0);
			
			if(usedSpace > SPACE_LIMIT) {
				throw new Error(
					"Memory limit reached — " +
					"use smaller templates if possible " +
					`(need ${usedSpace} bytes, limit is ${SPACE_LIMIT} bytes)`
				);
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
			const links = getLinks(subCommand);

			if(summaries.length === 0) {
				throw new Error("No active summaries to edit");
			} else if(summaries.length === 1) {
				await interaction.defer({ "ephemeral": true });

				const [summary] = summaries;
				const templates = await editSummary(summaries, summary, links, state);
				
				await interaction.editReply({
					"content": `Summary will now show ${templates.map(t => `“${t.inline}”`).join(", ")}.`,	
				});
			} else {
				queuedParams.set(interaction.id, links);

				await interaction.reply({
					"content": "Select the summary to edit",
					"components": [
						new MessageActionRow()
							.addComponents(selectFromSummaries(summaries)
								.setCustomId(`edit ${interaction.id}`)
							),
					],
					"ephemeral": true,
				});
			}
		} else if(subCommand.name === "freeze") {
			if(summaries.length === 0) {
				throw new Error("No active summaries to freeze");
			} else if(summaries.length === 1) {
				await interaction.defer({ "ephemeral": true });

				const [summary] = summaries;
				await summary.finalize();
				state.summaries.splice(state.summaries.indexOf(summary), 1);
		
				await interaction.editReply({
					"content": "Summary will no longer update.",
				});
			} else {
				await interaction.reply({
					"content": "Select the summary to freeze",
					"components": [
						new MessageActionRow()
							.addComponents(selectFromSummaries(summaries)
								.setCustomId("freeze")
							),
					],
					"ephemeral": true,
				});
			}
		}
	}),
].map(c => [c.name, c]));

// this flow being non-atomic is a little concerning — it requires non-trivial state
// tracking which can cause all manner of issues.
// One possible alternative is using guild-specific commands.
// this would allow for permissions-level control as well as providing the available
// options in the command itself. The cost would be losing DM support.
export async function handleSelectCallback(interaction: SelectMenuInteraction, state: State) {
	const summaries = state.summaries.filter(summary => {
		if(interaction.channel instanceof GuildChannel) {
			return interaction.channel.guild === summary.message.guild;
		} else {
			return summary.message.channel === interaction.channel;
		}
	});

	if(interaction.customId.startsWith("edit")) {
		await interaction.deferUpdate();
		const [_, id] = interaction.customId.split(" ");

		const links = queuedParams.get(id as Snowflake);

		if(is.undefined(links)) {
			console.debug(`Interaction ${interaction.id} had no queued params for ${id}`);
			return;
		}

		queuedParams.delete(id as Snowflake);

		const [summaryID] = interaction.values;
		const summary = summaries.find(summary => summary.id === summaryID);

		if(is.undefined(summary)) {
			throw new Error("Summary no longer exists");
		}

		const templates = await editSummary(summaries, summary, links, state);

		await interaction.editReply({
			"content": `Summary will now show ${templates.map(t => `“${t.inline}”`).join(", ")}.`,
			"components": [],
		});
	} else if(interaction.customId === "freeze") {
		await interaction.deferUpdate();

		const [summaryID] = interaction.values;
		const summary = summaries.find(summary => summary.id === summaryID);

		if(is.undefined(summary)) {
			throw new Error("Summary no longer exists");
		}

		await summary.finalize();
		state.summaries.splice(state.summaries.indexOf(summary), 1);

		await interaction.editReply({
			"content": "Summary will no longer update.",
			"components": [],
		});
	}
}
