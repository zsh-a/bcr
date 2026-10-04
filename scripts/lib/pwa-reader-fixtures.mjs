import { requireFrom } from "./paths.mjs";
const { BlobWriter, TextReader, ZipWriter } = requireFrom("reader")("@zip.js/zip.js");

export async function sharedEpub() {
  const zip = new ZipWriter(new BlobWriter("application/epub+zip"));
  for (const [path, text] of Object.entries({
    mimetype: "application/epub+zip",
    "META-INF/container.xml":
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    "book.opf":
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">offline-share</dc:identifier><dc:title>Offline EPUB</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
    "chapter.xhtml":
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Offline EPUB</title></head><body><h1>Offline EPUB</h1><p>Shared EPUB content is available offline.</p></body></html>',
  }))
    await zip.add(path, new TextReader(text));
  return {
    name: "offline.epub",
    mime: "application/epub+zip",
    bytes: [...new Uint8Array(await (await zip.close()).arrayBuffer())],
  };
}
export function sharedPdf() {
  const stream = "BT /F1 20 Tf 30 700 Td (Offline shared PDF) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 750] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text));
    text += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { name: "offline.pdf", mime: "application/pdf", text };
}
