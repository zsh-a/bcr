import { scanTxtIndex, searchTxt, type TxtRange } from "../content/txtIndex";

self.onmessage = async (
  event: MessageEvent<{
    file: Blob;
    ranges?: TxtRange[];
    bookId: string;
    query: string;
    limit?: number;
  }>,
) => {
  try {
    const { file, ranges, bookId, query, limit } = event.data;
    const value = ranges
      ? await searchTxt(file, ranges, bookId, query, undefined, limit)
      : await scanTxtIndex(file);
    self.postMessage({ value });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
