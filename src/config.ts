import * as fs from "fs";
import * as path from "path";

import is = require("check-types");

import { LogLevel } from "./repl";
import { hasProperty, hasTypedProperty, Interval } from "./util";

export enum FilterType {
	DENY = "DENY",
	ALLOW = "ALLOW",
}

type Filter = { 
	type: FilterType;
	domains: string[];
}

type Limiter = {
	interval: number;
	limit: number;
}

function parseLimiter(l: unknown) {
	if(!is.object(l)) {
		throw new Error("limit not an object");
	}

	if(!hasTypedProperty(l, "limit", is.number)) {
		throw new Error("limitor has missing or invalid limit");
	}

	const limit = l.limit;

	let interval;

	if(hasTypedProperty(l, "interval", is.string)) {
		interval = Interval.parse(l.interval);
	} else if(hasTypedProperty(l, "interval", is.number)) {
		interval = l.interval;
	} else {
		throw new Error("limitor has missing or invalid interval");
	}

	return { interval, limit };
}

type InteractionLimiter = {
	user: Limiter[];
	server: Limiter[];
}

type Config = {
	token: string;
	loglevel: Set<LogLevel>;
	download: {
		filter: Filter;
	};
	interaction: {
		limiter: InteractionLimiter;
	};
}

const location = path.resolve(__dirname, "..", "config.json");

const config: unknown = JSON.parse(fs.readFileSync(location).toString());

function error(cause: string) {
	return new Error(`Malformed config (${cause})`);
}

if(!is.object(config)) {
	throw error("root not an object");
}

if(!hasTypedProperty(config, "token", is.string)) {
	throw error("missing token");
}

if(!hasProperty(config, "loglevel")) {
	throw error("missing loglevel");
}

config.loglevel = ((levels): Set<LogLevel> => {
	if(is.array(levels)) {
		return new Set(levels.map(level => {
			if(is.number(level)) {
				return level;
			} else if(is.string(level)) {
				return (LogLevel as any)[level.toUpperCase()];
			} else {
				throw new Error(`Unknown log level: ${level}`);
			}
		}));
	} else if(is.number(levels)) {
		return new Set(Array(levels + 1).fill(0).map((_, i) => i));
	} else if(is.string(levels)) {
		const level = (LogLevel as any)[levels.toUpperCase()];
		return new Set(Array(level + 1).fill(0).map((_, i) => i));
	} else if(is.object(levels)) {
		return new Set(Array.from(Object.entries(levels))
			.filter(([k, v]) => v)
			.map(([k, v]) => (LogLevel as any)[k.toUpperCase()]));
	} else {
		return new Set([
			LogLevel.LOG,
			LogLevel.INFO,
			LogLevel.ERROR,
			LogLevel.WARN,
			LogLevel.DEBUG,
		]);
	}

})(config.loglevel);

// HACK: Typescript can't seem to imply enough about the types to infer the
// later cast to `Config` as safe. Here we blindly guard that it is safe.
// This was preferred over an explicit cast later as `Config` may expand
// and having Typescript notify us about missing properties is a good thing.
if(!hasTypedProperty(config, "loglevel", (_): _ is Set<LogLevel> => true)) {
	throw new Error("assertion failed: config loglevel typetrick");
}

if(!hasTypedProperty(config, "download", is.object)) {
	throw error("missing download section");
}

if(!hasTypedProperty(config.download, "filter", is.object)) {
	throw error("missing download filter section");
}

config.download.filter = ((filter): Filter => {
	if(is.like(filter, { "type": "", "domains": [""] })
		&& filter.type.toUpperCase() in FilterType
	) {
		return { 
			"type": (FilterType as any)[filter.type.toUpperCase()],
			"domains": filter.domains,
		};
	} else {
		console.warn("Config domain filter format invalid");
		return { 
			"type": FilterType.DENY, 
			"domains": [],
		};
	}
})(config.download.filter);

// HACK: see above
if(!hasTypedProperty(config, "download", (_): _ is { "filter": Filter } => true)) {
	throw new Error("assertion failed: config download filter typetrick");
}

if(!hasTypedProperty(config, "interaction", is.object)) {
	throw error("missing interaction section");
}

if(!hasTypedProperty(config.interaction, "limiter", is.object)) {
	throw error("missing interaction limiter section");
}

config.interaction.limiter = ((limiter): InteractionLimiter => {
	try {
		if(is.like(limiter, { "user": [], "server": [] })) {
			return {
				"user": limiter.user.map(parseLimiter),
				"server": limiter.server.map(parseLimiter),
			};
		} else {
			throw new Error("interaction limitor section lacks limiter definitions");
		}
	} catch(e) {
		console.warn(`Config interaction limiter format invalid: ${e.message}`);
		return { 
			"user": [
				{ "interval": 10 * Interval.MINUTE, "limit": 50 },
				{ "interval": Interval.DAY, "limit": 500 },
			], 
			"server": [
				{ "interval": 10 * Interval.MINUTE, "limit": 200 },
				{ "interval": Interval.DAY, "limit": 2000 },
			],
		};
	}
})(config.interaction.limiter);

// HACK: see above
if(!hasTypedProperty(config, "interaction", (_): _ is { "limiter": InteractionLimiter } => true)) {
	throw new Error("assertion failed: config interaction limiter typetrick");
}

const validatedConfig: Config = config;

export default validatedConfig;
