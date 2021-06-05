import is = require("check-types");

import { Interval, sum } from "./util";

export default class Histiore {
	private data: Uint16Array;
	private lastWriteTime: number;

	constructor(period = Interval.DAY * 7) {
		this.data = new Uint16Array(period / Interval.MINUTE);
		this.lastWriteTime = Date.now();
	}

	private static addressAstral(time = Date.now()) {
		return Math.floor(time / Interval.MINUTE);
	}

	private addressAstralToReal(address: number) {
		return address % this.data.length;
	}

	private addressReal(time = Date.now()) {
		return this.addressAstralToReal(Histiore.addressAstral(time));
	}

	private fillData(addValue: number, now = Date.now()) {
		let lastAddress = Histiore.addressAstral(this.lastWriteTime);
		const currentAddress = Histiore.addressAstral(now);

		const currentRealAddress = this.addressAstralToReal(currentAddress);

		if(lastAddress < currentAddress) {
			// we have shifted which data cell we're writing to
			// this means it probably contains some old data.
		
			const cells = currentAddress - lastAddress;

			const values = (function* (total: number, count: number): Generator<number, void, number | undefined> {
				const quotient = Math.floor(total / count);
				const remainder = total % count;

				let currentRemainder = 0;

				for(let i = 0; i < count; i++) {
					currentRemainder += remainder;

					const extra = Math.floor(currentRemainder / count);

					const skip = yield quotient + extra;

					if(!is.undefined(skip) && skip > 0) {
						i += skip;
						currentRemainder += remainder * skip;
					}

					currentRemainder %= count;
				}

				console.assert(currentRemainder === 0);
			})(addValue, cells);

			if((currentAddress - lastAddress) >= this.data.length) {
				// all of the data is invalid

				const skip = cells - this.data.length;
				if(skip > 0) {
					// The first next call executes up to the first yield only — 
					// so it never gets the skip argument.
					values.next();
					if(skip > 1) {
						// On the second next call, the generator has already yielded two values.
						// Since we want to skip by `skip` and have already skipped two, 
						// we subtract two.
						values.next(skip - 2);
					}
				}

				lastAddress = currentAddress - this.data.length;
			}

			const lastRealAddress = this.addressAstralToReal(lastAddress);

			const newData = new Uint16Array(values);

			const filledAndWrapped = lastRealAddress === currentRealAddress
			// if the address is at the end of the data, it's not wrapped.
				&& lastRealAddress !== this.data.length;

			// NOTE: on addresses — since we don't want to include the old address,
			//       we add one to all addresses before use.
			if(lastRealAddress > currentRealAddress || filledAndWrapped) {
				// at some point between the last and current write,
				// we hit the end of the buffer and wrapped.
				// this means we potentially need to reset data at the start
				// and at the end of the buffer.

				/*
					we have:

					[3, 2, 1, …, 1, 2, 3]
					    ^ new       ^ last

					we want:

					[X, X, 1, …, 1, 2, X]
					    ^ new       ^ last
				*/

				const headSize = this.data.length - (lastRealAddress + 1);
				const tailSize = currentRealAddress + 1;
				
				const headData = newData.subarray(0, headSize);
				this.data.subarray(lastRealAddress + 1).set(headData);

				const tailData = newData.subarray(headSize, headSize + tailSize);
				this.data.subarray(0, currentRealAddress + 1).set(tailData);
			} else {
				/*
					we have:

					[3, 2, 1, 1, 2, 3]
					    ^ last   ^ new

					we want:

					[3, 2, X, X, X, 3]
					    ^ last   ^ new

				*/

				this.data.subarray((lastRealAddress + 1) % this.data.length, currentRealAddress + 1)
					.set(newData);
			}
		} else {
			this.data[currentRealAddress] += addValue;
		}

		this.lastWriteTime = now;
	}

	hit(delta: number, time = Date.now()) {
		this.fillData(delta, time);
	}

	get(time = Date.now()) {
		const address = this.addressReal(time);
		return this.data[address];
	}

	range(start: number, end = Date.now()) {
		let startAddress = Histiore.addressAstral(start);
		const endAddress = Histiore.addressAstral(end);

		if((endAddress - startAddress) > this.data.length) {
			// we don't have enough data to fulfill the requested range

			console.warn("Requested more data than available for history");
			startAddress = endAddress - this.data.length;
		}

		const startRealAddress = this.addressAstralToReal(startAddress);
		const endRealAddress = this.addressAstralToReal(endAddress);

		if(startRealAddress > endRealAddress) {
			// the range covers data that hits the end of the buffer
			// and wraps back to the start.

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

	recentHits(period: number) {
		const now = Date.now();
		return this.range(now - period, now).reduce(sum);
	}

	backfill(data: Uint16Array, dataTime: number) {
		this.data.set(data);
		this.lastWriteTime = dataTime;
	}

	copyData() {
		return new Uint16Array(this.data);
	}
}
