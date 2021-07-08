import * as path from "path";
import { URL } from "url";

import sharp = require("sharp");
import fetch from "node-fetch";
import is = require("check-types");

import { Pxls, TRANSPARENT_PIXEL } from "@blankparenthesis/pxlsspace";
import Histoire from "./history";

import { Interval, humanTime, hasTypedProperty, hashParams, hasProperty } from "./util";

import config, { FilterType } from "./config";

import { detemplatize, multiply, add, diff, mask } from "../native";

interface PxlsColor {
	name: string;
	values: [number, number, number];
}

const MEGABYTE = 10 ** 6;

const decodeTemplateImage = async (
	palette: PxlsColor[], 
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

	const buffer = await im.raw().toBuffer();

	const data = await detemplatize(
		buffer, 
		meta.width,
		meta.height, 
		ratio, ratio,
		palette,
	);

	return { width, height, data };
};

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
	readonly name: string;
	readonly source?: URL;
	
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
		name: string,
		x: number, 
		y: number, 
		width: number, 
		height: number, 
		source: URL | undefined,
		data: Uint8Array, 
		started: number, 
		historicalData: unknown = {}
	) {
		this.pxls = pxls;
		this.name = name;
		this.x = isNaN(x) ? 0 : x;
		this.y = isNaN(y) ? 0 : y;
		this.width = width;
		this.height = height;
		this.source = source;
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

	indexToPixel(i: number) {
		if(!(this.data[i] in this.pxls.palette)) {
			console.debug(i, this.data[i]);
		}

		return {
			"x": i % this.width, 
			"y": Math.floor(i / this.width),
			"color": this.pxls.palette[this.data[i]].name,
		};
	}

	get size() {
		return this.propertyCache.cache(
			"size", 
			() => diff(
				// find all non-transparent pixels
				this.data,
				add(new Uint8Array(this.data.length), TRANSPARENT_PIXEL),
			).length,
		);
	}

	get space() {
		return this.width * this.height + 2 * HISTORY_SIZE;
	}

	get placeableSize() {
		return this.propertyCache.cache(
			"placeableSize", 
			() => diff(
				multiply(
					// Normalize so transparent is 0, then multiply.
					// This results in all pixels which are transparent on either buffer being 0.
					add(this.data, -TRANSPARENT_PIXEL),
					add(this.placeableShadow, -TRANSPARENT_PIXEL),
				),
				// Comparing to an empty buffer returns a list of all non-zero indices.
				// The length of that list is the number of placeable pixels.
				new Uint8Array(this.data.length),
			).length
		);
	}

	get badPixels() {
		return this.progressCache.cache(
			"badPixels",
			() => {
				const shifted = add(this.data, -TRANSPARENT_PIXEL);
				return diff(
					shifted,
					mask(
						// we need everything to be at the same offset for comparison
						add(this.shadow, -TRANSPARENT_PIXEL),
						// use transparent pixels from this template to mask shadow
						shifted,
					),
				);
			}
		);
	}

	get rawProgress() {
		return this.size - this.badPixels.length;
	}

	get progress() {
		return this.rawProgress / this.size;
	}

	get link() {
		if(is.undefined(this.source)) {
			throw new Error("tried to generate a link for a template without a known source");
		}

		return new URL(`https://pxls.space#${
			Object.entries({
				"x": this.x + this.width / 2,
				"y": this.y + this.height / 2,
				"scale": 4,
				"tw": this.width,
				"template": this.source,
				"ox": this.x,
				"oy": this.y,
				"title": this.name,
				"oo": 1,
			}).map(e => e.map(c => encodeURIComponent(c.toString())))
				.map(e => e.join("="))
				.join("&")
		}`);
	}

	get summary() {
		const { size } = this;

		if(size === 0) {
			return "⚠ *Template is empty*";
		}

		const link = !is.undefined(this.source) ? `[template link](${this.link})\n` : "";
		const formattedProgress = parseFloat((this.progress * 100).toFixed(2));

		const unplaceablePixels = size - this.placeableSize;
		const unplaceablePixelsNotice = unplaceablePixels > 0
			? `\n⚠ *${unplaceablePixels} pixels out of bounds*`
			: "";

		const overview = `${link}`
			+ `${formattedProgress}% done\n`
			+ `${this.rawProgress} of ${size} pixels`
			+ `${unplaceablePixelsNotice}`;

		if(this.complete) {
			return `${overview}`;
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
					Array.from(badPixels.slice(0, maxExamples))
						.map(i => this.indexToPixel(i))
						.map(p => `[${p.x}, ${p.y}] should be ${p.color}`)
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

	get placeableShadow() {
		return Pxls.cropBuffer(
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
		return Pxls.cropBuffer(
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
		return Pxls.convertBufferToRGBA(this.data, this.pxls.palette);
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
		const name = params.get("title");

		if(is.undefined(template)) {
			throw new Error("Missing template source");
		}

		if(is.undefined(name)) {
			throw new Error("Missing template name");
		}

		const source = new URL(template);

		const { width, height, data } = await decodeTemplateImage(
			pxls.palette, 
			source,
			is.undefined(tw) ? undefined : parseInt(tw)
		);

		const ox = params.get("ox");
		const oy = params.get("oy");

		return new Template(
			pxls,
			name,
			is.undefined(ox) ? 0 : parseInt(ox),
			is.undefined(oy) ? 0 : parseInt(oy),
			width, 
			height, 
			source,
			data, 
			Date.now()
		);
	}

	static async from(pxls: Pxls, name: string, directory: string, persistentData: unknown) {
		if(!is.object(persistentData)) {
			throw new Error("Invalid template data");
		}
		if(!hasTypedProperty(persistentData, "x", is.number)) {
			throw new Error("Invalid template x position");
		}
		if(!hasTypedProperty(persistentData, "y", is.number)) {
			throw new Error("Invalid template y position");
		}
		if(!hasTypedProperty(persistentData, "started", is.number)) {
			throw new Error("Invalid template start time");
		}
		if(!hasProperty(persistentData, "history")) {
			throw new Error("Invalid template history");
		}

		let source;

		if(hasTypedProperty(persistentData, "source", is.string)) {
			source = new URL(persistentData.source);
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

		const data = await detemplatize(
			await im.raw().toBuffer(),
			width, height,
			1, 1, 
			pxls.palette
		);

		return new Template(
			pxls,
			name,
			persistentData.x,
			persistentData.y,
			width,
			height,
			source,
			data,
			persistentData.started,
			persistentData.history
		);
	}

	get persistent() {
		const { x, y, started, source } = this;
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
			source,
		};
	}
}
