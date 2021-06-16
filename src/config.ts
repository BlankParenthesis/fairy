import * as fs from "fs";
import * as path from "path";

import is = require("check-types");

import { LogLevel } from "./repl";
import { hasProperty, hasTypedProperty } from "./util";

export enum FilterType {
	DENY = "DENY",
	ALLOW = "ALLOW",
}

type Filter = { 
	"type": FilterType;
	"domains": string[];
}

type Config = {
	"token": string;
	"loglevel": Set<LogLevel>;
	"download": {
		"filter": Filter;
	};
}

const location = path.resolve(__dirname, "..", "config.json");

const config: unknown = JSON.parse(fs.readFileSync(location).toString());

const error = (cause: string) => new Error(`Malformed config (${cause})`);

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

config.download;

const validatedConfig: Config = config;

export default validatedConfig;
