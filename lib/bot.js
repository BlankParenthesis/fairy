const repl = require("repl");
const path = require("path");
const fs = require("fs");
const util = require("util");

const { Client, GuildMember, Message, DMChannel, RichEmbed } = require("discord.js");
const chalk = require("chalk");
const Pxls = require("pxls");
const Long = require("long");
const sharp = require("sharp");
const got = require("got");
const { PNG } = require("pngjs");

require("./overrides.js");
const Histoire = require("./history");

const config = require(path.resolve(__dirname, "..", "config.json"));
let persistent = {};
try {
	persistent = require(path.resolve(__dirname, "..", "persistent.json"));
	if(!(persistent.templates instanceof Object)) persistent.templates = {};
	if(!(persistent.summaries instanceof Object)) persistent.summaries = {};
} catch(e) {}


const flushPersist = async () => {
	return await new Promise(resolve => fs.createWriteStream(path.resolve(__dirname, "..", "persistent.json")).write(JSON.stringify(persistent), resolve));
};

const replServer = repl.start();
fs.appendFileSync(path.resolve(__dirname, "..", ".node_repl_history"), "");
fs.readFileSync(path.resolve(__dirname, "..", ".node_repl_history")).toString().split("\n").reverse().filter(line => line.trim()).map(line => replServer.history.push(line));

const output = (string, c) => {
	const color = c || (x => x);
	const lines = Math.floor((repl._prompt + replServer.line).length / replServer.output.columns);

	for(let i = 0; i < lines; i++) {
		replServer.output.write("\r\u001b[K\u001b[1A");
	}
	replServer.output.write(color(`\r\u001b[K${string}\n`));
	replServer.output.write(`${replServer._prompt}${replServer.line}`);
	replServer.cursor = replServer.cursor; //set the cursor to the correct position since the display has moved it to the end but internally it doesn't move
};

const LogLevel = {
	"LOG": 0,
	"INFO": 1,
	"ERROR": 2,
	"WARN": 3,
	"DEBUG": 4
};

const loglevel = (typeof config.loglevel === "number" ? config.loglevel : LogLevel[config.loglevel]) || LogLevel.ERROR;

console.log = (...s) => loglevel >= LogLevel.LOG ? s.forEach(o => output(typeof o === "string" ? o : util.inspect(o))) : null;
console.info = (...s) => loglevel >= LogLevel.INFO ? s.forEach(o => output(`ℹ ${typeof o === "string" ? o : util.inspect(o)}`, chalk.white)) : null;
console.error = (...s) => loglevel >= LogLevel.ERROR ? s.forEach(o => output(`🚫 ${typeof o === "string" ? o : util.inspect(o)}`, chalk.redBright)) : null;
console.warn = (...s) => loglevel >= LogLevel.WARN ? s.forEach(o => output(`⚠  ${typeof o === "string" ? o : util.inspect(o)}`, chalk.yellow)) : null;
console.debug = (...s) => loglevel >= LogLevel.DEBUG ? s.forEach(o => output(`🐛 ${typeof o === "string" ? o : util.inspect(o)}`, chalk.gray)) : null;

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

const sleep = t => new Promise(resolve => setTimeout(resolve, t));

fairy.on("ready", () => set(true, pxlsUp));
fairy.on("disconnect", () => set(false, pxlsUp));
fairy.on("error", () => set(false, pxlsUp));

const pxls = new Pxls();
pxls.connect();

pxls.on("ready", () => set(discordUp, true));
pxls.on("disconnect", () => set(discordUp, false));

const guildCheck = o => {
	if(o instanceof GuildMember) return o.guild.id === config.guildid;
	if(o instanceof Message) return o.guild && o.guild.id === config.guildid;
	return false;
};

const guild = () => fairy.guilds.get(config.guildid);
const guildFairy = () => guild().members.get(fairy.user.id);
const user = async id => {
	try {
		return await fairy.fetchUser(id);
	} catch(e) {
		return { "username": "InvalidUser", "discriminator": "0000" };
	}
};

const emoji = s => guild().emojis.find(e => new RegExp(`^${s}$`, "i").test(e.name));
const textEmoji = s => {
	const e = emoji(s);
	if(e) return `<${e.animated ? "a" : ""}:${e.name}:${e.id}>`;
	return null;
};

const mentionsMe = s => {
	return (new RegExp(`(<@${fairy.user.id}>|@?(${fairy.user.username}${guildFairy().nickname ? `|${guildFairy().nickname}` : ""})(#${fairy.user.discriminator})?)`, "i")).test(s);
};

const isAdmin = u => config.admins instanceof Array && config.admins.contains(u.id);

const zip = (a, b) => {
	const c = new Array(a.length);
	for(let i = 0; i < a.length; i++) {
		c[i] = [a[i], b[i]];
	}
	return c;
};

const confirm = async (message, from) => {
	const yesEmoji = "✅";
	const noEmoji = "❌";

	let error = null;
	const check = (r => r.users.has(from.id) && (r.emoji.name === yesEmoji || r.emoji.name === noEmoji));
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

const humanTime = t => {
	let time = t / 1000; //seconds
	if(time < 120) return `${Math.round(time)} second${Math.round(time) === 1 ? "" : "s"}`;
	time /= 60; //minutes
	if(time < 180) return `${Math.round(time)} minute${Math.round(time) === 1 ? "" : "s"}`;
	time /= 60; //hours
	if(time < 48) return `${Math.round(time)} hour${Math.round(time) === 1 ? "" : "s"}`;
	time /= 24; //days
	return `${Math.round(time)} day${Math.round(time) === 1 ? "" : "s"}`;
};

const humanColor = p => ({
	"0": "White",
	"1": "LightGrey",
	"2": "MediumGrey",
	"3": "DeepGrey",
	"4": "DarkGrey",
	"5": "Black",
	"6": "Pink",
	"7": "Red",
	"8": "Maroon",
	"9": "Beige",
	"10": "Peach",
	"11": "Orange",
	"12": "Brown",
	"13": "Chocolate",
	"14": "Yellow",
	"15": "Lime",
	"16": "Green",
	"17": "Forest",
	"18": "Cyan",
	"19": "Cerulean",
	"20": "Blue",
	"21": "Mauve",
	"22": "Magenta",
	"23": "Purple",
	"255": "Transparent"
})[p];

// Setup/utility code above
// Practical code below

class Template {
	constructor(x, y, width, height, data, historicalData) {
		this.x = parseInt(x);
		this.y = parseInt(y);
		this.width = parseInt(width);
		this.height = parseInt(height);
		this.data = data;

		this._histy = new Histoire();
		this._croire = new Histoire();

		const history = historicalData || {
			"good": {
				"last minute": 0,
				"last quarterhour": 0,
				"last hour": 0,
				"last fourhour": 0,
				"last day": 0
			},
			"bad": {
				"last minute": 0,
				"last quarterhour": 0,
				"last hour": 0,
				"last fourhour": 0,
				"last day": 0
			},
			"timestamp": Date.now(),
			"progress": this.rawProgress
		};

		const goodValueDelta = Math.max(history.progress - this.rawProgress, 0);
		const badValueDelta = Math.max(this.rawProgress - history.progress, 0);

		this._histy.track("last minute", 1000 * 60, goodValueDelta, history.good["last minute"], history.timestamp);
		this._histy.track("last quarterhour", 1000 * 60 * 15, goodValueDelta, history.good["last quarterhour"], history.timestamp);
		this._histy.track("last hour", 1000 * 60 * 60, goodValueDelta, history.good["last hour"], history.timestamp);
		this._histy.track("last fourhour", 1000 * 60 * 60 * 4, goodValueDelta, history.good["last fourhour"], history.timestamp);
		this._histy.track("last day", 1000 * 60 * 60 * 24, goodValueDelta, history.good["last day"], history.timestamp);

		this._croire.track("last minute", 1000 * 60, badValueDelta, history.bad["last minute"], history.timestamp);
		this._croire.track("last quarterhour", 1000 * 60 * 15, badValueDelta, history.bad["last quarterhour"], history.timestamp);
		this._croire.track("last hour", 1000 * 60 * 60, badValueDelta, history.bad["last hour"], history.timestamp);
		this._croire.track("last fourhour", 1000 * 60 * 60 * 4, badValueDelta, history.bad["last fourhour"], history.timestamp);
		this._croire.track("last day", 1000 * 60 * 60 * 24, badValueDelta, history.bad["last day"], history.timestamp);
	}

	get goodPixelsLastMinute() {
		return this._histy.get("last minute");
	}

	get goodPixelsLastQuarterHour() {
		return this._histy.get("last quarterhour");
	}

	get goodPixelsLastHour() {
		return this._histy.get("last hour");
	}

	get goodPixelsLastFourHour() {
		return this._histy.get("last fourhour");
	}

	get goodPixelsLastDay() {
		return this._histy.get("last day");
	}

	goodPixel() {
		this._histy.hitAll();
	}

	get badPixelsLastMinute() {
		return this._croire.get("last minute");
	}

	get badPixelsLastQuarterHour() {
		return this._croire.get("last quarterhour");
	}

	get badPixelsLastHour() {
		return this._croire.get("last hour");
	}

	get badPixelsLastFourHour() {
		return this._croire.get("last fourhour");
	}

	get badPixelsLastDay() {
		return this._croire.get("last day");
	}

	get progressLastMinute() {
		return this.goodPixelsLastMinute - this.badPixelsLastMinute;
	}

	get progressLastQuarterHour() {
		return this.goodPixelsLastQuarterHour - this.badPixelsLastQuarterHour;
	}

	get progressLastHour() {
		return this.goodPixelsLastHour - this.badPixelsLastHour;
	}

	get progressLastFourHour() {
		return this.goodPixelsLastFourHour - this.badPixelsLastFourHour;
	}

	get progressLastDay() {
		return this.goodPixelsLastDay - this.badPixelsLastDay;
	}

	_eta(window, rate) {
		return ((this.size - this.rawProgress) / rate) * window;
	}

	get minuteBasedEta() {
		return this._eta(1000 * 60, this.progressLastMinute);
	}

	get quarterhourBasedEta() {
		return this._eta(1000 * 60 * 15, this.progressLastQuarterHour);
	}

	get hourBasedEta() {
		return this._eta(1000 * 60 * 60, this.progressLastHour);
	}

	get fourhourBasedEta() {
		return this._eta(1000 * 60 * 60 * 4, this.progressLastFourHour);
	}

	get dayBasedEta() {
		return this._eta(1000 * 60 * 60 * 24, this.progressLastDay);
	}

	get complete() {
		return this.progress === 1;
	}

	get eta() {
		if(this.complete) return 0;
		return [
			// [this.minuteBasedEta, 1000 * 60],
			[this.quarterhourBasedEta, 1000 * 60 * 15],
			[this.hourBasedEta, 1000 * 60 * 60],
			[this.fourhourBasedEta, 1000 * 60 * 60 * 4],
			[this.dayBasedEta, 1000 * 60 * 60 * 24]
		].sort((a, b) => (Math.abs(1 - (a[0] / a[1]))) > Math.abs(1 - (b[0] - b[1])))[0][0]; //find the measurement giving the closest estimate to it's own time period
	}

	badPixel() {
		this._croire.hitAll();
	}

	bounds(x, y) {
		return !(x < this.x || y < this.y || x > this.x + this.width || y > this.y + this.height);
	}

	at(x, y) {
		return this.bounds(x, y) ? this.data[x - this.x + ((y - this.y) * this.width)] : 255;
	}

	colorAt(x, y) {
		return humanColor(this.at(x, y));
	}

	get size() {
		return this.data.filter(b => b !== 255).length;
	}

	get badPixels() {
		const data = zip(this.data, this.shadow);
		const bads = [];
		for(let x = 0; x < this.width; x++) {
			for(let y = 0; y < this.height; y++) {
				const i = x + (y * this.width);
				if(data[i][0] !== 255 && data[i][0] !== data[i][1]) bads.push([x + this.x, y + this.y]);
			}
		}
		return bads;
	}

	get rawProgress() {
		return zip(this.data, this.shadow).filter(v => v[0] === v[1]).length;
	}

	get progress() {
		return this.rawProgress / this.size;
	}

	get summary() {
		const { badPixels, eta } = this;
		const badPixelsSummary = badPixels.length > 0 ? `\`\`\`css\n${badPixels.slice(0, 4).map(p => `[${p.join(",")}] should be ${this.colorAt(p[0], p[1])}`).join("\n")}${badPixels.length > 4 ? "\n..." : ""}\`\`\`` : "";
		const progressMinute = `${this.progressLastMinute > 0 ? (this.progressLastMinute > 4 ? "⏫" : "🔼") : this.progressLastMinute < 0 ? (this.progressLastMinute < -4 ? "⏬" : "🔽") : "⏹"} ${this.progressLastMinute} pixels/minute`;
		const progressHour = `${this.progressLastHour > 0 ? (this.progressLastHour > (4 * 60) ? "⏫" : "🔼") : this.progressLastHour < 0 ? (this.progressLastHour < (-4 * 60) ? "⏬" : "🔽") : "⏹"} ${this.progressLastHour} pixels/hour`;
		const progressDay = `${this.progressLastDay > 0 ? (this.progressLastDay > (4 * 60 * 24) ? "⏫" : "🔼") : this.progressLastDay < 0 ? (this.progressLastDay < (-4 * 60 * 24) ? "⏬" : "🔽") : "⏹"} ${this.progressLastDay} pixels/day`;
		const progressSummary = this.complete ? "" : `\n\n${progressMinute}\n${progressHour}\n${progressDay}\n${eta >= 0 ? `Done in ~**${humanTime(eta)}**` : `Gone in ~**${humanTime(-eta)}**`}`;
		return `${parseFloat((this.progress * 100).toFixed(2))}% done\n${this.rawProgress} of ${this.size} pixels${progressSummary}${badPixelsSummary}`;
	}

	get shadow() {
		return pxls.getCroppedCanvas(this.x, this.y, this.width, this.height);
	}

	get rgba() {
		const rgba = new Uint8Array((this.width * this.height) << 2);
		const { palette } = pxls;
		const { data } = this;
		const len = data.length << 2;

		rgba.fill(255);

		for(let i = 0; i < len; i += 4) {
			if(palette[data[i >> 2]]) rgba.set(palette[data[i >> 2]], i);
			else rgba.set([0, 0, 0, 0], i);
		}
		return rgba;
	}

	get png() {
		const image = new PNG({ "width": this.width, "height": this.height });
		image.data.set(this.rgba);
		return image.pack();
	}

	async save(file) {
		return await new Promise(resolve => {
			this.png.pipe(fs.createWriteStream(file)).once("finish", resolve);
		});
	}

	get persistData() {
		const { x, y, width, height } = this;
		return {
			x,
			y,
			width,
			height,
			"history": {
				"good": {
					"last minute": this.goodPixelsLastMinute,
					"last quarterhour": this.goodPixelsLastQuarterHour,
					"last hour": this.goodPixelsLastHour,
					"last fourhour": this.goodPixelsLastFourHour,
					"last day": this.goodPixelsLastDay
				},
				"bad": {
					"last minute": this.badPixelsLastMinute,
					"last quarterhour": this.badPixelsLastQuarterHour,
					"last hour": this.badPixelsLastHour,
					"last fourhour": this.badPixelsLastFourHour,
					"last day": this.badPixelsLastDay
				},
				"timestamp": Date.now(),
				"progress": this.rawProgress
			}
		};
	}
}

const determinePalleteInArea = (w, h, data, scale, i) => {
	const votes = (new Array(pxls.palette.length)).fill(0);
	const palette = new Map(Object.entries(pxls.palette).map(e => [e[1].join(","), e[0]]));

	for(let x = 0; x < scale; x++) {
		for(let y = 0; y < scale; y++) {
			if(i === 0 && x === 0 && y === 0 && data[3] < 64) continue; // Zoda's pxlsFiddle puts a special pixel here to determine the scale, don't count such a pixel as a vote
			const ia = ((((i % w) * scale) + (Math.floor(i / w) * w * scale * scale) + x + (y * w * scale)) << 2);
			if(data.readUInt8(ia + 3) === 0) continue;
			const pixel = Array.from(data.slice(ia, ia + 3)).join(",");
			if(palette.has(pixel)) votes[palette.get(pixel)] += 1;
		}
	}

	let bestI = 0;
	for(let j = 1; j < votes.length; j++) {
		if(votes[j] > votes[bestI]) bestI = j;
	}

	return votes[bestI] > 0 ? bestI : 255;
};

const decodeTemplateData = (w, h, data, scale) => {
	const canvasImage = new Uint8Array(w * h);
	for(let i = 0; i < w * h; i++) {
		canvasImage.set([determinePalleteInArea(w, h, data, scale, i)], i);
	}
	return canvasImage;
};

const decodeTemplateImage = async (url, width) => {
	const buffer = (await got(url, { "encoding": null })).body;
	const im = new sharp(buffer);
	const meta = await im.metadata();

	const ratio = width > 0 ? meta.width / width : 1;
	if(ratio !== Math.round(ratio)) throw new Error("can't be fucked");

	const template = {
		"width": meta.width / ratio,
		"height": meta.height / ratio
	};

	template.data = decodeTemplateData(template.width, template.height, await im.raw().toBuffer(), ratio);
	return template;
};

const loadTemplate = async t => {
	if(t.indexOf("#") === -1) throw new Error("need template data");
	const params = new Map(t.substring(t.indexOf("#") + 1).split("&").map(e => e.split("=")).map(e => [e[0], decodeURIComponent(e[1])]));
	const template = await decodeTemplateImage(params.get("template"), params.get("tw"));
	return new Template(params.get("ox") || 0, params.get("oy") || 0, template.width, template.height, template.data);
};

const templatePath = n => path.resolve(__dirname, "..", "templates", `${n}.png`);

const loadTemplateFromStorage = async (name, width, height) => {
	const buffer = await new Promise((resolve, reject) => fs.readFile(templatePath(name), (err, data) => err ? reject(err) : resolve(data)));
	const im = new sharp(buffer);
	return decodeTemplateData(width, height, await im.raw().toBuffer(), 1);
};

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
		await Promise.all(Object.entries(persistent.templates).map(async e => templates.set(e[0], new Template(e[1].x, e[1].y, e[1].width, e[1].height, await loadTemplateFromStorage(e[0], e[1].width, e[1].height), e[1].history))));
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
	const embed = new RichEmbed();

	embed.setTitle("Template progress");
	embed.setDescription("");
	embed.setColor([179, 0, 0]); // Kaide`'s Reimu color ⛩
	embed.setTimestamp();
	embed.setFooter("updated every minute");

	const templatesToSummarise = (toSummarise.length === 1 && toSummarise[0] instanceof Array) ? toSummarise[0] : toSummarise;
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
		} catch(e) {}
	}
	const summary = await channel.send(summaryEmbed(typeof t === "string" ? [t] : t));
	persistent.summaries[channel.id] = {
		"message": summary.id,
		t
	};
	flushPersist();
	return summary;
};

setInterval(async () => {
	try {
		await Promise.all(persistent.summaries.map(async (channelId, summary) => {
			(await fairy.channels.get(channelId).fetchMessage(summary.message)).edit(summaryEmbed(...summary.templates));
		}));
		await flushPersist();
	} catch(e) {
		console.error("Couldn't update all summaries:", e);
	}
}, 60000);

pxls.on("pixel", p => {
	templates.map((name, template) => {
		const color = template.at(p.x, p.y);
		if(color === 255) return;
		if(p.color === color) {
			console.log(`${chalk.yellow(name)}: ${p.x}, ${p.y} - ${chalk.greenBright(`${humanColor(p.color)} == ${humanColor(color)}`)}`);
			template.goodPixel();
		} else {
			console.log(`${chalk.yellow(name)}: ${p.x}, ${p.y} - ${chalk.redBright(`${humanColor(p.color)} != ${humanColor(color)}`)}`);
			template.badPixel();
		}
	});
});

fairy.on("guildMemberAdd", m => {
	if(!guildCheck(m)) return;

	const role = guild().roles.find(r => /^fairy$/i.test(r.name));
	m.addRole(role);
});

const convertMentions = async message => {
	const regex = /<@!?([0-9]+)>/g;
	const pieces = [];
	const usersPromises = [];
	let lasti = 0;
	let match;
	do {
		match = regex.exec(message);
		if(match) {
			pieces.push(message.substring(lasti, match.index));
			usersPromises.push(user(match[1]));
			lasti = match.index + match[0].length;
		}
	} while(match);

	const users = await Promise.all(usersPromises);

	return pieces.map((_, i) => `${pieces[i]}${chalk.white.bgBlue(`@${users[i].tag}`)}`).join("") + message.substring(lasti);
};

const printMsg = async m => {
	console.log(`${chalk.blueBright(m.author.username)}: ${chalk.white(await convertMentions(m.content))}`);
};

let irritationLevel = 0;

class Command {
	constructor(r, guard, exec) {
		this.regex = r;
		this.allow = guard;
		this.exec = exec;
	}

	async run(m) {
		if(!this.allow(m)) return false;
		const matched = this.regex.exec(m.content);
		if(matched) await this.exec(matched, m);
		else return false;
		return true;
	}
}

const commands = [
	new Command(
		new RegExp("^\\s*(pokes?|boops?|[^\\w]pokes?[^\\w]\\s+[^\\s]*|[^\\w]boops?[^\\w]\\s+[^\\s]*|[^\\w][^\\w]pokes?[^\\w][^\\w]\\s+[^\\s]*|[^\\w][^\\w]boops?[^\\w][^\\w]\\s+[^\\s]*|[^\\w]pokes?\\s+[^\\s]*[^\\w]|[^\\w]boops?\\s+[^\\s]*[^\\w]|[^\\w][^\\w]pokes?\\s+[^\\s]*[^\\w][^\\w]|[^\\w][^\\w]boops?\\s+[^\\s]*[^\\w][^\\w])\\s*$", "i"),
		m => mentionsMe(m.content),
		async (match, message) => {
			switch(irritationLevel++) {
				case 0:
					await message.react(emoji("cirShock") || "❕");
					break;
				case 1:
					await message.react(emoji("cirThinkAnimated") || "🤔");
					break;
				case 2:
				case 3:
					await message.react("💢");
					break;
				case 4:
					try {
						await message.channel.send(`${textEmoji("cirBaka") || "💢"} *Would you mind not poking me?*`);
					} catch(e) {
						await message.react(emoji("cirCop") || "🔫");
					}
					break;
				case 5:
					try {
						message.channel.send("Seriously, __stop__.");
					} catch(e) {
						await message.react(emoji("cirCop") || "🔫");
						await message.react("🇸");
						await message.react("🇹");
						await message.react("🇴");
						await message.react("🇵");
						await message.react("💢");
					}
					break;
				default:
					await message.react(emoji("cirNo") || "☠");
			}

			setTimeout(() => irritationLevel--, 300000);
		}
	),
	new Command(/(?:use|new|add(?:\s+a)?(?:\s+new)?)\s+template(?:\s+(?:called|named))?((?:\s+[^\s]+)*)\s+<?(https:\/\/pxls.space\/?#[^\s]*template=[^\s>]+)>?/i, m => mentionsMe(m.content) && isAdmin(m.author), async (match, message) => {
		const name = match[1].trim();
		if(templates.has(name)) {
			try {
				const confirmation = await confirm(await message.channel.send("There's already a template with that name, are you sure you want to replace it?"), message.author);
				if(!confirmation) return;
			} catch(e) {
				await message.channel.send(`Fine, I guess you don't care... ${textEmoji("cirShrug") || "🤷"}`);
				return;
			}
		}
		message.channel.startTyping(); //since the template can take a while to decode and convert
		const template = await loadTemplate(match[2]);
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
			await message.channel.send(`Fine, I guess you don't care... ${textEmoji("cirShrug") || "🤷"}`);
		}
	}),
	new Command(/(?:remove|delete)\s+template(?:\s+(?:called|named))?((?:\s+[^\s]+)*)/i, m => mentionsMe(m.content) && isAdmin(m.author), async (match, message) => {
		const bestMatch = findTemplate(match[0]);
		if(bestMatch === null) {
			await message.channel.send("I couldn't find mention to any of the existing templates in your request...");
			return;
		}
		try {
			const confirmation = await confirm(await message.channel.send(`So you want me to remove the template} ${bestMatch ? `called "${bestMatch}"` : "without a name"}?`), message.author);
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
			await message.channel.send(`Fine, I guess you don't care... ${textEmoji("cirShrug") || "🤷"}`);
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
			await m.react(emoji("cirShock") || "😖");
			return false;
		}
	}
	return false;
};

const getMessage = async message => {
	persistent.lastMessageTime = Math.max(message.createdTimestamp, persistent.lastMessageTime);
	flushPersist();
	if(message.author.id === fairy.user.id) return;
	if(message.channel instanceof DMChannel) return await printMsg(message);
	if(!guildCheck(message)) return;

	if(!beCommanded(message)) await printMsg(message);
};

fairy.on("message", getMessage);

const timestamp = id => Long.fromString(id).shiftRight(22).toNumber();

fairy.once("ready", async () => {
	console.log(`📥 ${chalk.grey("checking inbox...")}`);
	const t = persistent.lastMessageTime;

	await Promise.all(fairy.users.map(async u => {
		try {
			return await u.createDM();
		} catch(e) {
			return null;
		}
	}));

	const channels = fairy.channels.filter(c => c.lastMessageID !== null);
	const messages = (await Promise.all(channels.filter(c => c.lastMessageID && timestamp(c.lastMessageID) > t).map(async c => {
		const msgs = (await c.fetchMessages()).filter(m => m.createdTimestamp > t);
		return msgs;
	}))).reduce((a, b) => a.concat(Array.from(b.values())), []);

	console.log(`${messages.length === 0 ? `📭 ${chalk.redBright("no")}` : `📬 ${chalk.green(messages.length)}`} ${chalk.grey("new messages:")}`);
	messages.forEach(getMessage);
	persistent.lastMessageTime = messages.map(m => m.createdTimestamp).reduce(Math.max, persistent.lastMessageTime);
	flushPersist();
});

replServer.context.chalk = chalk;
replServer.context.fairy = fairy;
replServer.context.user = user;
replServer.context.guildFairy = guildFairy;
replServer.context.pxls = pxls;
replServer.context.persistent = persistent;
replServer.context.console = console;
replServer.context.log = console.log;
replServer.context.info = console.info;
replServer.context.error = console.error;
replServer.context.warn = console.warn;
replServer.context.debug = console.debug;
replServer.context.guild = guild;
replServer.context.timestamp = timestamp;
replServer.context.loadTemplate = loadTemplate;
replServer.context.emoji = emoji;
replServer.context.textEmoji = textEmoji;
replServer.context.isAdmin = isAdmin;
replServer.context.commands = commands;
replServer.context.mentionsMe = mentionsMe;
replServer.context.templates = templates;
replServer.context.confirm = confirm;
replServer.context.loadTemplateFromStorage = loadTemplateFromStorage;
replServer.context.exit = process.exit;
replServer.context.progress = () => console.log(...templates.map(t => `${chalk.yellow(t)}: ${chalk.cyan((100 * templates.get(t).progress).toFixed(2))}%`));
replServer.context.findTemplate = findTemplate;
replServer.context.postSummary = postSummary;
replServer.context.humanTime = humanTime;
replServer.context.repl = replServer;

replServer.on("exit", async () => {
	fs.appendFileSync(path.resolve(__dirname, "..", ".node_repl_history"), `${replServer.lines.join("\n")}\n`);
	[...templates.entries()].forEach(e => {
		const [name, template] = e;
		persistent.templates[name] = template.persistData;
	});
	await flushPersist();
	process.exit();
});
