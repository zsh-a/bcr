import assert from "node:assert/strict";
import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const [nativePath, browserPath] = process.argv.slice(2);
if (!nativePath || !browserPath)
  throw new Error("Usage: node scripts/verify-jsg-parity.mjs NATIVE.jsonl BROWSER.json");
const fields = ["equity", "orders", "decisions"];
const history = Object.fromEntries(fields.map((name) => [name, []]));
let summary;
for await (const line of createInterface({
  input: createReadStream(nativePath),
  crlfDelay: Infinity,
})) {
  if (!line.trim()) continue;
  const event = JSON.parse(line);
  assert.equal(summary, undefined, "no events may follow the native summary");
  assert(["chunk", "summary"].includes(event.kind), "unknown native event");
  for (const name of fields) {
    assert(Array.isArray(event.data[name]), `missing native ${name}`);
    for (const row of event.data[name]) history[name].push(row);
  }
  if (event.kind === "summary") summary = event.data;
}
assert(summary, "native summary missing");
const exported = JSON.parse(readFileSync(browserPath, "utf8"));
const { timings: _timings, ...browser } = exported.result;
assert.deepEqual(browser, { ...summary, ...history });
console.log(
  `JSG native/browser parity PASSED: ${history.equity.length} days, ${history.orders.length} orders, ${history.decisions.length} decisions; all history and summary fields identical`,
);
