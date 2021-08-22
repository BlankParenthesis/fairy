import { URL } from "url";

import is = require("check-types");

import { 
	Pxls, 
	TRANSPARENT_PIXEL, 
	PxlsColor, 
	Pixel, 
	Template, 
	TemplateDesign, 
	Buffer2D,
} from "@blankparenthesis/pxlsspace";

import Histoire from "./history";
import { Interval, humanTime, SaveableAs } from "./util";
import Cache from "./cache";

import { Summarizable } from "./summary";

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

	toJSON(): SaveableAs<Activity> {
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
	private readonly placeableSizePrecomputed: number;
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
		
		this.placeableSizePrecomputed = super.placeableSize(pxls.placemap);
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
			
			this.history.update(positive, neutral, negative);

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
		return this.size - this.differences_().length;
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
		return this.pxls.canvas.crop(
			this.x,
			this.y,
			this.width,
			this.height,
		);
	}

	differences_() {
		return this.progressCache.cache(
			"differences",
			() => this.differences(this.pxls.canvas)
		);
	}

	placeableSize_() {
		return this.placeableSizePrecomputed;
	}

	sample(localX: number, localY: number) {
		const x = this.x + localX;
		const y = this.y + localY;

		const transparent: PxlsColor = {
			"values": [0, 0, 0],
			"name": "transparent",
		};

		const canvasIndex = this.pxls.canvas.get(x, y);
		const canvasColor = canvasIndex === TRANSPARENT_PIXEL
			? transparent
			: this.pxls.palette[canvasIndex];
		const designIndex = this.design.get(localX, localY);
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

	toJSON(): SaveableAs<SavedTrackableTemplate> {
		const { x, y, history, lastProgress, started } = this;

		return {
			x, 
			y, 
			started,
			history,
			"progress": lastProgress,
			"design": this.design.hash,
		};
	}

	equals(other: unknown) {
		return other instanceof TrackableTemplate
			&& this.pxls === other.pxls
			&& super.equals(other);
	}
}

export class TrackedTemplate implements Summarizable {
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
			.link();
	}

	get summary() {
		const { size } = this.template;

		if(size === 0) {
			return "⚠ *Template is empty*";
		}

		const { progress } = this.template;

		const link = !is.undefined(this.source) ? `[template link](${this.link})\n` : "";
		const formattedProgress = parseFloat((progress / size * 100).toFixed(2));

		const unplaceablePixels = size - this.template.placeableSize_();
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
			const { eta } = this.template;
			const differences = this.template.differences_();
			const now = Date.now();

			// rate in px/unit time (px/ms).
			// 4 px/min is considered fast
			const fast = 4 / Interval.MINUTE;
			const maxExamples = 4;
			const ellipsize = differences.length > maxExamples ? "\n..." : "";
			const differencesSummary = differences.length > 0
				? `\`\`\`css\n${
					Array.from(differences.slice(0, maxExamples))
						.map(i => this.template.design.indexToPosition(i))
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
			return `[${this.name}](<${this.link}>)`;
		}
	}

	toJSON(): SaveableAs<SavedTrackedTemplate> {
		const { name, source } = this;

		const { x, y } = this.template;
		const design = this.template.design.hash;

		const template = { design, x, y };

		return { name, source, template };
	}
}

export interface SavedTemplate {
	/**
	 * The hash of the design
	 */
	design: string;
	x: number;
	y: number;
	title?: string;
	source?: string;
}

export interface SavedTrackableTemplate extends SavedTemplate {
	started: number;
	history: Partial<Activity>;
	progress: number;
}

export interface SavedTrackedTemplate {
	name: string;
	source?: string;
	template: SavedTemplate;
}
