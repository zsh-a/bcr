import { mangaRuntime } from "../src/runtime";

/** Loaded through Vite so the harness and App resolve the same domain module instance. */
export async function closeMangaSession() {
  const runtime = mangaRuntime();
  if (!runtime?.session) throw new Error("Manga session has not initialized");
  await runtime.session.host.dispose();
}
