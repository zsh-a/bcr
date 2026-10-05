/** Original deterministic transition accents. Recreate with `bun tools/generate-audio.mjs`. */
import { writeFileSync, mkdirSync } from "node:fs";
const rate = 48000,
  duration = 0.55,
  count = Math.round(rate * duration);
const directory = new URL("../public/audio/", import.meta.url);
mkdirSync(directory, { recursive: true });
for (const name of ["accent", "sweep"]) {
  const data = Buffer.alloc(44 + count * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    const t = i / rate,
      p = t / duration;
    const envelope = Math.sin(Math.PI * p) ** 2 * Math.exp(-p * 5);
    const value =
      name === "accent"
        ? (Math.sin(2 * Math.PI * 660 * t) + 0.35 * Math.sin(2 * Math.PI * 990 * t)) * envelope
        : Math.sin(2 * Math.PI * (170 * t + 620 * t * t)) * Math.sin(Math.PI * p) ** 3 * 0.4;
    data.writeInt16LE(Math.round(value * 18000), 44 + i * 2);
  }
  writeFileSync(new URL(`${name}.wav`, directory), data);
}
