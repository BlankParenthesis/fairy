const Histoire = require("./history");
const { Interval } = require("./util");
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

		const now = Date.now();

		const history = historicalData || {
			"good": [],
			"bad": [],
			"timestamp": now,
			"progress": this.rawProgress
		};

		const badValueDelta = Math.max(history.progress - this.rawProgress, 0);
		const goodValueDelta = Math.max(this.rawProgress - history.progress, 0);

		this._histy.backfill(history.good, history.timestamp, goodValueDelta, now);
		this._croire.backfill(history.bad, history.timestamp, badValueDelta, now);
	}

	goodPixel() {
		this._histy.hit();
	}

	badPixel() {
		this._croire.hit();
	}

	_eta(window, rate) {
		if(rate >= 0) {
			return ((this.size - this.rawProgress) / rate) * window;
		} else {
			return (this.rawProgress / rate) * window;
		}
	}

	get complete() {
		return this.progress === 1;
	}

	get eta() {
		if(this.complete) return 0;
		const trackTime = Date.now() - this.started;
		const intervals = [
			Interval.MINUTE,
			Interval.MINUTE * 15,
			Interval.HOUR,
			Interval.HOUR * 4,
			Interval.HOUR * 12,
			Interval.DAY,
			Interval.DAY * 2,
			Interval.DAY * 4,
			Interval.DAY * 7
		].filter(interval => interval < trackTime);

		if(intervals.length === 0) return Infinity;

		const { rawProgress } = this;
		const remainingProgress = this.size - rawProgress;

		return intervals.map(interval => {
			const goodPixels = this._histy.recentHits(interval);
			const badPixels = this._croire.recentHits(interval);
			const progress = goodPixels - badPixels;

			const rate = progress / interval;

			let estimate;
			if(rate >= 0) {
				estimate = remainingProgress / rate;
			} else {
				// this estimate is always negative
				// and can be distinguished from the regular one.
				estimate = rawProgress / rate;
			}

			// this ratio is used to determine which estimate is closest to its interval.
			// it seems intuitive to me that this is the best estimate,
			// but I have no proof for this.
			let ratio;

			if(Math.abs(estimate) > interval) {
				ratio = estimate / interval;
			} else {
				ratio = interval / estimate;
			}

			return {
				estimate,
				interval,
				ratio
			};
		}).reduce((a, b) => a.ratio < b.ratio ? a : b).estimate;
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
		const now = Date.now();

		// rate in px/unit time (px/ms).
		// 4 px/min is considered fast
		const fast = 4 / Interval.MINUTE;
		const badPixelsSummary = badPixels.length > 0 ? `\`\`\`css\n${badPixels.slice(0, 4).map(p => `[${p.join(",")}] should be ${this.colorAt(p[0], p[1])}`).join("\n")}${badPixels.length > 4 ? "\n..." : ""}\`\`\`` : "";

		const intervals = Object.entries({
			"minute": Interval.MINUTE,
			"hour": Interval.HOUR,
			"day": Interval.DAY
		}).map(([label, interval]) => {
			const goodPixels = this._histy.recentHits(interval);
			const badPixels = this._croire.recentHits(interval);
			const progress = goodPixels - badPixels;

			const rate = Math.abs(progress) / interval;
			const isFast = rate > fast;

			let symbol;

			if(progress > 0) {
				symbol = isFast ? "⏫" : "🔼";
			} else if(progress < 0) {
				symbol = isFast ? "⏬" : "🔽";
			} else {
				symbol = "⏹";
			}

			return `${symbol} ${progress} pixels/${label}`;
		});

		const recencyDisclaimer = now - this.started < Interval.DAY ? `\n*started tracking ${humanTime(now - this.started)} ago*` : "";
		const progressSummary = this.complete ? "" : `\n\n${intervals.join("\n")}\n${eta >= 0 ? `Done in ~**${humanTime(eta)}**` : `Gone in ~**${humanTime(-eta)}**`}${recencyDisclaimer}`;
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
			"good": Array.from(this._histy.data),
			"bad": Array.from(this._croire.data),
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
	const buffer = (await got(url, { "responseType": "buffer" })).body;
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
