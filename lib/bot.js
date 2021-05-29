const path = require("path");
const util = require("util");

const { Client } = require("discord.js");
const chalk = require("chalk");
const Pxls = require("pxls");

const ServerHandler = require("./server");
const Repl = require("./repl");

require("./overrides.js");

const config = require(path.resolve(__dirname, "..", "config.json"));

const LogLevel = {
	"LOG": 0,
	"INFO": 1,
	"ERROR": 2,
	"WARN": 3,
	"DEBUG": 4
};

const loglevel = (typeof config.loglevel === "number" ? config.loglevel : LogLevel[config.loglevel]) || LogLevel.ERROR;

const replServer = new Repl(loglevel);

console.log = (...s) => loglevel >= LogLevel.LOG ? s.forEach(o => replServer.output(typeof o === "string" ? o : util.inspect(o))) : null;
console.info = (...s) => loglevel >= LogLevel.INFO ? s.forEach(o => replServer.output(`ℹ ${typeof o === "string" ? o : util.inspect(o)}`, chalk.white)) : null;
console.error = (...s) => loglevel >= LogLevel.ERROR ? s.forEach(o => replServer.output(`🚫 ${typeof o === "string" ? o : util.inspect(o)}`, chalk.redBright)) : null;
console.warn = (...s) => loglevel >= LogLevel.WARN ? s.forEach(o => replServer.output(`⚠  ${typeof o === "string" ? o : util.inspect(o)}`, chalk.yellow)) : null;
console.debug = (...s) => loglevel >= LogLevel.DEBUG ? s.forEach(o => replServer.output(`🐛 ${typeof o === "string" ? o : util.inspect(o)}`, chalk.gray)) : null;

console.log(chalk.white("🧚 Please wait..."));

const fairy = new Client();
const pxls = new Pxls();

const SERVERS = new Map();
const init = async () => {
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
const set = (d, p) => {
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
		if(!pxlsUp) return;
		await Promise.all(SERVERS.mapValues(server => server.updateSummaries()));
	} catch(e) {
		console.error("Couldn't update all summaries:", e);
	}
};

setInterval(update, 60000);

replServer.context.fairy = fairy;
replServer.context.pxls = pxls;
replServer.context.update = update;
replServer.context.servers = SERVERS;

replServer.on("exit", async () => {
	await Promise.all(SERVERS.mapValues(server => server.save()));
	process.exit();
});
