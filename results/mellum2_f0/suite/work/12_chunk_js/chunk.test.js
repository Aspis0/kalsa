const assert = require("assert");
const { chunk } = require("./chunk");

assert.deepStrictEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
assert.deepStrictEqual(chunk([], 3), []);
assert.deepStrictEqual(chunk([1], 1), [[1]]);
let threw = false;
try { chunk([1], 0); } catch (e) { threw = e instanceof RangeError; }
assert.strictEqual(threw, true);
console.log("ok");
