import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { generateFixture } from "../apps/quant-lab/src/jsg/fixture";

const [destination, instruments = "5000", sessions = "1250", batchDays = "20"] =
  process.argv.slice(2);
if (!destination)
  throw new Error(
    "Usage: bun scripts/generate-jsg-fixture.ts OUTPUT [INSTRUMENTS=5000] [SESSIONS=1250] [BATCH_DAYS=20]",
  );
const root = path.resolve(destination);
await mkdir(root); // Never overwrite an existing frozen snapshot.
const hashes: Record<string, string> = {};
try {
  const manifest = await generateFixture(
    { instruments: Number(instruments), sessions: Number(sessions), batchDays: Number(batchDays) },
    async (name, bytes) => {
      hashes[name] = createHash("sha256").update(bytes).digest("hex");
      await writeFile(path.join(root, name), bytes);
    },
  );
  const json = JSON.stringify(manifest);
  hashes["manifest.json"] = createHash("sha256").update(json).digest("hex");
  await writeFile(path.join(root, "manifest.pending"), json);
  await writeFile(path.join(root, "snapshot-sha256.json"), JSON.stringify(hashes, null, 2));
  await rename(path.join(root, "manifest.pending"), path.join(root, "manifest.json"));
  console.log(
    JSON.stringify({
      root,
      rows: manifest.partitions.reduce((n, p) => n + p.rows, 0),
      bytes: manifest.partitions.reduce((n, p) => n + p.bytes, 0),
    }),
  );
} catch (error) {
  await rm(root, { recursive: true });
  throw error;
}
