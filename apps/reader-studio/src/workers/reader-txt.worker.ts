import { scanTxtIndex, searchTxt, type TxtRange } from "../txtIndex";

self.onmessage = async (
  event: MessageEvent<{ file: Blob; ranges?: TxtRange[]; bookId: string; query: string }>,
) => {
  try {
    const { file, ranges, bookId, query } = event.data;
    const value = ranges ? await searchTxt(file, ranges, bookId, query) : await scanTxtIndex(file);
    self.postMessage({ value });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
