const assert = require("assert");
const { deepGet } = require("./deepGet");

const obj = { a: { b: [{ c: 3 }, { c: 4 }] } };
assert.strictEqual(deepGet(obj, "a.b.0.c"), 3);
assert.strictEqual(deepGet(obj, "a.b.1.c"), 4);
assert.strictEqual(deepGet(obj, "a.x"), undefined);
assert.strictEqual(deepGet(obj, ""), obj);
assert.strictEqual(deepGet(null, "a"), undefined);
console.log("ok");
