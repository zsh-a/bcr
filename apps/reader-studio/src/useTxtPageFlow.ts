import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createLocator, resolveTextAnchor, type ReaderBook } from "@bcr/reader-core";
import type { ReaderSettings } from "./model";
import { reader, getReaderState } from "./store";
import { TxtPageLayout, type TxtPage, type TxtPageCursor } from "./txtPageLayout";
import { createTxtPageMeasurement } from "./txtPageMeasurement";
import { animatePageTurn } from "./pageTurnMotion";
import { pageTextHeight } from "./pagination";
import { useSectionsContent } from "./useSectionContent";

export interface TxtPageSpread {
  readonly pages: readonly TxtPage[];
  readonly start: TxtPageCursor;
  readonly end: TxtPageCursor;
}
interface PageMotion {
  from: TxtPageSpread;
  to: TxtPageSpread;
  direction: number;
  finish: () => void;
}
interface TxtFlowSession {
  turn: (direction: number) => void;
  flush: () => void;
  stop: () => void;
}
const idleSession: TxtFlowSession = { turn() {}, flush() {}, stop() {} };

export function useTxtPageFlow(options: {
  book: ReaderBook;
  settings: ReaderSettings;
  navigation: number;
  columns: number;
  viewport: RefObject<HTMLDivElement | null>;
  content: RefObject<HTMLDivElement | null>;
}) {
  const { book, settings, navigation, columns, viewport, content } = options;
  const enabled = book.source.format === "txt";
  const [current, setCurrent] = useState<TxtPageSpread>();
  const [motion, setMotion] = useState<PageMotion>();
  const [busy, setBusy] = useState(enabled);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const session = useRef<TxtFlowSession>(idleSession);
  const cancelMotion = useRef(() => {});
  const finishMotion = useRef(() => {});
  const spreads = motion
    ? motion.direction > 0
      ? [motion.from, motion.to]
      : [motion.to, motion.from]
    : current
      ? [current]
      : [];
  const sections = useMemo(
    () => [
      ...new Set(
        (motion ? [motion.from, motion.to] : current ? [current] : []).flatMap((spread) =>
          spread.pages.flatMap((page) => page.fragments.map((fragment) => fragment.section)),
        ),
      ),
    ],
    [motion, current],
  );
  useSectionsContent(sections);

  useLayoutEffect(() => {
    const element = viewport.current;
    const body = content.current;
    if (!enabled || !element || !body) return;
    let disposeLayout = () => {};
    let disposed = false;
    let geometryKey = "";
    let scheduled = 0;
    const rebuild = (force = false) => {
      if (disposed) return;
      const style = getComputedStyle(body);
      const width = element.clientWidth / columns - 48;
      const available =
        element.clientHeight - parseFloat(style.marginTop) - parseFloat(style.marginBottom);
      if (width <= 0 || available <= 0) return;
      const key = `${width}:${available}`;
      if (!force && key === geometryKey) return;
      geometryKey = key;
      session.current.flush();
      disposeLayout();
      setBusy(true);
      setError(undefined);
      const probe = document.createElement("p");
      probe.className = "reader-prose reader-txt-measure";
      probe.style.width = `${width}px`;
      body.append(probe);
      const lineHeight = parseFloat(getComputedStyle(probe).lineHeight);
      const height =
        settings.txtParagraphStyle === "spaced" ? available : pageTextHeight(available, lineHeight);
      body.style.setProperty("--reader-page-text-height", `${height}px`);
      const measurement = createTxtPageMeasurement(book, probe);
      const layout = new TxtPageLayout(
        book,
        {
          height,
          lineHeight,
          paragraphGap:
            settings.txtParagraphStyle === "spaced"
              ? (settings.paragraphSpacing ?? 0.65) * settings.fontSize
              : 0,
        },
        measurement.measure,
      );
      const cache: TxtPageSpread[] = [];
      let live = true;
      let active: TxtPageSpread | undefined;
      let running = false;
      let turnGeneration = 0;
      const queue: number[] = [];
      const same = (a: TxtPageCursor, b: TxtPageCursor) =>
        a.section === b.section && a.offset === b.offset;
      const makeSpread = async (
        cursor: TxtPageCursor,
        direction: number,
      ): Promise<TxtPageSpread | undefined> => {
        const existing = cache.find((spread) =>
          same(direction > 0 ? spread.start : spread.end, cursor),
        );
        if (existing) return existing;
        const pages: TxtPage[] = [];
        for (let index = 0; index < columns; index++) {
          const page = direction > 0 ? await layout.next(cursor) : await layout.previous(cursor);
          if (!live) return;
          if (!page) break;
          if (direction > 0) pages.push(page);
          else pages.unshift(page);
          cursor = direction > 0 ? page.end : page.start;
        }
        if (!pages.length) return;
        const spread = { pages, start: pages[0]!.start, end: pages.at(-1)!.end };
        cache.push(spread);
        if (cache.length > 8) cache.shift();
        return spread;
      };
      const persist = () => {
        const fragment = active?.pages[0]?.fragments[0];
        if (!fragment) return;
        const exact = fragment.text.slice(0, 96);
        reader.setLocator(
          createLocator(fragment.section, fragment.start / Math.max(1, fragment.total), undefined, {
            exact,
            start: fragment.start,
            end: fragment.start + exact.length,
          }),
        );
      };
      const prefetch = () => {
        if (!active) return;
        // A single neighbor each way, with bounded measured-paragraph and spread caches.
        void makeSpread(active.end, 1).catch(() => {});
        void makeSpread(active.start, -1).catch(() => {});
      };
      const drain = async () => {
        if (running || !active || !live) return;
        running = true;
        setError(undefined);
        setBusy(true);
        try {
          while (queue.length && live) {
            const direction = queue.shift()!;
            const generation = turnGeneration;
            const target = await makeSpread(direction > 0 ? active.end : active.start, direction);
            if (!live || generation !== turnGeneration) break;
            if (!target) continue;
            const from = active;
            await new Promise<void>((resolve) => {
              const finish = () => {
                finishMotion.current = () => {};
                if (live) {
                  active = target;
                  setCurrent(target);
                  setMotion(undefined);
                  persist();
                }
                resolve();
              };
              finishMotion.current = finish;
              setMotion({ from, to: target, direction, finish });
            });
          }
        } catch (reason) {
          if (live) setError(reason instanceof Error ? reason.message : "分页加载失败");
        } finally {
          running = false;
          if (live) {
            setBusy(false);
            prefetch();
          }
        }
      };
      const stop = () => {
        turnGeneration++;
        queue.length = 0;
        cancelMotion.current();
        finishMotion.current();
      };
      session.current = {
        turn(direction) {
          if (queue.length < 8) queue.push(direction);
          void drain();
        },
        flush() {
          stop();
          persist();
        },
        stop,
      };
      disposeLayout = () => {
        live = false;
        stop();
        measurement.dispose();
        probe.remove();
        session.current = idleSession;
      };
      void (async () => {
        const state = getReaderState();
        const locator = state.progressByBook[book.id]?.locator;
        const section = Math.max(
          0,
          book.sections.findIndex(
            (item) => item.id === (locator?.sectionId ?? state.activeSectionId),
          ),
        );
        const measured = await measurement.measure(section);
        const offset =
          resolveTextAnchor(measured.text, locator?.textAnchor)?.start ??
          Math.floor((locator?.progression ?? 0) * measured.text.length);
        const cursor = await layout.align({ section, offset });
        const spread = await makeSpread(cursor, 1);
        if (!live || !spread) return;
        active = spread;
        setCurrent(spread);
        setMotion(undefined);
        setBusy(false);
        persist();
        const reveal = getReaderState().searchReveal;
        if (reveal) reader.clearSearchReveal(reveal.id);
        prefetch();
        void drain();
      })().catch((reason) => {
        if (live) {
          setError(reason instanceof Error ? reason.message : "分页加载失败");
          setBusy(false);
        }
      });
    };
    const schedule = (force = false) => {
      cancelAnimationFrame(scheduled);
      scheduled = requestAnimationFrame(() => rebuild(force));
    };
    rebuild();
    const observer = new ResizeObserver(() => schedule());
    observer.observe(element);
    const fonts = () => schedule(true);
    window.addEventListener("bcr-reader-fonts-ready", fonts);
    document.fonts.addEventListener("loadingdone", fonts);
    void document.fonts.ready.then(fonts);
    return () => {
      disposed = true;
      cancelAnimationFrame(scheduled);
      observer.disconnect();
      window.removeEventListener("bcr-reader-fonts-ready", fonts);
      document.fonts.removeEventListener("loadingdone", fonts);
      disposeLayout();
    };
  }, [enabled, book, settings, navigation, columns, viewport, content, retry]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!enabled || !element) return;
    if (!motion) {
      element.scrollTo({ left: 0, behavior: "instant" });
      return;
    }
    const width = element.clientWidth;
    element.scrollTo({ left: motion.direction > 0 ? 0 : width, behavior: "instant" });
    cancelMotion.current = animatePageTurn(
      element,
      motion.direction > 0 ? width : 0,
      motion.finish,
      settings.pageAnimation,
    );
    return () => cancelMotion.current();
  }, [enabled, motion, settings.pageAnimation, viewport]);

  const destination = motion?.to ?? current;
  return {
    enabled,
    spreads,
    current,
    ready: !busy && !error,
    error,
    turn: useCallback((direction: number) => session.current.turn(direction), []),
    flush: useCallback(() => session.current.flush(), []),
    stop: useCallback(() => session.current.stop(), []),
    retry: useCallback(() => setRetry((value) => value + 1), []),
    canPrevious: Boolean(
      destination && (destination.start.section > 0 || destination.start.offset > 0),
    ),
    canNext: Boolean(destination && destination.end.section < book.sections.length),
  };
}
