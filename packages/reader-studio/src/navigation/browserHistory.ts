import type { ReaderHistoryEntry } from "../state/model";
import { getReaderState, reader } from "../state/store";

const KEY = "bcrReaderPosition";
const REMEMBER = "bcr-reader-remember-position";
export const READER_HISTORY_REQUEST = "bcr-reader-history-request";

/** Reader jumps share the browser stack; passive scrolling updates only its current entry. */
export function connectReaderBrowserHistory(): () => void {
  const previous = history.state?.[KEY];
  const session = typeof previous?.session === "string" ? previous.session : crypto.randomUUID();
  let depth = Number.isInteger(previous?.depth) ? previous.depth : 0;
  let maximum = Number.isInteger(previous?.maximum) ? Math.max(depth, previous.maximum) : depth;
  let pending = false;
  let consuming = false;
  let navigation = getReaderState().navigationSequence;
  let lastProgress = getReaderState().progressByBook;
  const position = (): ReaderHistoryEntry | undefined => {
    const state = getReaderState();
    const locator = state.activeBookId
      ? state.progressByBook[state.activeBookId]?.locator
      : undefined;
    return state.activeBookId && locator ? { bookId: state.activeBookId, locator } : undefined;
  };
  const write = (entry: ReaderHistoryEntry | undefined, push = false) => {
    if (!entry) return;
    const state = { ...history.state, [KEY]: { session, depth, maximum, entry } };
    if (push) history.pushState(state, "");
    else history.replaceState(state, "");
  };
  write(position());
  const remember = (event: Event) => {
    write((event as CustomEvent<ReaderHistoryEntry>).detail);
    pending = true;
  };
  const unsubscribe = reader.subscribe(() => {
    const state = getReaderState();
    if (consuming) {
      navigation = state.navigationSequence;
      lastProgress = state.progressByBook;
      return;
    }
    if (pending && navigation !== state.navigationSequence) {
      pending = false;
      depth++;
      maximum = depth;
      write(position(), true);
    } else if (!pending && lastProgress !== state.progressByBook) write(position());
    navigation = state.navigationSequence;
    lastProgress = state.progressByBook;
  });
  const request = (event: Event) => {
    const detail = (
      event as CustomEvent<{ direction: "back" | "forward"; distance: number; handled: boolean }>
    ).detail;
    const available = detail.direction === "back" ? depth : maximum - depth;
    if (available < detail.distance) return;
    detail.handled = true;
    history.go((detail.direction === "back" ? -1 : 1) * detail.distance);
  };
  const pop = (event: PopStateEvent) => {
    const target = event.state?.[KEY];
    if (target?.session !== session || !Number.isInteger(target.depth)) return;
    const entry = target.entry as ReaderHistoryEntry | undefined;
    if (!entry || !getReaderState().library.some((book) => book.id === entry.bookId)) return;
    event.stopImmediatePropagation();
    consuming = true;
    try {
      const distance = target.depth - depth;
      if (distance)
        reader.navigateHistory(distance < 0 ? "back" : "forward", Math.abs(distance), true);
      if (getReaderState().activeBookId !== entry.bookId)
        reader.openBook(entry.bookId, undefined, false);
      reader.seekLocator(entry.locator);
      depth = target.depth;
      maximum = Math.max(maximum, depth);
      pending = false;
      write(entry);
    } finally {
      consuming = false;
    }
  };
  window.addEventListener(REMEMBER, remember);
  window.addEventListener(READER_HISTORY_REQUEST, request);
  window.addEventListener("popstate", pop, true);
  return () => {
    unsubscribe();
    window.removeEventListener(REMEMBER, remember);
    window.removeEventListener(READER_HISTORY_REQUEST, request);
    window.removeEventListener("popstate", pop, true);
  };
}
