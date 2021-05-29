const sleep = t => new Promise(resolve => setTimeout(resolve, t));

const humanTime = t => {
	let time = t / 1000; //seconds
	if(time < 120) return `${Math.round(time)} second${Math.round(time) === 1 ? "" : "s"}`;
	time /= 60; //minutes
	if(time < 180) return `${Math.round(time)} minute${Math.round(time) === 1 ? "" : "s"}`;
	time /= 60; //hours
	if(time < 48) return `${Math.round(time)} hour${Math.round(time) === 1 ? "" : "s"}`;
	time /= 24; //days
	return `${Math.round(time)} day${Math.round(time) === 1 ? "" : "s"}`;
};

const zip = (a, b) => {
	const c = new Array(a.length);
	for(let i = 0; i < a.length; i++) {
		c[i] = [a[i], b[i]];
	}
	return c;
};

const sum = (a, b) => a + b;

const Interval = (() => {
	const SECOND = 1000;
	const MINUTE = 60 * SECOND;
	const HOUR = 60 * MINUTE;
	const DAY = 24 * HOUR;
	return {
		SECOND,
		MINUTE,
		HOUR,
		DAY
	};
})();

const hashParams = url => {
	if(url.indexOf("#") === -1) {
		throw new Error("need template data");
	}

	const entries = url.substring(url.indexOf("#") + 1)
		.split("&")
		.map(e => e.split("="))
		.map(e => [e[0], decodeURIComponent(e[1])]);

	return new Map(entries);
};

const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

module.exports = {
	sleep,
	humanTime,
	zip,
	sum,
	Interval,
	hashParams,
	escapeRegExp
};
