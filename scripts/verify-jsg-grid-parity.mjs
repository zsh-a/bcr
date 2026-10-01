import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const [nativePath, browserPath] = process.argv.slice(2);
if (!nativePath || !browserPath)
  throw new Error(
    "Usage: node scripts/verify-jsg-grid-parity.mjs NATIVE_GRID.json BROWSER_EXPERIMENT.json",
  );
const native = JSON.parse(readFileSync(nativePath, "utf8"));
const browser = JSON.parse(readFileSync(browserPath, "utf8")).result;
assert.equal(native.decodedRows, browser.decodedRows);
assert.equal(native.results.length, browser.results.length);
let maxAnnualizedDifference = 0;
for (const [index, expected] of native.results.entries()) {
  const actual = browser.results[index];
  assert.deepEqual(actual.config, expected.config);
  assert.deepEqual(Object.keys(actual.metrics).sort(), Object.keys(expected.metrics).sort());
  for (const [key, value] of Object.entries(expected.metrics)) {
    if (key === "annualizedReturn") {
      // Native libm powf and WASM's exponentiation can differ by a few binary rounding units.
      const difference = Math.abs(value - actual.metrics[key]);
      assert(
        difference <= 1e-12 * Math.max(1, Math.abs(value)),
        `annualized return mismatch in combination ${index + 1}`,
      );
      maxAnnualizedDifference = Math.max(maxAnnualizedDifference, difference);
    } else
      assert.deepEqual(actual.metrics[key], value, `${key} mismatch in combination ${index + 1}`);
  }
}
console.log(
  `JSG grid parity PASSED: ${native.results.length} configs; all metric fields exact except annualized return (max difference ${maxAnnualizedDifference})`,
);
