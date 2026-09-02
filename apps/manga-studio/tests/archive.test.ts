import { describe, expect, it } from "vitest";
import { expandMangaArchive, formatForMangaFile } from "../src/archive";

describe("manga archive import", () => {
  it("recognizes image, CBZ/ZIP and PDF sources without relying on MIME", () => {
    expect(formatForMangaFile({ name: "page-01.PNG", type: "" })).toBe("image");
    expect(formatForMangaFile({ name: "volume.cbz", type: "" })).toBe("cbz");
    expect(formatForMangaFile({ name: "volume.zip", type: "application/octet-stream" })).toBe(
      "cbz",
    );
    expect(formatForMangaFile({ name: "volume.pdf", type: "" })).toBe("pdf");
  });

  it("does not treat arbitrary binary files as archives", () => {
    expect(formatForMangaFile({ name: "volume.bin", type: "application/octet-stream" })).toBe(
      "unknown",
    );
  });

  it("expands a CBZ into independently named image pages", async () => {
    const { BlobWriter, Uint8ArrayReader, ZipWriter } = await import("@zip.js/zip.js");
    const writer = new ZipWriter(new BlobWriter("application/zip"));
    await writer.add(
      "chapter/001.png",
      new Uint8ArrayReader(
        Uint8Array.from(
          atob(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          ),
          (character) => character.charCodeAt(0),
        ),
      ),
    );
    const archive = await writer.close();
    const pages = await expandMangaArchive(
      new File([archive], "sample.cbz", { type: "application/zip" }),
    );
    expect(pages).toHaveLength(1);
    expect(pages[0]?.name).toBe("sample-0001.png");
    expect(pages[0]?.type).toBe("image/png");
  });
});
