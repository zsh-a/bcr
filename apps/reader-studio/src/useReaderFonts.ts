import "./fontAssets";
import { useEffect, useState } from "react";
import type { ReaderSettings } from "./model";
import { READER_CJK_FONT_OPTIONS, READER_LATIN_FONT_OPTIONS } from "./readerTypography";

const imports: Record<string, () => Promise<unknown>> = {
  "cjk:serif": () => import("@fontsource-variable/noto-serif-sc"),
  "cjk:sans": () => import("@fontsource-variable/noto-sans-sc"),
  "cjk:kai": () => import("lxgw-wenkai-webfont/lxgwwenkai-regular.css"),
  "latin:literata": () => import("@fontsource-variable/literata"),
  "latin:atkinson": () => import("@fontsource-variable/atkinson-hyperlegible-next"),
};
const pending = new Map<string, Promise<unknown>>();
function load(key: string) {
  const cached = pending.get(key);
  if (cached) return cached;
  const promise = (imports[key]?.() ?? Promise.resolve()).catch((reason: unknown) => {
    pending.delete(key);
    throw reason;
  });
  pending.set(key, promise);
  return promise;
}

/** Same-origin, unicode-subset webfonts. Never fetch all CJK families on startup. */
export function useReaderFonts(settings: ReaderSettings, enabled = true) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    setStatus("loading");
    void Promise.all([
      load(`cjk:${settings.fontFamily}`),
      load(`latin:${settings.latinFontFamily}`),
    ])
      .then(async () => {
        const cjk = READER_CJK_FONT_OPTIONS.find(
          (font) => font.id === settings.fontFamily,
        )?.stack.split(",")[0];
        const latin = READER_LATIN_FONT_OPTIONS.find(
          (font) => font.id === settings.latinFontFamily,
        )?.stack.split(",")[0];
        await Promise.all([
          document.fonts.load(`400 20px ${cjk}`, "阅读中文，春山可望。"),
          document.fonts.load(`400 20px ${latin}`, "Reading Il1 O0"),
        ]);
        await document.fonts.ready;
        if (!disposed) {
          setStatus("ready");
          window.dispatchEvent(new Event("bcr-reader-fonts-ready"));
        }
      })
      .catch(() => {
        if (!disposed) setStatus("error");
      });
    return () => {
      disposed = true;
    };
  }, [settings.fontFamily, settings.latinFontFamily, enabled, retry]);
  return { status, retry: () => setRetry((value) => value + 1) };
}
