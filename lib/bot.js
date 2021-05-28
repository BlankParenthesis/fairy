const path = require("path");
const fs = require("fs");
const util = require("util");

const { Client, MessageEmbed } = require("discord.js");
const chalk = require("chalk");
const Pxls = require("pxls");

const { Template, templatePath, loadTemplate, loadTemplateDataFromStorage } = require("./template");
const { Command } = require("./command");
const Repl = require("./repl");

require("./overrides.js");

const config = require(path.resolve(__dirname, "..", "config.json"));
let persistent = {};
let persistentError = false;
try {
	/* eslint-disable global-require */
	persistent = require(path.resolve(__dirname, "..", "persistent.json"));
} catch(e) {
	persistentError = true;
}
if(!(persistent.templates instanceof Object)) persistent.templates = {};
if(!(persistent.summaries instanceof Object)) persistent.summaries = {};


const flushPersist = async () => {
	return await fs.promises.writeFile(path.resolve(__dirname, "..", "persistent.json"), JSON.stringify(persistent));
};

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

if(persistentError) {
	console.warn("Unable to read persistent data");
}

console.log(chalk.white("🧚 Please wait..."));

const fairy = new Client();
fairy.login(config.token);

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

const pxls = new Pxls();
pxls.connect();

pxls.on("ready", () => set(discordUp, true));
pxls.on("disconnect", () => set(discordUp, false));

const mentionsMe = s => new RegExp(`<@[!]?${fairy.user.id}>`).test(s);
const isAdmin = u => config.admins instanceof Array && config.admins.contains(u.id);

const confirm = async (message, from) => {
	const yesEmoji = "✅";
	const noEmoji = "❌";

	let error = null;
	const check = (r => r.users.cache.has(from.id) && (r.emoji.name === yesEmoji || r.emoji.name === noEmoji));
	const reactions = message.awaitReactions(check, { "max": 1, "time": 60000, "errors": ["time"] });
	reactions.catch(e => error = e);

	const yes = await message.react(yesEmoji);
	const no = await message.react(noEmoji);
	try {
		const reaction = (check(yes) && yes) || (check(no) && no) || (!error && (await reactions).first());
		await yes.remove();
		await no.remove();
		return reaction && (reaction.emoji === yes.emoji);
	} catch(e) {
		await yes.remove();
		await no.remove();
		throw e;
	}
};
// Setup/utility code above
// Practical code below

const templates = new Map();

const findTemplateInString = s => {
	const matches = templates.map(e => ({ "i": s.toLowerCase().indexOf(e.toLowerCase()), "name": e })).filter(e => e.i !== -1);
	return matches.length === 0 ? null : matches.reduce((e, l) => l.i < e.i ? l : l.i > e.i ? e : l.name.length > e.name.length ? l : e).name;
};

const findTemplateWithString = s => {
	const matches = templates.map(e => ({ "i": e.toLowerCase().indexOf(s.toLowerCase()), "name": e })).filter(e => e.i !== -1);
	return matches.length === 0 ? null : matches.reduce((e, l) => l.i < e.i ? l : l.i > e.i ? e : l.name.length > e.name.length ? l : e).name;
};

const findTemplate = s => {
	return findTemplateInString(s) || findTemplateWithString(s);
};

pxls.once("ready", async () => {
	try {
		await Promise.all(Object.entries(persistent.templates).map(async e => templates.set(e[0], new Template(pxls, e[1].x, e[1].y, e[1].width, e[1].height, await loadTemplateDataFromStorage(pxls, e[0], e[1].width, e[1].height), e[1].started, e[1].history))));
		console.info(`${chalk.blueBright(templates.size)} templates loaded`);
	} catch(e) {
		console.error("Failed to load template:", e);
	}
});

const addTemplate = async (name, template) => {
	await template.save(templatePath(name));
	persistent.templates[name] = {
		"x": template.x,
		"y": template.y,
		"width": template.width,
		"height": template.height
	};
	flushPersist();
	templates.set(name, template);
};

const removeTemplate = async (name) => {
	templates.delete(name);
	delete persistent.templates[name];
	flushPersist();
};

const summaryEmbed = function(...toSummarise) {
	const embed = new MessageEmbed();

	embed.setTitle("Template progress");
	embed.setDescription("");
	embed.setColor([179, 0, 0]); // Kaide`'s Reimu color ⛩
	embed.setTimestamp();
	embed.setFooter("updated every minute");

	const templatesToSummarise = (toSummarise.length === 1 && (typeof toSummarise[0] !== "string") && toSummarise[0][Symbol.iterator]) ? [...toSummarise[0]] : toSummarise;
	templatesToSummarise.map(t => findTemplate(t)).filter(t => templates.has(t)).forEach(t => {
		const template = templates.get(t);
		embed.addField(t, template.summary, true);
	});

	return embed;
};

const postSummary = async (channel, t) => {
	if(persistent.summaries[channel.id]) {
		try {
			await (await channel.fetchMessage(persistent.summaries[channel.id].message)).delete();
		} catch(e) {
			console.warn("Failed to delete previous summary");
		}
	}
	const ts = (typeof t === "string") ? [t] : t;
	const summary = await channel.send(summaryEmbed(ts));
	persistent.summaries[channel.id] = {
		"message": summary.id,
		"templates": ts
	};
	flushPersist();
	return summary;
};

const humanColor = (color) => pxls.palette[color].name;

pxls.on("pixel", p => {
	let change = false;
	templates.map((name, template) => {
		const color = template.at(p.x, p.y);
		if(color === 255) return;
		change = true;
		if(p.color === color) {
			console.log(`${chalk.yellow(name)}: ${p.x}, ${p.y} - ${chalk.greenBright(`${humanColor(p.color)} == ${humanColor(color)}`)}`);
			template.goodPixel();
		} else if(p.oldColor === template.at(p.x, p.y)) {
			console.log(`${chalk.yellow(name)}: ${p.x}, ${p.y} - ${chalk.redBright(`${humanColor(p.color)} != ${humanColor(color)}`)}`);
			template.badPixel();
		}
	});
	if(change) {
		fairy.emit("change");
	}
});

const update = async () => {
	try {
		if(!pxlsUp) return;
		await Promise.all(persistent.summaries.map(async (channelId, summary) => {
			await (await ((await fairy.channels.fetch(channelId)).messages.fetch(summary.message))).edit(summaryEmbed(...summary.templates));
		}));
		await flushPersist();
	} catch(e) {
		console.error("Couldn't update all summaries:", e);
	}
};

setInterval(update, 60000);

const commands = [
	new Command(/(?:use|new|add(?:\s+a)?(?:\s+new)?)\s+template(?:\s+(?:called|named))?((?:\s+[^\s]+)*)\s+<?(https:\/\/pxls.space\/?#[^\s]*template=[^\s>]+)>?/i, m => mentionsMe(m.content) && isAdmin(m.author), async (match, message) => {
		const name = match[1].trim();
		if(templates.has(name)) {
			try {
				const confirmation = await confirm(await message.channel.send("There's already a template with that name, are you sure you want to replace it?"), message.author);
				if(!confirmation) return;
			} catch(e) {
				await message.channel.send("Fine, I guess you don't care... 🤷");
				return;
			}
		}
		message.channel.startTyping(); //since the template can take a while to decode and convert
		const template = await loadTemplate(pxls, match[2]);
		const { width, height, x, y } = template;
		try {
			const confirmation = await confirm(await message.channel.send(`So you want me to place a template at (${x}, ${y}) with dimensions ${width}x${height} ${name ? `called "${name}"` : "without a name"}?`), message.author);
			message.channel.stopTyping();
			if(confirmation) {
				try {
					await message.channel.send("Alright, I'll add it to the templates list");
					await addTemplate(name, template);
				} catch(e) {
					console.error(e);
				}
			} else {
				await message.channel.send("Alright, what did you mean then?");
			}
		} catch(e) {
			await message.channel.send("Fine, I guess you don't care… 🤷");
		}
	}),
	new Command(/(?:remove|delete)\s+template(?:\s+(?:called|named))?((?:\s+[^\s]+)*)/i, m => mentionsMe(m.content) && isAdmin(m.author), async (match, message) => {
		const bestMatch = findTemplate(match[0]);
		if(bestMatch === null) {
			await message.channel.send("I couldn't find mention to any of the existing templates in your request…");
			return;
		}
		try {
			const confirmation = await confirm(await message.channel.send(`So you want me to remove the template ${bestMatch ? `called "${bestMatch}"` : "without a name"}?`), message.author);
			if(confirmation) {
				try {
					await message.channel.send("Alright, I'll remove it from the templates list");
					await removeTemplate(bestMatch);
				} catch(e) {
					console.error(e);
				}
			} else {
				await message.channel.send("Alright, what did you mean then?");
			}
		} catch(e) {
			await message.channel.send("Fine, I guess you don't care… 🤷");
		}
	})
];

const beCommanded = async m => {
	for(const command of commands) {
		try {
			if(await command.run(m)) return true;
		} catch(e) {
			console.error("😖 An error Occured while executing a command:", e);
			await m.react("❌");
			await m.react("😖");
			return false;
		}
	}
	return false;
};

const getMessage = async message => {
	persistent.lastMessageTime = Math.max(message.createdTimestamp, persistent.lastMessageTime);
	flushPersist();
	if(message.author.id === fairy.user.id) return;

	beCommanded(message);
};

fairy.on("message", getMessage);

replServer.context.fairy = fairy;
replServer.context.pxls = pxls;
replServer.context.persistent = persistent;
replServer.context.loadTemplate = loadTemplate;
replServer.context.isAdmin = isAdmin;
replServer.context.commands = commands;
replServer.context.templates = templates;
replServer.context.progress = () => console.log(...templates.map(t => `${chalk.yellow(t)}: ${chalk.cyan((100 * templates.get(t).progress).toFixed(2))}%`));
replServer.context.findTemplate = findTemplate;
replServer.context.postSummary = postSummary;
replServer.context.update = update;

replServer.on("exit", async () => {
	[...templates.entries()].forEach(e => {
		const [name, template] = e;
		persistent.templates[name] = template.persistData;
	});
	await flushPersist();
	process.exit();
});
