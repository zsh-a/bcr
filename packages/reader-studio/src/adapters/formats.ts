import { READER_FORMAT_CATALOG, readerAcceptAttribute, type ReaderFormat } from "@bcr/reader-core";

export function formatForFile(file: Pick<File, "name" | "type">): ReaderFormat {
  const extension = file.name.split(".").pop()?.toLocaleLowerCase() ?? "";
  const byExtension = READER_FORMAT_CATALOG.find((descriptor) =>
    descriptor.extensions.includes(`.${extension}`),
  );
  if (byExtension !== undefined) return byExtension.format;
  const byMime = READER_FORMAT_CATALOG.find((descriptor) =>
    descriptor.mimeTypes.includes(file.type.toLocaleLowerCase()),
  );
  if (byMime !== undefined) return byMime.format;
  return "unknown";
}

export { readerAcceptAttribute };

export function displayFormat(format: ReaderFormat): string {
  return format === "markdown" ? "MARKDOWN" : format.toUpperCase();
}
