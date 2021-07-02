import * as fs from "fs";
import * as path from "path";
import { URL } from "url";

import sharp = require("sharp");
import fetch from "node-fetch";
import is = require("check-types");

import { Pxls, TRANSPARENT_PIXEL } from "pxls";
import Histoire from "./history";

import { Interval, humanTime, zip, hashParams, hasProperty, sleep } from "./util";

import config, { FilterType } from "./config";

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

	const lineLength = w * scale;
	// the offset in the row
	const subpixelX = (i % w) * scale;
	// the start address of the row
	const subpixelY = Math.floor(i / w) * lineLength * scale;

	for(let x = 0; x < scale; x++) {
		for(let y = 0; y < scale; y++) {
			if(i === 0 && x === 0 && y === 0 && data[3] < 64) {
				// Zoda's pxlsFiddle puts a special pixel here to determine the scale, don't count such a pixel as a vote
				continue;
			}
			// shift left (<< 2) multiplies by 4 — the number of bytes per pixel.
			const subpixelAddresss = (subpixelX + subpixelY + x + (y * lineLength)) << 2;
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

// can be tuned — this is the initial arbitrary value
const MAX_SIMULTANEOUS_AREA_DECODES = 1000;

const decodeTemplateData = async (
	palette: MappedPalette, 
	w: number, 
	h: number, 
	data: Buffer, 
	scale: number
) => {
	const canvasImage = new Uint8Array(w * h);
	let counter = 0;

	for(let i = 0; i < w * h; i++) {
		canvasImage.set([determinePalleteInArea(palette, w, h, data, scale, i)], i);

		counter = counter + 1;
		if(counter > MAX_SIMULTANEOUS_AREA_DECODES) {
			counter = 0;
			// yield the thread — let other things work
			await sleep(0);
		}
	}
	return canvasImage;
};

const MEGABYTE = 10 ** 6;

const decodeTemplateImage = async (
	palette: MappedPalette, 
	url: URL, 
	tw: number | undefined
) => {
	const urlIsKnown = config.download.filter.domains.includes(url.hostname);
	const wantKnownURL = config.download.filter.type === FilterType.ALLOW;

	if(urlIsKnown !== wantKnownURL) {
		let message = `Untrusted template source “${url.hostname}”`;

		if(config.download.filter.type === FilterType.ALLOW) {
			message += ` (trusted domains: ${config.download.filter.domains.join(", ")})`;
		}

		throw new Error(message);
	}

	const template = await fetch(url, {
		// full global template, custom symbols: ~~6.7 MB~~ about 10MB (6.7 was webp)
		"size": 16 * MEGABYTE,
	});

	const im = sharp(await template.buffer());
	const meta = await im.metadata();

	if(is.undefined(meta.width)) {
		throw new Error("Template i mage defines no width");
	}
	if(is.undefined(meta.height)) {
		throw new Error("Template image defines no height");
	}

	const ratio = (!is.undefined(tw) && tw > 0) ? meta.width / tw : 1;
	if(ratio !== Math.round(ratio)) {
		throw new Error("Refusing to process template with non-integer scale");
	}

	const width = meta.width / ratio;
	const height = meta.height / ratio; 
	const data = await decodeTemplateData(
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

const HISTORY_SIZE = (Interval.DAY * 7 / Interval.MINUTE);

class Cache {
	private store = new Map<string, any>();

	cache<T>(key: string, compute: () => T): T {
		let value = this.store.get(key) as T;

		if(is.undefined(value)) {
			value = compute();
			this.store.set(key, value);
		}

		return value;
	}
	
	invalidate() {
		this.store.clear();
	}
}

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

	private lastCompletion: number;

	private progressCache = new Cache();
	private propertyCache = new Cache();

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

		if(is.object(historicalData)) {
			if(hasProperty(historicalData, "progress") && is.number(historicalData.progress)) {
				this.lastCompletion = historicalData.progress;
			} else {
				this.lastCompletion = this.rawProgress;
			}

			if(hasProperty(historicalData, "good") && Array.isArray(historicalData.good)) {
				const data = new Uint16Array(historicalData.good);

				if(hasProperty(historicalData, "timestamp") && is.number(historicalData.timestamp)) {
					this.histy.backfill(data, historicalData.timestamp);
				} else {
					this.histy.backfill(data, now);
				}
			}

			if(hasProperty(historicalData, "bad") && Array.isArray(historicalData.bad)) {
				const data = new Uint16Array(historicalData.bad);

				if(hasProperty(historicalData, "timestamp") && is.number(historicalData.timestamp)) {
					this.croire.backfill(data, historicalData.timestamp);
				} else {
					this.croire.backfill(data, now);
				}
			}
		} else {
			this.lastCompletion = this.rawProgress;
		}

		this.sync(now);
	}

	sync(time = Date.now()) {
		this.progressCache.invalidate();
		const progress = this.rawProgress;
		const goodValueDelta = Math.max(progress - this.lastCompletion, 0);
		const badValueDelta = Math.max(this.lastCompletion - progress, 0);
		this.histy.hit(goodValueDelta, time);
		this.croire.hit(badValueDelta, time);
		this.lastCompletion = progress;
	}

	goodPixel() {
		this.progressCache.invalidate();
		this.histy.hit(1);
		this.lastCompletion += 1;
	}

	badPixel() {
		this.progressCache.invalidate();
		this.croire.hit(1);
		this.lastCompletion -= 1;
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
			Interval.DAY * 7,
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
				ratio,
			};
		}).reduce((a, b) => a.ratio < b.ratio ? a : b).estimate;
	}

	bounds(x: number, y: number) {
		return !(x < this.x || y < this.y || x >= this.x + this.width || y >= this.y + this.height);
	}

	at(x: number, y: number) {
		return this.bounds(x, y) ? this.data[x - this.x + ((y - this.y) * this.width)] : TRANSPARENT_PIXEL;
	}

	colorAt(x: number, y: number) {
		return this.pxls.palette[this.at(x, y)].name;
	}

	get size() {
		return this.propertyCache.cache(
			"size", 
			() => this.data.filter(b => b !== TRANSPARENT_PIXEL).length,
		);
	}

	get space() {
		return this.width * this.height + 2 * HISTORY_SIZE;
	}

	get placeableSize() {
		return this.propertyCache.cache(
			"placeableSize", 
			() => zip(this.data, this.placeableShadow)
				.reduce(
					(count, [pixel, placeable]) => 
						(placeable === 0 && pixel !== TRANSPARENT_PIXEL)
							? count + 1
							: count,
					0
				),
		);
	}

	get badPixels() {
		return this.progressCache.cache(
			"badPixels",
			() => {
				const data = zip(this.data, this.shadow);
				const bads = [];
				for(let x = 0; x < this.width; x++) {
					for(let y = 0; y < this.height; y++) {
						const i = x + (y * this.width);
						if(data[i][0] !== TRANSPARENT_PIXEL && data[i][0] !== data[i][1]) {
							bads.push([x + this.x, y + this.y]);
						}
					}
				}
				return bads;
			}
		);
	}

	get rawProgress() {
		return this.progressCache.cache(
			"rawProgress",
			() => zip(this.data, this.shadow)
				.filter(v => v[1] !== TRANSPARENT_PIXEL && v[0] === v[1])
				.length,
		);
	}

	get progress() {
		return this.rawProgress / this.size;
	}

	get summary() {
		const { size } = this;

		if(size === 0) {
			return "⚠ *Template is empty*";
		}

		const unplaceablePixels = size - this.placeableSize;

		const unplaceablePixelsNotice = unplaceablePixels > 0
			? `\n⚠ *${unplaceablePixels} pixels out of bounds*`
			: "";

		const formattedProgress = parseFloat((this.progress * 100).toFixed(2));
		const overview = `${formattedProgress}% done\n`
			+ `${this.rawProgress} of ${size} pixels`
			+ `${unplaceablePixelsNotice}`;

		if(this.complete) {
			return overview;
		} else {
			const { badPixels, eta } = this;
			const now = Date.now();

			// rate in px/unit time (px/ms).
			// 4 px/min is considered fast
			const fast = 4 / Interval.MINUTE;
			const maxExamples = 4;
			const ellipsize = badPixels.length > maxExamples ? "\n..." : "";
			const badPixelsSummary = badPixels.length > 0
				? `\`\`\`css\n${
					badPixels.slice(0, maxExamples)
						.map(p => `[${p.join(",")}] should be ${this.colorAt(p[0], p[1])}`)
						.join("\n")
				}${ellipsize}\`\`\``
				: "";

			const intervals = Object.entries({
				"minute": Interval.MINUTE,
				"hour": Interval.HOUR,
				"day": Interval.DAY,
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

			return `${overview}`
				+ `${progressSummary}`
				+ `${badPixelsSummary}`;
		}
	}

	private static safelyCropBuffer(
		buffer: Uint8Array, 
		bufferWidth: number, 
		bufferHeight: number, 
		x: number, 
		y: number, 
		width: number, 
		height: number, 
		blankFill: number,
	) {
		// use only negative offsets (and make them positive)
		const putOffsetX = Math.max(-x, 0);
		const putOffsetY = Math.max(-y, 0);
		
		// use only positive offsets
		const takeOffsetX = Math.max(x, 0);
		const takeOffsetY = Math.max(y, 0);

		const availableWidth = bufferWidth - takeOffsetX;
		const availableHeight = bufferHeight - takeOffsetY;

		const croppedDataWidth = Math.min(width - putOffsetX, availableWidth);
		const croppedDataHeight = Math.min(height - putOffsetY, availableHeight);

		const croppedBuffer = new Uint8Array(width * height);
		croppedBuffer.fill(blankFill);

		for(let y = 0; y < croppedDataHeight; y++) {
			const takeLocation = (y + takeOffsetY) * bufferWidth + takeOffsetX;
			const putLocation = (y + putOffsetY) * width + putOffsetX;
			const row = buffer.subarray(takeLocation, takeLocation + croppedDataWidth);
			croppedBuffer.set(row, putLocation);
		}

		return croppedBuffer;
	}

	get placeableShadow() {
		return Template.safelyCropBuffer(
			this.pxls.placemap, 
			this.pxls.width,
			this.pxls.height,
			this.x,
			this.y,
			this.width,
			this.height,
			1,
		);
	}

	get shadow() {
		return Template.safelyCropBuffer(
			this.pxls.canvas, 
			this.pxls.width,
			this.pxls.height,
			this.x,
			this.y,
			this.width,
			this.height,
			TRANSPARENT_PIXEL,
		);
	}

	get rgba() {
		const rgba = new Uint8Array((this.width * this.height) << 2);
		const { palette } = this.pxls;
		const { data } = this;
		const len = data.length << 2;

		for(let i = 0; i < len; i += 4) {
			if(palette[data[i >> 2]]) {
				rgba.set(palette[data[i >> 2]].values, i);
				// set the alpha value
				rgba[i + 3] = 255;
			}
		}
		return rgba;
	}

	async save(file: string) {
		const { width, height } = this;

		await sharp(this.rgba as Buffer, { "raw": {
			width,
			height,
			"channels": 4,
		} }).toFile(file);
	}

	static async download(pxls: Pxls, templateURL: string) {
		const params = hashParams(templateURL);

		const template = params.get("template");
		const tw = params.get("tw");

		if(is.undefined(template)) {
			throw new Error("Missing template source");
		}

		const { width, height, data } = await decodeTemplateImage(
			mapPalette(pxls.palette), 
			new URL(template),
			is.undefined(tw) ? undefined : parseInt(tw)
		);

		const ox = params.get("ox");
		const oy = params.get("oy");

		return new Template(
			pxls, 
			is.undefined(ox) ? 0 : parseInt(ox),
			is.undefined(oy) ? 0 : parseInt(oy),
			width, 
			height, 
			data, 
			Date.now()
		);
	}

	static async from(pxls: Pxls, name: string, directory: string, persistentData: unknown) {
		if(!is.object(persistentData)) {
			throw new Error("Invalid template data");
		}
		if(!hasProperty(persistentData, "x") || !is.number(persistentData.x)) {
			throw new Error("Invalid template x position");
		}
		if(!hasProperty(persistentData, "y") || !is.number(persistentData.y)) {
			throw new Error("Invalid template y position");
		}
		if(!hasProperty(persistentData, "started") || !is.number(persistentData.started)) {
			throw new Error("Invalid template start time");
		}
		if(!hasProperty(persistentData, "history")) {
			throw new Error("Invalid template history");
		}

		const imagePath = path.resolve(directory, `${name}.png`);

		const im = sharp(imagePath);
		const { width, height } = await im.metadata();

		if(is.undefined(width)) {
			throw new Error("Template image defines no width");
		}
		if(is.undefined(height)) {
			throw new Error("Template image defines no height");
		}

		const data = await decodeTemplateData(
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
			"progress": this.rawProgress,
		};

		return {
			x,
			y,
			started,
			history,
		};
	}
}
