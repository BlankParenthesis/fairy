class Frequency {
	constructor(time, value) {
		Object.defineProperty(this, "window", {
			"enumerable": false,
			"configurable": false,
			"writable": false,
			"value": time
		});

		this.hits = value;
	}
}

module.exports = class Histiore {
	constructor() {
		this.values = new Map();
	}

	track(name, timeWindow, valueDelta, lastKnownvalue, lastKnownTimestamp) {
		const timeDelta = Date.now() - lastKnownTimestamp;
		const gainedValue = Math.ceil(valueDelta * Math.min(1, Math.max(0, (2 - (timeDelta / timeWindow)))));
		const legacyValue = Math.ceil(lastKnownvalue * Math.min(1, Math.max(0, (1 - (timeDelta / timeWindow)))));

		this.values.set(name, new Frequency(timeWindow, gainedValue + legacyValue));

		this.decay(name, legacyValue, timeWindow - timeDelta);
		this.decay(name, gainedValue, Math.max(0, timeDelta - timeWindow));
	}

	get(name) {
		return this.values.get(name).hits;
	}

	hit(name) {
		const freq = this.values.get(name);
		freq.hits++;
		setTimeout(() => freq.hits--, freq.window);
	}

	hitAll() {
		[...this.values.keys()].forEach(this.hit.bind(this));
	}

	decay(name, value, time) {
		if(value < 1) return;
		const freq = this.values.get(name);
		let remainingValue = value;
		const i = setInterval(() => {
			freq.hits--;
			if(--remainingValue === 0) clearInterval(i);
		}, time / value);
	}
};
