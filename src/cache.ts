import * as is from "check-types";

export default class Cache {
	private store = new Map<string, any>();

	cache<T>(key: string, compute: () => T): T {
		let value = this.store.get(key) as T;

		if(is.undefined(value)) {
			value = compute();
			this.store.set(key, value);
		}

		return value;
	}
	
	invalidate() {
		this.store.clear();
	}
}