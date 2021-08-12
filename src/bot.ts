import * as path from "path";
import * as util from "util";
import { promises as fs } from "fs";

import { Client, Constants, DiscordAPIError, DMChannel, Guild, Intents, Message, Snowflake, TextChannel } from "discord.js";
import * as chalk from "chalk";
import { Pxls, BufferType, TemplateDesign } from "@blankparenthesis/pxlsspace";
import is = require("check-types");
import { URL } from "url";

import Repl, { LogLevel } from "./repl";
import commands, { handleSelectCallback } from "./commands";
import config from "./config";
import { SavedTrackableTemplate, TrackableTemplate, TrackedTemplate } from "./template";
import Summary, { SavedSummary } from "./summary";
import { Interval, hasProperty, humanTime } from "./util";

const replServer = new Repl(config.loglevel);

// this is async, so it won't happen immediately
replServer.setupHistory();

console.log = (...s) => s.forEach(out => replServer.output(out, LogLevel.LOG));
console.info = (...s) => s.forEach(out => replServer.output(out, LogLevel.INFO));
console.error = (...s) => s.forEach(out => replServer.output(out, LogLevel.ERROR));
console.warn = (...s) => s.forEach(out => replServer.output(out, LogLevel.WARN));
console.debug = (...s) => s.forEach(out => replServer.output(out, LogLevel.DEBUG));

console.log(chalk.white("🧚 Please wait..."));

const discord = new Client({ "intents": [
	Intents.FLAGS.GUILDS,
	Intents.FLAGS.GUILD_MEMBERS,
] });
const pxls = new Pxls({ "buffers": [BufferType.CANVAS, BufferType.PLACEMAP] });

pxls.on("error", e => console.error("Pxls error: ", e));

const designs = new Map<string, TemplateDesign>();
const templates = [] as TrackableTemplate[];
const summaries = [] as Summary[];

const DATA_DIR = path.resolve(__dirname, "..", "data");
const DESIGN_FILE_EXTENSION = ".png";

async function init() {
	if(discord.application === null) {
		throw new Error("https://www.youtube.com/watch?v=2-NRYjSpVAU");
	}

	const application = await discord.application.fetch();
	await application.commands.fetch();
	await Promise.all(Array.from(commands.entries()).map(async ([name, command]) => {
		const applicationCommand = application.commands.cache.find(c => c.name === name);
		if(applicationCommand) {
			if(!command.like(applicationCommand)) {
				await applicationCommand.delete();
				await command.create(application.commands);
				console.debug(`Updated command “${name}”`);
			}
		} else {
			try {
				await command.create(application.commands);
			} catch(e) {
				console.error("Failed to create command:", e);
			}
		}
	}));

	try {
		const designFiles = await fs.readdir(path.resolve(DATA_DIR, "designs"));

		const designPromises = designFiles
			.filter(filename => filename.endsWith(DESIGN_FILE_EXTENSION))
			.map(filename => path.resolve(DATA_DIR, "designs", filename))
			.map(filepath => TemplateDesign.fromFile(filepath, pxls.palette));

		for(const design of await Promise.allSettled(designPromises)) {
			if(design.status === "fulfilled") {
				designs.set(design.value.hash, design.value);
			} else {
				console.warn("Failed to load template design:", design.reason);
			}
		}
	} catch(e) {
		console.debug("Failed to load template designs: ", e);
	}

	try {
		const templatesFileBuffer = await fs.readFile(path.resolve(DATA_DIR, "templates.json"));
		const templatesData = JSON.parse(templatesFileBuffer.toString("utf-8")) as unknown;

		if(!is.array(templatesData)) {
			throw new Error("expected templates root object to be array");
		}

		for(const template of templatesData as SavedTrackableTemplate[]) {
			try {
				const design = designs.get(template.design);

				if(is.undefined(design)) {
					throw new Error(`missing design “${template.design}”`);
				}

				templates.push(new TrackableTemplate(
					pxls,
					design,
					template.x,
					template.y,
					template.started,
					template.history,
					template.progress,
				));
			} catch(e) {
				console.warn("Failed to load template:", e);
			}
		}
	} catch(e) {
		console.debug("Failed to load templates:", e);
	}

	try {
		const summariesFileBuffer = await fs.readFile(path.resolve(DATA_DIR, "summaries.json"));
		const summariesData = JSON.parse(summariesFileBuffer.toString("utf-8")) as unknown;

		if(!is.array(summariesData)) {
			throw new Error("expected summaries root object to be array");
		}

		for(const summary of summariesData as SavedSummary[]) {
			try {
				const fields = summary.fields.map(field => {
					const template = templates.find(template => {
						const { x, y, design } = field.template;
						return template.x === x
							&& template.y === y
							&& template.design.hash === design;
					});

					if(is.undefined(template)) {
						console.warn(`missing template: ${util.inspect(field)}`);
						return undefined;
					}

					return new TrackedTemplate(
						template,
						field.name,
						is.undefined(field.source) ? undefined : new URL(field.source),
					);
				}).filter((template): template is Exclude<typeof template, undefined> => !is.undefined(template));

				const channel = await discord.channels.fetch(summary.channel);

				if(is.null(channel)) {
					throw new Error("channel was null");
				}

				if(!(channel instanceof TextChannel) && !(channel instanceof DMChannel)) {
					throw new Error("channel does not support messages");
				}

				const message = await channel.messages.fetch(summary.message);

				summaries.push(new Summary(
					fields,
					message,
				));
			} catch(e) {
				console.warn("Failed to load summary:", e);
			}
		}
	} catch(e) {
		console.debug("Failed to load summaries:", e);
	}
}

let first = true;
let discordUp = false;
let pxlsUp = false;
function set(d: boolean, p: boolean) {
	const bad = (!d || !p) && discordUp && pxlsUp;

	if(d !== discordUp) {
		if(d) {
			console.log(`✅ ${chalk.blueBright("Discord")} ${chalk.green("up")}`);
		} else {
			console.log(`❌ ${chalk.blueBright("Discord")} ${chalk.redBright("down")}`);
		}
	}

	if(p !== pxlsUp) {
		if(p) {
			console.log(`✅ ${chalk.yellow("Pxls")} ${chalk.green("up")}`);
		} else {
			console.log(`❌ ${chalk.yellow("Pxls")} ${chalk.redBright("down")}`);
		}
	}

	discordUp = d;
	pxlsUp = p;

	if(discordUp && pxlsUp) {
		if(first) {
			first = false;
			console.log("☺  Preparations complete");
			init();
		} else {
			console.log("😘 We're back up");
		}
	} else if(bad) {
		console.log("😣 We're down");
	}
}

discord.on("ready", () => set(true, pxlsUp));
discord.on("disconnect", () => set(false, pxlsUp));
discord.on("error", () => set(false, pxlsUp));
if(!hasProperty(config, "token")) {
	throw new Error("Missing bot token in config");
}
if(!is.string(config.token)) {
	throw new Error("Invalid bot token in config");
}
discord.login(config.token);

class Limiter<T> {
	private storedUses: Map<T, number> = new Map();

	readonly limit: number;
	readonly interval: number; 

	constructor(limit: number, interval: number) {
		this.limit = limit;
		this.interval = interval;

		setTimeout(() => {
			this.refresh();
			setInterval(
				() => this.refresh(), 
				this.interval
			);
		}, this.timeUntilRefresh);
	}

	private refresh() {
		this.storedUses.clear();
	}

	private uses(user: T) {
		let uses = this.storedUses.get(user);

		if(is.undefined(uses)) {
			uses = 0;
		}

		return uses;
	}

	canUse(user: T) {
		return this.uses(user) < this.limit;
	}

	use(user: T) {
		this.storedUses.set(user, this.uses(user) + 1);
	}

	get timeUntilRefresh() {
		return this.interval - Date.now() % this.interval;
	}
}

const userLimiters: Limiter<Snowflake>[] = config.interaction.limiter.user.map(l => 
	new Limiter(l.limit, l.interval)
);

const serverLimiters: Limiter<Snowflake>[] = config.interaction.limiter.server.map(l => 
	new Limiter(l.limit, l.interval)
);

discord.on("interactionCreate", async interaction => {
	if(interaction.isCommand()) {
		const command = commands.get(interaction.commandName);
		if(!is.undefined(command)) {
			const userId = interaction.user.id;

			const limitedUserLimiter = userLimiters.find(l => !l.canUse(userId));

			if(!is.undefined(limitedUserLimiter)) {
				const readableCooldown = humanTime(limitedUserLimiter.timeUntilRefresh);

				await interaction.reply({
					"content": "You've use too many of my commands recently; "
						+ `wait ${readableCooldown} before trying again.`,
					"ephemeral": true,
				});
				return;
			}

			userLimiters.forEach(l => l.use(userId));

			if(!is.null(interaction.guild)) {
				const limitedServerLimiter = serverLimiters.find(
					limiter => !limiter.canUse((interaction.guild as Guild).id as Snowflake)
				);

				if(!is.undefined(limitedServerLimiter)) {
					const readableCooldown = humanTime(limitedServerLimiter.timeUntilRefresh);
	
					await interaction.reply({
						"content": "Too many of my commands have been used in this server recently; "
							+ `wait ${readableCooldown} before trying again.`,
						"ephemeral": true,
					});
					return;
				}
			}

			try {
				await command.execute(interaction, { designs, templates, summaries, pxls });

				if(!is.null(interaction.guild)) {
					serverLimiters.forEach(
						limiter => limiter.use((interaction.guild as Guild).id as Snowflake));
				}
			} catch(e) {
				const errorResponse = `Problem: ${e.message}.`;

				console.debug(e);

				if(interaction.replied || interaction.deferred) {
					await interaction.editReply(errorResponse);
				} else {
					await interaction.reply({
						"content": errorResponse,
						"ephemeral": true,
					});
				}
			}
		}
	} else if(interaction.isSelectMenu()) {
		try {
			await handleSelectCallback(interaction, { designs, templates, summaries, pxls });
		} catch(e) {
			console.debug(e);
			await interaction.update({
				"content": `Problem: ${e.message}.`,
				"components": [],
			});
		}
	}
});

pxls.on("ready", () => set(discordUp, true));
pxls.on("disconnect", () => set(discordUp, false));
pxls.connect();

pxls.on("pixel", pixel => {
	if(is.undefined(pixel.oldColor)) {
		console.warn("Missing old color data for pixel: ", pixel);
	} else {
		for(const template of templates) {
			const x = pixel.x - template.x;
			const y = pixel.y - template.y;

			if(x > 0 && x < template.width && y > 0 && y < template.height) { 
				const i = template.design.positionToIndex(x, y);
				template.sync(new Map([[i, pixel as Required<typeof pixel>]]));
			}
		}
	}
});

async function pruneUnused() {
	// TODO: require that items go unused for two cycles before pruning
	const unusedTemplates = templates.filter(
		template => !summaries.some(
			summary => summary.displays(template)
		)
	);
	for(const template of unusedTemplates) {
		console.debug("Dropping template which is no longer used anywhere");
		templates.splice(templates.indexOf(template), 1);
	}

	for(const hash of designs.keys()) {
		if(!templates.some(template => template.design.hash === hash)) {
			console.debug("Dropping design which is no longer used anywhere");
			designs.delete(hash);
		}
	}

	try {
		const files = (await fs.readdir(path.resolve(DATA_DIR, "designs")))
			.filter(filename => filename.endsWith(DESIGN_FILE_EXTENSION));
		const strayFiles = files.filter(file => !designs.has(file.slice(0, -DESIGN_FILE_EXTENSION.length)));
		const deletions = strayFiles.map(file => path.resolve(DATA_DIR, "designs", file))
			.map(path => fs.unlink(path));

		// FIXME: if we add a new design while awaiting here, it will immediately be deleted,
		// causing a file not found error on next startup. Timing problems like this are hard to fix…
		for(const deletion of await Promise.allSettled(deletions)) {
			if(deletion.status === "rejected") {
				console.warn("Failed to delete template design:", deletion.reason);
			}
		}
	} catch(e) {
		console.debug("Failed to prune design files: ", e);
	}
}
setInterval(pruneUnused, 15 * Interval.MINUTE);

async function update() {
	if(pxlsUp) {
		const promises = summaries.map(summary => summary.update());
		const failures = (await Promise.allSettled(promises))
			.map((status, i) => ({ status, "summary": summaries[i] }))
			.filter((result): result is typeof result & {
				status: PromiseRejectedResult;
			} => result.status.status === "rejected");

		for(const { status, summary } of failures) {
			if(status.reason instanceof DiscordAPIError && [
				Constants.APIErrors.UNKNOWN_GUILD,
				Constants.APIErrors.UNKNOWN_CHANNEL, 
				Constants.APIErrors.UNKNOWN_MESSAGE, 
			].includes(status.reason.code as any)) {
				console.debug(`Dropping summary whose message seems deleted or unreachable: ${status.reason.message}`);
				summaries.splice(summaries.indexOf(summary), 1);
			} else {
				console.warn("Failed to update summary: ", status.reason);
			}
		}
	}
}

const msUntilMinuteEpoch = (60 - (new Date()).getSeconds()) * 1000;
setTimeout(
	() => {
		setInterval(update, Interval.MINUTE);
		update();
	},
	msUntilMinuteEpoch + 3 * Interval.SECOND
);

replServer.on("setupContext", context => {
	context.discord = discord;
	context.pxls = pxls;
	context.update = update;
	context.pruneUnused = pruneUnused;
	context.designs = designs;
	context.templates = templates;
	context.summaries = summaries;
	context.commands = commands;
});

replServer.on("exit", async () => {
	await fs.writeFile(path.resolve(DATA_DIR, "summaries.json"), JSON.stringify(summaries));
	await fs.writeFile(path.resolve(DATA_DIR, "templates.json"), JSON.stringify(templates));

	process.exit();
});
