import * as path from "path";
import * as util from "util";

import { Client, Intents } from "discord.js";
import * as chalk from "chalk";
import { Pxls, BufferType } from "pxls";
import is = require("check-types");

import ServerHandler from "./server";
import Repl, { LogLevel } from "./repl";
import commands from "./commands";
import { Interval, hasProperty } from "./util";

import config from "./config";

const replServer = new Repl(config.loglevel);

// this is async, so it won't happen immediately
replServer.setupHistory();

console.log = (...s) => s.forEach(out => replServer.output(out, LogLevel.LOG));
console.info = (...s) => s.forEach(out => replServer.output(out, LogLevel.INFO));
console.error = (...s) => s.forEach(out => replServer.output(out, LogLevel.ERROR));
console.warn = (...s) => s.forEach(out => replServer.output(out, LogLevel.WARN));
console.debug = (...s) => s.forEach(out => replServer.output(out, LogLevel.DEBUG));

console.log(chalk.white("🧚 Please wait..."));

const fairy = new Client({ "intents": [
	Intents.FLAGS.GUILDS,
	Intents.FLAGS.GUILD_MEMBERS,
] });
const pxls = new Pxls({ "buffers": [BufferType.CANVAS, BufferType.PLACEMAP] });

pxls.on("error", e => console.error("Pxls error: ", e));

const SERVERS: Map<string, ServerHandler> = new Map();
const init = async () => {
	if(fairy.application === null) {
		throw new Error("https://www.youtube.com/watch?v=2-NRYjSpVAU");
	}

	const application = await fairy.application.fetch();
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
		const servers = fairy.guilds.cache.map(guild => new ServerHandler(pxls, guild));

		await Promise.all(servers.map(s => s.load()));

		for(const server of servers) {
			SERVERS.set(server.id, server);
		}

		const templates = servers.reduce((sum, server) => sum + server.templates.size, 0);
		console.info(`${chalk.blueBright(templates)} templates loaded`);
	} catch(e) {
		console.error("Failed to load template:", e);
	}
};

let first = true;
let discordUp = false;
let pxlsUp = false;
const set = (d: boolean, p: boolean) => {
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
};

fairy.on("ready", () => set(true, pxlsUp));
fairy.on("disconnect", () => set(false, pxlsUp));
fairy.on("error", () => set(false, pxlsUp));
if(!hasProperty(config, "token")) {
	throw new Error("Missing bot token in config");
}
if(!is.string(config.token)) {
	throw new Error("Invalid bot token in config");
}
fairy.login(config.token);

fairy.on("guildCreate", guild => {
	const server = new ServerHandler(pxls, guild);
	SERVERS.set(guild.id, server);
	return server.load();
});

fairy.on("guildDelete", guild => {
	const server = SERVERS.get(guild.id);
	if(server) {
		SERVERS.delete(guild.id);
		return server.save();
	}
});

fairy.on("interaction", async interaction => {
	// TODO: ratelimit users —
	// something like 50 templates every 10 minutes
	// and 500 templates a day
	if(interaction.isCommand()) {
		const command = commands.get(interaction.commandName);
		if(!is.undefined(command)) {
			if(interaction.guildID) {
				const server = SERVERS.get(interaction.guildID);

				try {
					if(server) {
						await command.execute(interaction, server);
					} else {
						throw new Error("Interaction in unknown server");
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
			} else {
				// TODO: support DMs
				interaction.reply("DMs are not supported at this time.");
			}
		}
	}
});

pxls.on("ready", () => set(discordUp, true));
pxls.on("disconnect", () => set(discordUp, false));
pxls.connect();

pxls.on("pixel", p => {
	const { x, y, color, oldColor } = p;
	for(const server of SERVERS.values()) {
		server.pixel(x, y, color, oldColor);
	}
});

const update = async () => {
	try {
		if(!pxlsUp) {
			return;
		}
		await Promise.all(Array.from(SERVERS.values()).map((server) => server.updateSummaries()));
	} catch(e) {
		console.error("Couldn't update all summaries:", e);
	}
};

const msUntilMinuteEpoch = (60 - (new Date()).getSeconds()) * 1000;
setTimeout(
	() => {
		setInterval(update, 60 * Interval.SECOND);
		update();
	},
	msUntilMinuteEpoch + 3 * Interval.SECOND
);

replServer.on("setupContext", context => {
	context.fairy = fairy;
	context.pxls = pxls;
	context.update = update;
	context.servers = SERVERS;
	context.commands = commands;
});

replServer.on("exit", async () => {
	await Promise.all(Array.from(SERVERS.values()).map((server) => server.save()));
	process.exit();
});
