export const sleep = (t: number) => new Promise(resolve => setTimeout(resolve, t));

export const humanTime = (t: number) => {
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
};

export const zip = <A, B>(a: ArrayLike<A>, b: ArrayLike<B>) => {
	const c: [A, B][] = new Array(a.length);
	for(let i = 0; i < a.length; i++) {
		c[i] = [a[i], b[i]];
	}
	return c;
};

export const sum = (a: number, b: number) => a + b;

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

export const hashParams = (url: string) => {
	if(url.indexOf("#") === -1) {
		throw new Error("need template data");
	}

	const entries: [string, string][] = url.substring(url.indexOf("#") + 1)
		.split("&")
		.map(e => e.split("="))
		.map(e => [e[0], decodeURIComponent(e[1])]);

	return new Map(entries);
};

export const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const hasProperty = <
	X extends {}, 
	Y extends PropertyKey
>(object: X, property: Y): object is X & Record<Y, unknown> => {
	return Object.prototype.hasOwnProperty.call(object, property);
};

export const hasTypedProperty = <
	X extends {}, 
	Y extends PropertyKey,
	T,
>(object: X, property: Y, guard: (_: unknown) => _ is T): object is X & Record<Y, T> => {
	return Object.prototype.hasOwnProperty.call(object, property)
			&& guard(object[property as keyof object]);
};