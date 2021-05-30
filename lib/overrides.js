/* eslint-disable no-invalid-this */
const defineMethod = (obj, name, value) => Object.defineProperty(
	obj.prototype,
	name,
	{ value }
);

defineMethod(Array, "contains", function(...xs) {
	return xs.every(x => this.indexOf(x) !== -1);
});

defineMethod(Map, "map", function(f) {
	return [...this.entries()].map(a => f(a[0], a[1]));
});


defineMethod(Map, "mapValues", function(f) {
	return [...this.values()].map(f);
});

defineMethod(Map, "mapKeys", function(f) {
	return [...this.keys()].map(f);
});

defineMethod(Object, "map", function(f) {
	return Object.entries(this).map(a => f(a[0], a[1]));
});
