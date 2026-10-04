import { initWasm, Resvg } from "@resvg/resvg-wasm";
import wasmUrl from "@resvg/resvg-wasm/index_bg.wasm?url";
import converter from "fonteditor-core/lib/ttf/woff2ttf";
import { unzlibSync } from "fflate";
let initialized: Promise<void> | undefined;
// The converter publishes CommonJS; dev prebundling and production interop differ.
const woff2ttf = typeof converter === "function" ? converter : converter.default;

/** Explicit font bytes make export independent of the machine's installed fonts. */
export async function renderPng(svg: string, font: Uint8Array): Promise<Uint8Array> {
  initialized ??= initWasm(fetch(wasmUrl)).catch((error: unknown) => {
    initialized = undefined;
    throw error;
  });
  await initialized;
  // resvg accepts OpenType/TrueType, whereas the shared UI font ships as WOFF.
  // Only import the converter, avoiding fonteditor's optional Node/WOFF2 runtime.
  const bytes = font.slice().buffer;
  const header = new DataView(bytes);
  if (bytes.byteLength < 44 || header.getUint32(0) !== 0x774f4646)
    throw new Error("导出字体必须是有效的 WOFF 字体");
  if (header.getUint32(16) > 32 * 1024 * 1024 || header.getUint16(12) > 100)
    throw new Error("导出字体超出容量限制");
  const sfnt = woff2ttf(bytes, {
    inflate: (compressed) => unzlibSync(new Uint8Array(compressed)),
  });
  const renderer = new Resvg(svg, {
    font: { fontBuffers: [new Uint8Array(sfnt)], defaultFontFamily: "IBM Plex Sans SC" },
  });
  const rendered = renderer.render();
  try {
    return rendered.asPng();
  } finally {
    rendered.free();
    renderer.free();
  }
}
