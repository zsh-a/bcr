import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const { TextReader, Uint8ArrayWriter, ZipWriter } = createRequire(
  new URL("../../packages/market-data/package.json", import.meta.url),
)("@zip.js/zip.js");
const minute = 60_000;

/** Official-format daily ZIPs for short, isolated browser workflow tests. */
export async function installTrendArchives(context, { start, price }) {
  const archives = new Map();
  let requests = 0;
  async function archive(url) {
    if (archives.has(url)) return archives.get(url);
    let csv;
    if (url.includes("fundingRate")) {
      csv =
        "calc_time,funding_interval_hours,last_funding_rate\n" +
        Array.from(
          { length: 93 },
          (_, i) => `${start + i * 8 * 60 * minute + 1},8,${i % 2 ? -0.0001 : 0.0001}`,
        ).join("\n");
    } else {
      const date = url.match(/(\d{4}-\d{2}-\d{2})\.zip$/)?.[1];
      assert(date, url);
      const from = Date.parse(`${date}T00:00:00Z`);
      csv = Array.from({ length: 1440 }, (_, i) => {
        const time = from + i * minute,
          open = price(time),
          close = price(time + minute);
        return `${time},${open},${Math.max(open, close) + 0.05},${Math.min(open, close) - 0.05},${close},10,${time + minute - 1},0,1,0,0,0`;
      }).join("\n");
    }
    const zip = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
    await zip.add("history.csv", new TextReader(csv), { level: 0 });
    const bytes = Buffer.from(await zip.close());
    const value = { bytes, hash: createHash("sha256").update(bytes).digest("hex") };
    archives.set(url, value);
    return value;
  }
  await context.route("https://data.binance.vision/**", async (route) => {
    const url = route.request().url(),
      checksum = url.endsWith(".CHECKSUM");
    const value = await archive(checksum ? url.slice(0, -9) : url);
    if (!checksum) requests++;
    await route.fulfill({
      status: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: checksum ? `${value.hash}  history.zip` : value.bytes,
    });
  });
  return { requestCount: () => requests };
}
