import * as is from "check-types";

export function sleep(t: number) {
	return new Promise(resolve => setTimeout(resolve, t));
}

// TODO: replace with discord's fancy timestamp embeds (<t:186491862412837>)
export function humanTime(t: number) {
	let time = t / 1000; // seconds
	if(time < 120) {
		return `${Math.round(time)} second${Math.round(time) === 1 ? "" : "s"}`;
	}
	time /= 60; // minutes
	if(time < 180) {
		return `${Math.round(time)} minute${Math.round(time) === 1 ? "" : "s"}`;
	}
	time /= 60; // hours
	if(time < 48) {
		return `${Math.round(time)} hour${Math.round(time) === 1 ? "" : "s"}`;
	}
	time /= 24; // days
	return `${Math.round(time)} day${Math.round(time) === 1 ? "" : "s"}`;
}

export function zip<A, B>(a: ArrayLike<A>, b: ArrayLike<B>) {
	const c: [A, B][] = new Array(a.length);
	for(let i = 0; i < a.length; i++) {
		c[i] = [a[i], b[i]];
	}
	return c;
}

export function sum(a: number, b: number) {
	return a + b;
}

// TODO: create time module or use new ECMA time stuff

export const Interval = (() => {
	const SECOND = 1000;
	const MINUTE = 60 * SECOND;
	const HOUR = 60 * MINUTE;
	const DAY = 24 * HOUR;
	return {
		SECOND,
		MINUTE,
		HOUR,
		DAY,
		parse(s: string) {
			const [valueString, unit] = s.split(/\s+/);

			const value = parseFloat(valueString);

			if(isNaN(value)) {
				throw new Error("parsed NaN value as interval");
			}

			switch(unit.toLowerCase()) {
			case "second":
			case "seconds":
				return value * SECOND;
			case "minute":
			case "minutes":
				return value * MINUTE;
			case "hour":
			case "hours":
				return value * HOUR;
			case "day":
			case "days":
				return value * DAY;
			default:
				throw new Error("parsed interval with unknown unit");
			}
		},
	};
})();

export function hashParams(url: string) {
	if(url.indexOf("#") === -1) {
		throw new Error("need template data");
	}

	const entries: [string, string][] = url.substring(url.indexOf("#") + 1)
		.split("&")
		.map(e => e.split("="))
		.map(e => [e[0], decodeURIComponent(e[1])]);

	return Object.fromEntries(entries);
}

export function escapeRegExp(s: string) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasProperty <
	X extends {}, 
	Y extends PropertyKey
>(object: X, property: Y): object is X & Record<Y, unknown> {
	return Object.prototype.hasOwnProperty.call(object, property);
}

export function hasTypedProperty <
	X extends {}, 
	Y extends PropertyKey,
	T,
>(object: X, property: Y, guard: (_: unknown) => _ is T): object is X & Record<Y, T> {
	return Object.prototype.hasOwnProperty.call(object, property)
			&& guard(object[property as keyof object]);
}

export function parseIntOrDefault <T>(string: string | undefined, defaultValue: T) {
	let parsed;
	if(is.undefined(string) || isNaN(parsed = parseInt(string))) {
		return defaultValue;
	} else {
		return parsed;
	}
}

export type SaveableAs<To> = {
	[K in keyof To]: To[K] extends (infer I)[] 
	? SaveableAs<I>[] | To[K] | {
		"toJSON": () => To[K] | SaveableAs<To[K]>;
	}
	: To[K] | {
		"toJSON": () => To[K] | SaveableAs<To[K]>;
	};
};
