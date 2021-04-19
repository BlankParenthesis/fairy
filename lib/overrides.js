/* eslint-disable no-extend-native */
Array.prototype.contains = function(...xs) {
	return xs.every(x => this.indexOf(x) !== -1);
};

Map.prototype.map = function(f) {
	return [...this.entries()].map(a => f(a[0], a[1]));
};

Object.prototype.map = function(f) {
	return Object.entries(this).map(a => f(a[0], a[1]));
};
