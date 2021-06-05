import * as path from "path";
import * as util from "util";

import { Client, Intents } from "discord.js";
import * as chalk from "chalk";
import Pxls = require("pxls");

import ServerHandler from "./server";
import Repl from "./repl";
import commands from "./commands";

import { Interval, isUndefined, isString, isNumber } from "./util";

/* eslint-disable-next-line @typescript-eslint/no-var-requires */
const config = require(path.resolve(__dirname, "..", "config.json"));

enum LogLevel {
	LOG = 0,
	INFO = 1,
	ERROR = 2,
	WARN = 3,
	DEBUG = 4,
}

const loglevel: LogLevel = isNumber(config.loglevel)
	? config.loglevel
	: LogLevel[config.loglevel.toString().toUpperCase()];

const replServer = new Repl(loglevel);

// this is async, so it won't happen immediately
replServer.setupHistory();

console.log = (...s) => loglevel >= LogLevel.LOG ? s.forEach(o => replServer.output(isString(o) ? o : util.inspect(o))) : null;
console.info = (...s) => loglevel >= LogLevel.INFO ? s.forEach(o => replServer.output(`ℹ ${isString(o) ? o : util.inspect(o)}`, chalk.white)) : null;
console.error = (...s) => loglevel >= LogLevel.ERROR ? s.forEach(o => replServer.output(`🚫 ${isString(o) ? o : util.inspect(o)}`, chalk.redBright)) : null;
console.warn = (...s) => loglevel >= LogLevel.WARN ? s.forEach(o => replServer.output(`⚠  ${isString(o) ? o : util.inspect(o)}`, chalk.yellow)) : null;
console.debug = (...s) => loglevel >= LogLevel.DEBUG ? s.forEach(o => replServer.output(`🐛 ${isString(o) ? o : util.inspect(o)}`, chalk.gray)) : null;

console.log(chalk.white("🧚 Please wait..."));

const fairy = new Client({ "intents": [
	Intents.FLAGS.GUILDS,
	Intents.FLAGS.GUILD_MEMBERS,
] });
const pxls = new Pxls();

const SERVERS: Map<string, ServerHandler> = new Map();
const init = async () => {
	if(fairy.application === null) {
		throw new Error("https://www.youtube.com/watch?v=2-NRYjSpVAU");
	}

	const application = await fairy.application.fetch();
	await Promise.all(Array.from(commands.entries()).map(async ([name, command]) => {
		await application.commands.fetch();
		const applicationCommand = application.commands.cache.find(c => c.name === name);
		if(!applicationCommand) {
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
	if(interaction.isCommand()) {
		const command = commands.get(interaction.commandName);
		if(!isUndefined(command)) {
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
						await interaction.reply(errorResponse, { "ephemeral": true });
					}
				}
			} else {
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

setInterval(update, 60 * Interval.SECOND);

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
