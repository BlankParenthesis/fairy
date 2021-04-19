const Histoire = require("./history");
const { PNG } = require("pngjs");
const fs = require("fs");
const sharp = require("sharp");
const got = require("got");
const path = require("path");

const { humanTime, zip } = require("./util");
/*
const humanColor = p => ({
	"0": "White",
	"1": "Light Grey",
	"2": "Medium Grey",
	"3": "Deep Grey",
	"4": "Dark Grey",
	"5": "Black",
	"6": "Pink",
	"7": "Watermelon",
	"8": "Red",
	"9": "Maroon",
	"10": "Beige",
	"11": "Peach",
	"12": "Orange",
	"13": "Rust",
	"14": "Brown",
	"15": "Chocolate",
	"16": "Yellow",
	"17": "Lime",
	"18": "Green",
	"19": "Forest",
	"20": "Aqua",
	"21": "Cyan",
	"22": "Cerulean",
	"23": "Blue",
	"24": "Navy",
	"25": "Mauve",
	"26": "Magenta",
	"27": "Purple",
	"255": "Transparent"
})[p];
*/
class Template {
	constructor(pxls, x, y, width, height, data, started, historicalData) {
		this.pxls = pxls;
		this.x = parseInt(x);
		this.y = parseInt(y);
		this.width = parseInt(width);
		this.height = parseInt(height);
		this.started = started || Date.now();
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

		const badValueDelta = Math.max(history.progress - this.rawProgress, 0);
		const goodValueDelta = Math.max(this.rawProgress - history.progress, 0);

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
		if(rate >= 0) {
			return ((this.size - this.rawProgress) / rate) * window;
		} else {
			return (this.rawProgress / rate) * window;
		}
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
		const delta = Date.now() - this.started;
		const x = [
			[this.minuteBasedEta, 1000 * 60],
			[this.quarterhourBasedEta, 1000 * 60 * 15],
			[this.hourBasedEta, 1000 * 60 * 60],
			[this.fourhourBasedEta, 1000 * 60 * 60 * 4],
			[this.dayBasedEta, 1000 * 60 * 60 * 24]
		];
		if(!x.some(e => e[1] <= delta)) return Infinity;

		const ratio = (eta, period) => Math.abs(Math.max(eta, period) / Math.min(eta, period));
		return x.filter(e => e[1] <= delta).sort((a, b) => ratio(a[0], a[1]) - ratio(b[0], b[1]))[0][0]; //find the measurement giving the closest estimate to it's own time period
	}

	badPixel() {
		this._croire.hitAll();
	}

	bounds(x, y) {
		return !(x < this.x || y < this.y || x >= this.x + this.width || y >= this.y + this.height);
	}

	at(x, y) {
		return this.bounds(x, y) ? this.data[x - this.x + ((y - this.y) * this.width)] : 255;
	}

	colorAt(x, y) {
		return this.pxls.palette[this.at(x, y)].name;
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
		return zip(this.data, this.shadow).filter(v => v[1] !== 255 && v[0] === v[1]).length;
	}

	get progress() {
		return this.rawProgress / this.size;
	}

	get summary() {
		const { badPixels, eta } = this;
		const fast = 4; //4 px/min is considered fast
		const badPixelsSummary = badPixels.length > 0 ? `\`\`\`css\n${badPixels.slice(0, 4).map(p => `[${p.join(",")}] should be ${this.colorAt(p[0], p[1])}`).join("\n")}${badPixels.length > 4 ? "\n..." : ""}\`\`\`` : "";
		const progressMinute = `${this.progressLastMinute > 0 ? (this.progressLastMinute > fast ? "⏫" : "🔼") : this.progressLastMinute < 0 ? (this.progressLastMinute < -fast ? "⏬" : "🔽") : "⏹"} ${this.progressLastMinute} pixels/minute`;
		const progressHour = `${this.progressLastHour > 0 ? (this.progressLastHour > (fast * 60) ? "⏫" : "🔼") : this.progressLastHour < 0 ? (this.progressLastHour < (-fast * 60) ? "⏬" : "🔽") : "⏹"} ${this.progressLastHour} pixels/hour`;
		const progressDay = `${this.progressLastDay > 0 ? (this.progressLastDay > (fast * 60 * 24) ? "⏫" : "🔼") : this.progressLastDay < 0 ? (this.progressLastDay < (-fast * 60 * 24) ? "⏬" : "🔽") : "⏹"} ${this.progressLastDay} pixels/day`;
		const recencyDisclaimer = Date.now() - this.started < 1000 * 60 * 60 * 24 ? `\n*started tracking ${humanTime(Date.now() - this.started)} ago*` : "";
		const progressSummary = this.complete ? "" : `\n\n${progressMinute}\n${progressHour}\n${progressDay}\n${eta >= 0 ? `Done in ~**${humanTime(eta)}**` : `Gone in ~**${humanTime(-eta)}**`}${recencyDisclaimer}`;
		return `${parseFloat((this.progress * 100).toFixed(2))}% done\n${this.rawProgress} of ${this.size} pixels${progressSummary}${badPixelsSummary}`;
	}

	get shadow() {
		return this.pxls.getCroppedCanvas(this.x, this.y, this.width, this.height);
	}

	get rgba() {
		const rgba = new Uint8Array((this.width * this.height) << 2);
		const { palette } = this.pxls;
		const { data } = this;
		const len = data.length << 2;

		rgba.fill(255);

		for(let i = 0; i < len; i += 4) {
			if(palette[data[i >> 2]]) rgba.set(palette[data[i >> 2]].values, i);
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
		const { x, y, width, height, started } = this;
		const history = {
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
		};

		return {
			x,
			y,
			width,
			height,
			started,
			history
		};
	}
}

const compressRGB = arr => (arr[0] << 16) | (arr[1] << 8) | arr[0];

const determinePalleteInArea = (palette, w, h, data, scale, i) => {
	const votes = (new Array(palette.size)).fill(0);

	for(let x = 0; x < scale; x++) {
		for(let y = 0; y < scale; y++) {
			if(i === 0 && x === 0 && y === 0 && data[3] < 64) continue; // Zoda's pxlsFiddle puts a special pixel here to determine the scale, don't count such a pixel as a vote
			const ia = ((((i % w) * scale) + (Math.floor(i / w) * w * scale * scale) + x + (y * w * scale)) << 2);
			if(data.readUInt8(ia + 3) === 0) continue;
			const pixel = compressRGB(data.slice(ia, ia + 3));
			if(palette.has(pixel)) votes[palette.get(pixel)] += 1;
		}
	}

	let bestI = 0;
	for(let j = 1; j < votes.length; j++) {
		if(votes[j] > votes[bestI]) bestI = j;
	}

	return votes[bestI] > 0 ? bestI : 255;
};

const decodeTemplateData = (palette, w, h, data, scale) => {
	const canvasImage = new Uint8Array(w * h);
	for(let i = 0; i < w * h; i++) {
		canvasImage.set([determinePalleteInArea(palette, w, h, data, scale, i)], i);
	}
	return canvasImage;
};

const decodeTemplateImage = async (palette, url, width) => {
	const buffer = (await got(url, { "encoding": null })).body;
	const im = new sharp(buffer);
	const meta = await im.metadata();

	const ratio = width > 0 ? meta.width / width : 1;
	if(ratio !== Math.round(ratio)) throw new Error("can't be fucked");

	const template = {
		"width": meta.width / ratio,
		"height": meta.height / ratio
	};

	template.data = decodeTemplateData(palette, template.width, template.height, await im.raw().toBuffer(), ratio);
	return template;
};

const templatePath = n => path.resolve(__dirname, "..", "templates", `${n}.png`);

const mapPalette = palette => new Map(Object.entries(palette).map(e => [compressRGB(e[1].values), e[0]]));

const loadTemplateDataFromStorage = async (pxls, name, width, height) => {
	const buffer = await new Promise((resolve, reject) => fs.readFile(templatePath(name), (err, data) => err ? reject(err) : resolve(data)));
	const im = new sharp(buffer);
	return decodeTemplateData(mapPalette(pxls.palette), width, height, await im.raw().toBuffer(), 1);
};

const loadTemplate = async (pxls, t) => {
	if(t.indexOf("#") === -1) throw new Error("need template data");
	const params = new Map(t.substring(t.indexOf("#") + 1).split("&").map(e => e.split("=")).map(e => [e[0], decodeURIComponent(e[1])]));
	const template = await decodeTemplateImage(mapPalette(pxls.palette), params.get("template"), params.get("tw"));
	return new Template(pxls, params.get("ox") || 0, params.get("oy") || 0, template.width, template.height, template.data, Date.now());
};


module.exports = {
	Template,
//	humanColor,
	templatePath,
	loadTemplate,
	loadTemplateDataFromStorage
};
