import { URL } from "url";
import * as crypto from "crypto";

import sharp = require("sharp");
import is = require("check-types");

import { Pxls, TRANSPARENT_PIXEL, PxlsColor, Pixel } from "@blankparenthesis/pxlsspace";

import Histoire from "./history";
import { Interval, humanTime, SaveableAs } from "./util";
import Cache from "./cache";
import { downloadImage } from "./download";

import { multiply, add, diff, mask, index, unstylize } from "../native";

enum IndexMethod {
	EXACT,
}

class IndexedArray extends Uint8Array {
	deindex(palette: PxlsColor[]) {
		return Pxls.convertBufferToRGBA(this, palette);
	}

	static index(
		rgba: Uint8Array, 
		palette: PxlsColor[], 
		method: IndexMethod | ((pixel: Uint8Array) => number) = IndexMethod.EXACT
	) {
		if(is.function(method)) {
			const buffer = new IndexedArray(rgba.length / 4);

			for(let i = 0; i < buffer.length; i++) {
				const start = i * 4;
				buffer[i] = method(rgba.subarray(start, start + 4));
			}

			return buffer;
		} else {
			switch(method) {
			case IndexMethod.EXACT:
				return new IndexedArray(index(rgba, palette));
			default:
				throw new Error(`Unimplemented indexing method ${method}`);
			}
		}

	}
}

export class TemplateDesign {
	readonly size: number;

	constructor(
		public readonly width: number,
		public readonly height: number,
		public readonly data: IndexedArray,
	) {
		if(width * height !== data.length) {
			throw new Error("Template dimensions do not match data length");
		}

		// Size is all non-transparent pixels.
		// In other words: the number of differences between the data and
		// a buffer of only transparent pixels.
		this.size = diff(
			this.data,
			new Uint8Array(this.data.length).fill(TRANSPARENT_PIXEL),
		).length;
	}

	read(iOrX: number, y?: number) {
		let i = iOrX;

		if(!is.undefined(y)) {
			i = y * this.width + iOrX;
		}

		return {
			"x": i % this.width, 
			"y": Math.floor(i / this.width),
			"color": this.data[i],
		};
	}

	get hash() {
		return crypto.createHash("sha256")
			.update(this.data)
			.digest("hex");
	}

	async save(file: string, palette: PxlsColor[]) {
		await sharp(Buffer.from(this.data.deindex(palette)), { "raw": {
			"width": this.width,
			"height": this.height,
			"channels": 4,
		} }).toFile(file);
	}
	
	static async load(file: string, palette: PxlsColor[]) {
		const image = sharp(file).raw();

		const { width, height } = await image.metadata();

		if(is.undefined(width)) {
			throw new Error("Image defines no width");
		}
		if(is.undefined(height)) {
			throw new Error("Image defines no height");
		}

		const buffer = IndexedArray.index(
			await image.toBuffer(),
			palette,
		);

		return new TemplateDesign(width, height, buffer);
	}

	// TODO: stylize()
}

export class StylizedTemplateDesign {
	constructor(
		public readonly designWidth: number,
		public readonly designHeight: number,
		public readonly styleWidth: number,
		public readonly styleHeight: number,
		private readonly data: IndexedArray,
	) {
		if(styleWidth !== Math.round(styleWidth)) {
			throw new Error("Invalid style width for deisgn");
		}

		if(styleHeight !== Math.round(styleHeight)) {
			throw new Error("Invalid style height for design");
		}

		const expectedLength = designWidth * designHeight * styleWidth * styleHeight;
		if(expectedLength !== data.length) {
			throw new Error("Template dimensions do not match data length");
		}
	}

	unstylize(): TemplateDesign {
		let data;
		if(this.styleWidth === 1 && this.styleHeight === 1) {
			data = this.data;
		} else {
			data = new IndexedArray(unstylize(
				this.data,
				this.designWidth * this.styleWidth,
				this.designHeight * this.styleHeight,
				this.styleWidth,
				this.styleHeight,
			));
		}

		return new TemplateDesign(
			this.designWidth,
			this.designHeight,
			data,
		);
	}

	static async download(source: URL, width: number | undefined, palette: PxlsColor[]) {
		const image = await downloadImage(source);

		const designWidth = is.undefined(width) ? image.width : width;
		const designHeight = designWidth / image.width * image.height;

		const styleWidth = image.width / designWidth;
		const styleHeight = image.height / designHeight;

		return new StylizedTemplateDesign(
			designWidth,
			designHeight,
			styleWidth,
			styleHeight,
			IndexedArray.index(image.data, palette),
		);
	}
}

export class Template {
	constructor(
		readonly design: TemplateDesign,
		readonly x: number,
		readonly y: number,
		readonly title?: string,
		readonly source?: URL,
	) {}

	get width() {
		return this.design.width;
	}

	get height() {
		return this.design.height;
	}

	get size() {
		return this.design.size;
	}

	get link() {
		if(is.undefined(this.source)) {
			throw new Error("tried to generate a link for a template without a source");
		}

		return new URL(`https://pxls.space#${
			Object.entries({
				"x": this.x + this.width / 2,
				"y": this.y + this.height / 2,
				"scale": 4,
				"template": this.source,
				"ox": this.x,
				"oy": this.y,
				"tw": this.width,
				"title": this.title,
				"oo": 1,
			}).filter((e): e is [string, Exclude<typeof e[1], undefined>] => !is.undefined(e[1]))
				.map(e => e.map(c => encodeURIComponent(c.toString())))
				.map(e => e.join("="))
				.join("&")
		}`);
	}

	get data() {
		return this.design.data;
	}

	redesigned(design: TemplateDesign) {
		return new Template(design, this.x, this.y, this.title, this.source);
	}
	
	repositioned(x: number, y: number) {
		return new Template(this.design, x, y, this.title, this.source);
	}
	
	retitled(title?: string) {
		return new Template(this.design, this.x, this.y, title, this.source);
	}
	
	resourced(source?: URL) {
		return new Template(this.design, this.x, this.y, this.title, source);
	}
}

const HISTORY_RANGE = Interval.DAY * 7;
const HISTORY_SIZE = HISTORY_RANGE / Interval.MINUTE;

interface Activity {
	positive: number[];
	neutral: number[];
	negative: number[];
	timestamp: number;
}

export class TemplateActivity {
	// https://neptunia.fandom.com/wiki/Histoire
	// > Histoire (イストワール, Isutowāru) is the personified form of the tome 
	// > that contains the history of Gamindustri. She was created for the 
	// > task of documenting the world's history within her pages.
	private histy = new Histoire(HISTORY_RANGE);
	// can't think of a good Neptunia analogue here…
	private neutral = new Histoire(HISTORY_RANGE);
	private croire = new Histoire(HISTORY_RANGE);

	private timestamp: number;

	constructor(activity: Partial<Activity>) {
		this.timestamp = activity.timestamp || Date.now();

		if(!is.undefined(activity.positive)) {
			this.histy.backfill(new Uint16Array(activity.positive), this.timestamp);
		}

		if(!is.undefined(activity.neutral)) {
			this.neutral.backfill(new Uint16Array(activity.neutral), this.timestamp);
		}

		if(!is.undefined(activity.negative)) {
			this.croire.backfill(new Uint16Array(activity.negative), this.timestamp);
		}
	}

	update(positive: number, neutral: number, negative: number, time = Date.now()) {
		this.histy.hit(positive, time);
		this.neutral.hit(neutral, time);
		this.croire.hit(negative, time);

		this.timestamp = time;
	}

	recent(period: number) {
		return {
			"positive": this.histy.recentHits(period),
			"neutral": this.neutral.recentHits(period),
			"negative": this.croire.recentHits(period),
		};
	}

	toJSON(): SaveableAs<Required<Activity>> {
		return {
			"positive": this.histy,
			"neutral": this.neutral,
			"negative": this.croire,
			"timestamp": this.timestamp,
		};
	}
}

const TRACKED_INTERVALS = [
	Interval.MINUTE,
	Interval.MINUTE * 15,
	Interval.HOUR,
	Interval.HOUR * 4,
	Interval.HOUR * 12,
	Interval.DAY,
	Interval.DAY * 2,
	Interval.DAY * 4,
	Interval.DAY * 7,
];

type PixelSync = Map<number, Pixel & { oldColor: number }>;

export class TrackableTemplate extends Template {
	private readonly history: TemplateActivity;

	private lastProgress: number;
	readonly placeableSize: number;
	private placeableShadow: Uint8Array;
	private progressCache = new Cache();

	constructor(
		private pxls: Pxls,
		design: TemplateDesign,
		x: number,
		y: number,
		readonly started: number,
		activity?: Partial<Activity>,
		lastProgress?: number,
	) {
		super(design, x, y);

		const { progress } = this;
		this.history = new TemplateActivity(activity || {});
		if(is.undefined(lastProgress)) {
			this.lastProgress = progress;
		} else {
			this.lastProgress = lastProgress;
			this.sync();
		}

		this.placeableShadow = this.pxls.cropPlacemap(
			this.x,
			this.y,
			this.width,
			this.height,
		);
		
		this.placeableSize = diff(
			multiply(
				// Normalize so transparent is 0, then multiply.
				// This results in all pixels which are transparent on either buffer being 0.
				add(this.data, -TRANSPARENT_PIXEL),
				add(this.placeableShadow, -TRANSPARENT_PIXEL),
			),
			// Comparing to an empty buffer returns a list of all non-zero indices.
			// The length of that list is the number of placeable pixels.
			new Uint8Array(this.data.length),
		).length;
	}

	sync(changes?: PixelSync) {
		this.progressCache.invalidate();

		if(is.undefined(changes)) {
			const { progress } = this;

			const positive = Math.max(progress - this.lastProgress, 0);
			const neutral = Math.abs(progress - this.lastProgress);
			const negative = Math.max(this.lastProgress - progress, 0);

			this.history.update(positive, negative, neutral);

			this.lastProgress = progress;
		} else {
			const { positive, neutral, negative } = Array.from(changes.entries())
				.reduce((counts, [i, change]) => {
					const wasCorrect = this.design.data[i] === change.oldColor;
					const becameCorrect = this.design.data[i] === change.color;

					if(wasCorrect) {
						counts.negative += 1;
					} else if(becameCorrect) {
						counts.positive += 1;
					} else {
						counts.neutral += 1;
					}

					return counts;
				}, { "positive": 0, "neutral": 0, "negative": 0 });
			
			this.history.update(positive, negative, neutral);

			this.lastProgress += positive - negative;
		}
	}

	recentActivity(interval: number) {
		return this.history.recent(interval);
	}

	get complete() {
		return this.progress === this.size;
	}

	get progress() {
		return this.size - this.differences.length;
	}

	get eta() {
		if(this.complete) {
			return 0;
		}

		const trackTime = Date.now() - this.started;
		const intervals = TRACKED_INTERVALS.filter(interval => interval < trackTime);
		intervals.push(trackTime);

		const { size, progress } = this;
		const remainingProgress = size - progress;

		return intervals.map(interval => {
			const activity = this.history.recent(interval);
			const change = activity.positive - activity.negative;

			const rate = change / interval;

			let estimate;
			if(rate >= 0) {
				estimate = remainingProgress / rate;
			} else {
				// this estimate is always negative
				// and can be distinguished from the regular one.
				estimate = progress / rate;
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

	get shadow() {
		return this.pxls.cropCanvas(
			this.x,
			this.y,
			this.width,
			this.height,
		);
	}

	get differences() {
		return this.progressCache.cache(
			"differences",
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

	sample(localX: number, localY: number) {
		const x = this.x + localX;
		const y = this.y + localY;

		const transparent: PxlsColor = {
			"values": [0, 0, 0],
			"name": "transparent",
		};

		const canvasIndex = this.pxls.canvas[x * this.pxls.width + y];
		const canvasColor = canvasIndex === TRANSPARENT_PIXEL
			? transparent
			: this.pxls.palette[canvasIndex];
		const designIndex = this.design.data[localX * this.design.width + localY];
		const designColor = designIndex === TRANSPARENT_PIXEL
			? transparent
			: this.pxls.palette[designIndex];

		return { x, y, canvasColor, designColor };
	}

	/**
	 * An approximation of the memory used by this template
	 */
	get space() {
		return this.width * this.height + 3 * HISTORY_SIZE * 2;
	}

	toJSON(): SaveableAs<Required<SavedTemplate>> {
		const { x, y, width, height, history, lastProgress, started } = this;

		return {
			x, 
			y, 
			width, 
			height, 
			started,
			history,
			"progress": lastProgress,
		};
	}
}

export class TrackedTemplate {
	constructor(
		readonly template: TrackableTemplate,
		readonly name: string,
		readonly source?: URL,
	) {
		
	}

	get link() {
		return this.template
			.retitled(this.name)
			.resourced(this.source)
			.link;
	}

	get summary() {
		const { size } = this.template;

		if(size === 0) {
			return "⚠ *Template is empty*";
		}

		const { progress } = this.template;

		const link = !is.undefined(this.source) ? `[template link](${this.inline})\n` : "";
		const formattedProgress = parseFloat((progress / size * 100).toFixed(2));

		const unplaceablePixels = size - this.template.placeableSize;
		const unplaceablePixelsNotice = unplaceablePixels > 0
			? `\n⚠ *${unplaceablePixels} pixels out of bounds*`
			: "";

		const overview = `${link}`
			+ `${formattedProgress}% done\n`
			+ `${progress} of ${size} pixels`
			+ `${unplaceablePixelsNotice}`;

		if(this.template.complete) {
			return `${overview}`;
		} else {
			const { differences, eta } = this.template;
			const now = Date.now();

			// rate in px/unit time (px/ms).
			// 4 px/min is considered fast
			const fast = 4 / Interval.MINUTE;
			const maxExamples = 4;
			const ellipsize = differences.length > maxExamples ? "\n..." : "";
			const differencesSummary = differences.length > 0
				? `\`\`\`css\n${
					Array.from(differences.slice(0, maxExamples))
						.map(i => this.template.design.read(i))
						.map(({ x, y }) => this.template.sample(x, y))
						.map(({ x, y, designColor }) => `[${x}, ${y}] should be ${designColor.name}`)
						.join("\n")
				}${ellipsize}\`\`\``
				: "";

			const intervals = Object.entries({
				"minute": Interval.MINUTE,
				"hour": Interval.HOUR,
				"day": Interval.DAY,
			}).map(([label, interval]) => {
				const activity = this.template.recentActivity(interval);
				const progress = activity.positive - activity.negative;

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

			const recencyDisclaimer = now - this.template.started < Interval.DAY
				? `\n*started tracking ${humanTime(now - this.template.started)} ago*`
				: "";
			const progressSummary = this.template.complete
				? ""
				: `\n\n${intervals.join("\n")}\n${
					eta >= 0
						? `Done in ~**${humanTime(eta)}**`
						: `Gone in ~**${humanTime(-eta)}**`
				}${recencyDisclaimer}`;

			return `${overview}`
				+ `${progressSummary}`
				+ `${differencesSummary}`;
		}
	}

	get inline() {
		if(is.undefined(this.source)) {
			return this.name;
		} else {
			return `[${this.name}](${this.link})`;
		}
	}

	toJSON(): SaveableAs<SavedTrackedTemplate> {
		const { name, source } = this;

		return {
			...this.template.toJSON(),
			name, 
			source,
		};
	}
}

export interface SavedTemplate {
	x: number;
	y: number;
	width: number;
	height: number;
	started?: number;
	history?: Partial<Activity>;
	progress?: number;
}

export interface SavedTrackedTemplate extends SavedTemplate {
	name: string;
	source?: URL;
}