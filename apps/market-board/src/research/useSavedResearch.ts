import { useState } from "react";

const key = "bcr:macro-research-layout";
export function useSavedResearch() {
  const [saved, setSaved] = useState<string | null>(() => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
      if (
        raw &&
        typeof raw === "object" &&
        "version" in raw &&
        raw.version === 1 &&
        "url" in raw &&
        typeof raw.url === "string" &&
        raw.url.startsWith("/markets?")
      )
        return raw.url;
    } catch {
      /* Storage is optional; shared URLs remain usable. */
    }
    return null;
  });
  const save = (url: string) => {
    try {
      localStorage.setItem(key, JSON.stringify({ version: 1, url }));
      setSaved(url);
      return true;
    } catch {
      return false;
    }
  };
  return { saved, save };
}
