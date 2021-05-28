const { Interval, sum } = require("./util");

module.exports = class Histiore {
	constructor(period = Interval.DAY * 7) {
		this._data = new Uint16Array(period / Interval.MINUTE);
		this._lastWriteTime = Date.now();
	}

	_addressAstral(time = Date.now()) {
		return Math.floor(time / Interval.MINUTE);
	}

	_addressAstralToReal(address) {
		return address % this.data.length;
	}

	_addressReal(time = Date.now()) {
		return this._addressAstralToReal(this._addressAstral(time));
	}

	_clearOldData(now = Date.now(), clearValue = 0) {
		const lastAddress = this._addressAstral(this._lastWriteTime);
		const currentAddress = this._addressAstral(Date.now());

		if(lastAddress < currentAddress) {
			// we have shifted which data cell we're writing to
			// this means it probably contains some old data.

			if((currentAddress - lastAddress) >= this.data.length) {
				// all of the data is invalid
				this.data.fill(0);

				return;
			}

			const lastRealAddress = this._addressAstralToReal(lastAddress);
			const currentRealAddress = this._addressAstralToReal(currentAddress);

			if(lastRealAddress > currentRealAddress) {
				// at some point between the last and current write,
				// we hit the end of the buffer and wrapped.
				// this means we potentially need to reset data at the start
				// and at the end of the buffer.

				/*
					we have:

					[3, 2, 1, …, 1, 2, 3]
					    ^ new       ^ last

					we want:

					[0, 0, 1, …, 1, 2, 0]
					    ^ new       ^ last
				*/

				this.data.subarray(0, currentRealAddress + 1).fill(clearValue);
				this.data.subarray(lastRealAddress + 1).fill(clearValue);
			} else {
				/*
					we have:

					[3, 2, 1, 1, 2, 3]
					    ^ last   ^ new

					we want:

					[3, 2, 0, 0, 0, 3]
					    ^ last   ^ new

				*/

				this.data.subarray(lastRealAddress + 1, currentRealAddress + 1)
					.fill(clearValue);
			}
		}

		this._lastWriteTime = now;
	}

	hit() {
		const time = Date.now();
		this._clearOldData(time);
		const address = this._addressReal(time);
		this.data[address]++;
	}

	get(time = Date.now()) {
		this._clearOldData(Date.now());
		const address = this._addressReal(time);
		return this.data[address];
	}

	range(start, end = Date.now()) {
		this._clearOldData(Date.now());

		let startAddress = this._addressAstral(start);
		const endAddress = this._addressAstral(end);

		if((endAddress - startAddress) > this.data.length) {
			// we don't have enough data to fulfill the requested range

			console.warn("Requested more data than available for history");
			startAddress = endAddress - this.data.length;
		}

		const startRealAddress = this._addressAstralToReal(startAddress);
		const endRealAddress = this._addressAstralToReal(endAddress);

		if(startRealAddress > endRealAddress) {
			// the range covers data that hits the end of the buffer
			// and wraps back to the start.

			console.debug(startRealAddress, endRealAddress);
			const startData = this.data.subarray(startRealAddress);
			const endData = this.data.subarray(0, endRealAddress);

			const returnData = new Uint16Array(startData.length + endData.length);
			returnData.set(startData);
			returnData.set(endData, startData.length);
			return returnData;
		} else {
			return this.data.slice(startRealAddress, endRealAddress);
		}
	}

	recentHits(period) {
		const now = Date.now();
		return this.range(now - period, now).reduce(sum);
	}

	backfill(data, dataTime, newHits, newTime) {
		data.slice(0, this.data.length)
			.forEach((value, i) => this.data[i] = value);

		this._lastWriteTime = dataTime;

		const cells = this._addressAstral(newTime) - this._addressAstral(dataTime);

		// FIXME: since this is floored later, it often becomes wildly inaccurate.
		// the fix is to have _clearOldData accept a float value and fill appropriately.
		const hitsPerCell = newHits / cells;

		this._clearOldData(newTime, Math.floor(hitsPerCell));
	}

	get data() {
		return this._data;
	}
};
