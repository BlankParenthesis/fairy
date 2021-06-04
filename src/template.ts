import { PNG } from "pngjs";
import * as fs from "fs";
import sharp = require("sharp");
import got from "got";
import * as path from "path";

import Pxls = require("pxls");
import Histoire from "./history";
import { Interval } from "./util";

import { humanTime, zip, hashParams, isObject, hasProperty } from "./util";

const compressRGB = (arr: ArrayLike<number>) => (arr[0] << 16) | (arr[1] << 8) | arr[0];

interface PxlsColor {
	name: string;
	values: [number, number, number];
}

type MappedPalette = Map<number, string>;

const determinePalleteInArea = (
	palette: MappedPalette, 
	w: number, 
	h: number, 
	data: Buffer, 
	scale: number, 
	i: number
) => {
	const votes = (new Array(palette.size)).fill(0);

	for(let x = 0; x < scale; x++) {
		for(let y = 0; y < scale; y++) {
			if(i === 0 && x === 0 && y === 0 && data[3] < 64) {
				// Zoda's pxlsFiddle puts a special pixel here to determine the scale, don't count such a pixel as a vote
				continue;
			}
			const subpixelAddresss = ((((i % w) * scale) + (Math.floor(i / w) * w * scale * scale) + x + (y * w * scale)) << 2);
			if(data.readUInt8(subpixelAddresss + 3) === 0) {
				// pixel is transparent
				continue;
			}
			const pixel = compressRGB(data.slice(subpixelAddresss, subpixelAddresss + 3));
			
			if(palette.has(pixel)) {
				// unknown -> number conversion is safe here because we checked "has" above.
				votes[palette.get(pixel) as unknown as number] += 1;
			}
		}
	}

	let bestI = 0;
	for(let j = 1; j < votes.length; j++) {
		if(votes[j] > votes[bestI]) {
			bestI = j;
		}
	}

	return votes[bestI] > 0 ? bestI : 255;
};

const decodeTemplateData = (
	palette: MappedPalette, 
	w: number, 
	h: number, 
	data: Buffer, 
	scale: number
) => {
	const canvasImage = new Uint8Array(w * h);
	for(let i = 0; i < w * h; i++) {
		canvasImage.set([determinePalleteInArea(palette, w, h, data, scale, i)], i);
	}
	return canvasImage;
};

const decodeTemplateImage = async (
	palette: MappedPalette, 
	url: string, 
	tw: number | undefined
) => {
	const buffer = (await got(url, { "responseType": "buffer" })).body;
	const im = sharp(buffer);
	const meta = await im.metadata();

	if(typeof meta.width === "undefined") {
		throw new Error("Template image defines no width");
	}
	if(typeof meta.height === "undefined") {
		throw new Error("Template image defines no height");
	}

	const ratio = typeof tw !== "undefined" && tw > 0 ? meta.width / tw : 1;
	if(ratio !== Math.round(ratio)) {
		throw new Error("Refusing to process template with non-integer scale");
	}

	const width = meta.width / ratio;
	const height = meta.height / ratio; 
	const data = decodeTemplateData(
		palette, 
		width,
		height, 
		await im.raw().toBuffer(), 
		ratio
	);

	return { width, height, data };
};

const mapPalette = (palette: PxlsColor[]): MappedPalette => new Map(
	Object.entries(palette)
		.map(e => [compressRGB(e[1].values), e[0]])
);

export default class Template {
	private pxls: Pxls;

	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	
	readonly started: number;
	private data: Uint8Array;

	// https://neptunia.fandom.com/wiki/Histoire
	// > Histoire (イストワール, Isutowāru) is the personified form of the tome 
	// > that contains the history of Gamindustri. She was created for the 
	// > task of documenting the world's history within her pages.
	private histy = new Histoire();
	private croire = new Histoire();

	constructor(
		pxls: Pxls, 
		x: number, 
		y: number, 
		width: number, 
		height: number, 
		data: Uint8Array, 
		started: number, 
		historicalData: unknown = {}
	) {
		this.pxls = pxls;
		this.x = isNaN(x) ? 0 : x;
		this.y = isNaN(y) ? 0 : y;
		this.width = width;
		this.height = height;
		this.started = started || Date.now();
		this.data = data;

		const now = Date.now();

		if(isObject(historicalData)) {
			if(hasProperty(historicalData, "good") && Array.isArray(historicalData.good)) {
				const data = new Uint16Array(historicalData.good);

				if(hasProperty(historicalData, "timestamp") && typeof historicalData.timestamp === "number"
					&& hasProperty(historicalData, "progress") && typeof historicalData.progress === "number"
				) {
					const goodValueDelta = Math.max(this.rawProgress - historicalData.progress, 0);
					this.histy.backfill(
						data, 
						historicalData.timestamp, 
						goodValueDelta,
						now,
					);
				} else {
					this.histy.backfill(data, now, 0, now);
				}
			}

			if(hasProperty(historicalData, "bad") && Array.isArray(historicalData.bad)) {
				const data = new Uint16Array(historicalData.bad);

				if(hasProperty(historicalData, "timestamp") && typeof historicalData.timestamp === "number"
					&& hasProperty(historicalData, "progress") && typeof historicalData.progress === "number"
				) {
					const badValueDelta = Math.max(historicalData.progress - this.rawProgress, 0);
					this.croire.backfill(
						data, 
						historicalData.timestamp, 
						badValueDelta,
						now,
					);
				} else {
					this.histy.backfill(data, now, 0, now);
				}
			}
		}
	}

	goodPixel() {
		this.histy.hit();
	}

	badPixel() {
		this.croire.hit();
	}

	private etaFromWindow(window: number, rate: number) {
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
		if(this.complete) {
			return 0;
		}

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

		if(intervals.length === 0) {
			return Infinity;
		}

		const { rawProgress } = this;
		const remainingProgress = this.size - rawProgress;

		return intervals.map(interval => {
			const goodPixels = this.histy.recentHits(interval);
			const badPixels = this.croire.recentHits(interval);
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

	bounds(x: number, y: number) {
		return !(x < this.x || y < this.y || x >= this.x + this.width || y >= this.y + this.height);
	}

	at(x: number, y: number) {
		return this.bounds(x, y) ? this.data[x - this.x + ((y - this.y) * this.width)] : 255;
	}

	colorAt(x: number, y: number) {
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
				if(data[i][0] !== 255 && data[i][0] !== data[i][1]) {
					bads.push([x + this.x, y + this.y]);
				}
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
		const ellipsize = badPixels.length > 4 ? "\n..." : "";
		const badPixelsSummary = badPixels.length > 0
			? `\`\`\`css\n${
				badPixels.slice(0, 4)
					.map(p => `[${p.join(",")}] should be ${this.colorAt(p[0], p[1])}`)
					.join("\n")
			}${ellipsize}\`\`\``
			: "";

		const intervals = Object.entries({
			"minute": Interval.MINUTE,
			"hour": Interval.HOUR,
			"day": Interval.DAY
		}).map(([label, interval]) => {
			const goodProgress = this.histy.recentHits(interval);
			const badProgress = this.croire.recentHits(interval);
			const progress = goodProgress - badProgress;

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

		const recencyDisclaimer = now - this.started < Interval.DAY
			? `\n*started tracking ${humanTime(now - this.started)} ago*`
			: "";
		const progressSummary = this.complete
			? ""
			: `\n\n${intervals.join("\n")}\n${
				eta >= 0
					? `Done in ~**${humanTime(eta)}**`
					: `Gone in ~**${humanTime(-eta)}**`
			}${recencyDisclaimer}`;

		const formattedProgress = parseFloat((this.progress * 100).toFixed(2));
		return `${formattedProgress}% done\n`
			+ `${this.rawProgress} of ${this.size} pixels`
			+ `${progressSummary}`
			+ `${badPixelsSummary}`;
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
			if(palette[data[i >> 2]]) {
				rgba.set(palette[data[i >> 2]].values, i);
			} else {
				rgba.set([0, 0, 0, 0], i);
			}
		}
		return rgba;
	}

	get png() {
		const image = new PNG({ "width": this.width, "height": this.height });
		image.data.set(this.rgba);
		return image.pack();
	}

	async save(file: string) {
		return await new Promise(resolve => {
			this.png.pipe(fs.createWriteStream(file)).once("finish", resolve);
		});
	}

	static async download(pxls: Pxls, templateURL: string) {
		const params = hashParams(templateURL);

		const template = params.get("template");
		const tw = params.get("tw");

		if(typeof template === "undefined") {
			throw new Error("Missing template source");
		}

		const { width, height, data } = await decodeTemplateImage(
			mapPalette(pxls.palette), 
			template,
			typeof tw === "undefined" ? undefined : parseInt(tw)
		);

		const ox = params.get("ox");
		const oy = params.get("oy");

		return new Template(
			pxls, 
			typeof ox === "undefined" ? 0 : parseInt(ox),
			typeof oy === "undefined" ? 0 : parseInt(oy),
			width, 
			height, 
			data, 
			Date.now()
		);
	}

	static async from(pxls: Pxls, name: string, directory: string, persistentData: unknown) {
		if(!isObject(persistentData)) {
			throw new Error("Invalid template data");
		}
		if(!hasProperty(persistentData, "x") || typeof persistentData.x !== "number") {
			throw new Error("Invalid template x position");
		}
		if(!hasProperty(persistentData, "y") || typeof persistentData.y !== "number") {
			throw new Error("Invalid template y position");
		}
		if(!hasProperty(persistentData, "started") || typeof persistentData.started !== "number") {
			throw new Error("Invalid template start time");
		}
		if(!hasProperty(persistentData, "history")) {
			throw new Error("Invalid template history");
		}

		const imagePath = path.resolve(directory, `${name}.png`);

		const im = sharp(imagePath);
		const { width, height } = await im.metadata();

		if(typeof width === "undefined") {
			throw new Error("Template image defines no width");
		}
		if(typeof height === "undefined") {
			throw new Error("Template image defines no height");
		}

		const data = decodeTemplateData(
			mapPalette(pxls.palette),
			width,
			height,
			await im.raw().toBuffer(),
			1
		);

		return new Template(
			pxls,
			persistentData.x,
			persistentData.y,
			width,
			height,
			data,
			persistentData.started,
			persistentData.history
		);
	}


	get persistent() {
		const { x, y, started } = this;
		const history = {
			"good": Array.from(this.histy.copyData()),
			"bad": Array.from(this.croire.copyData()),
			"timestamp": Date.now(),
			"progress": this.rawProgress
		};

		return {
			x,
			y,
			started,
			history
		};
	}
}