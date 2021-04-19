const moment = require("moment");

class SeasonalEmote {
	constructor(name) {
		this.name = name;
		this.alts = [];
	}
	/**
	 * @param {String} name - the name of the alt
	 * @param {Date} start - a date on which to start the altername emote (year is ignored)
	 * @param {Number} length - ms duration to last
	 * @return {SeasonalEmote} - this
	 */
	add(name, start, length) {
		this.alts.push({
			name,
			start,
			length
		});

		return this;
	}

	get current() {
		const date = moment();

		for(const alt of this.alts) {
			for(const offset of [-1, 0, 1]) {
				const delta = date.year(alt.start.getFullYear() + offset).diff(alt.start);
				if(delta > 0 && delta < alt.length) {
					return alt.name;
				}
			}
		}

		return this.name;
	}

	get tilNext() {
		const date = moment();

		let best = -Infinity;

		for(const alt of this.alts) {
			for(const offset of [-1, 0, 1]) {
				const delta = date.year(alt.start.getFullYear() + offset).diff(alt.start);
				if(delta < 0) {
					best = Math.max(best, delta);
				}
			}
		}

		return Math.abs(best);
	}

	has(emote) {
		return this.name === emote || this.alts.some(alt => alt.name === emote);
	}
}

module.exports = {
	SeasonalEmote
};
