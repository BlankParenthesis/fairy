import { Interval, sum } from "./util";

class RollingBuffer extends Uint16Array {
	constructor(size: number) {
		super(size);
	}

	at(address: number) {
		return this[address % this.length];
	}

	put(address: number, value: number) {
		this[address % this.length] = value;
	}

	set(array: ArrayLike<number>, offset: number) {
		for(let i = 0; i < array.length; i++) {
			this[(offset + i) % this.length] = array[i];
		}
	}

	*range(start: number, end: number) {
		const clippedStart = Math.max(end - this.length, start);

		for(let i = clippedStart; i < end; i++) {
			yield this.at(i);
		}
	}
}

function * distributeIntValue(total: number, count: number) {
	const quotient = Math.floor(total / count);
	const remainder = total % count;

	let currentRemainder = 0;

	for(let i = 0; i < count; i++) {
		currentRemainder += remainder;

		const extra = Math.floor(currentRemainder / count);

		yield quotient + extra;

		currentRemainder %= count;
	}

	console.assert(currentRemainder === 0);
}

export default class Histoire {
	private data: RollingBuffer;
	private lastWriteTime: number;

	constructor(period = Interval.DAY * 7) {
		this.data = new RollingBuffer(period / Interval.MINUTE);
		this.lastWriteTime = Date.now();
	}

	private static address(time = Date.now()) {
		return Math.floor(time / Interval.MINUTE);
	}

	private fillData(addValue: number, now = Date.now()) {
		const lastAddress = Histoire.address(this.lastWriteTime);
		const currentAddress = Histoire.address(now);

		if(lastAddress < currentAddress) {
			// we have shifted which data cell we're writing to
			// this means it probably contains some old data.
		
			const cells = currentAddress - lastAddress;
			const values = distributeIntValue(addValue, cells);
			
			this.data.set([...values], lastAddress + 1);
		} else {
			const value = this.data.at(currentAddress) + addValue;
			this.data.put(currentAddress, value);
		}

		this.lastWriteTime = now;
	}

	hit(delta: number, time = Date.now()) {
		this.fillData(delta, time);
	}

	get(time = Date.now()) {
		const address = Histoire.address(time);
		return this.data.at(address);
	}

	range(start: number, end = Date.now()) {
		const startAddress = Histoire.address(start);
		const endAddress = Histoire.address(end);

		return new Uint16Array(this.data.range(startAddress, endAddress));
	}

	recentHits(period: number) {
		const now = Date.now();
		const rangeEnd = Math.min(now, this.lastWriteTime + Interval.MINUTE);
		return this.range(now - period, rangeEnd).reduce(sum, 0);
	}

	backfill(data: Uint16Array, dataTime: number) {
		Uint16Array.prototype.set.call(this.data, data);
		this.lastWriteTime = dataTime;
	}

	copyData() {
		return new Uint16Array(this.data);
	}

	toJSON() {
		return Array.from(this.data);
	}
}
