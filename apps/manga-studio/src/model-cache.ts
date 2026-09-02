/**
 * Explicit Cache API boundary for browser-hosted Transformers.js models.
 *
 * Transformers.js has a built-in `transformers-cache` namespace, but it does
 * not expose a product-level invalidation or inspection contract. Manga owns
 * this named cache so the UI can report whether model files are present and
 * clear only Manga model bytes when a user asks it to.
 */

export const MANGA_MODEL_CACHE_NAME = "bcr-manga-models-v1";

export interface MangaModelCacheInfo {
  readonly supported: boolean;
  readonly entryCount: number;
  readonly modelFiles: ReadonlyArray<{
    readonly model: string;
    readonly files: number;
  }>;
}

type TransformersEnvironment = {
  useCustomCache: boolean;
  customCache: unknown;
  useBrowserCache: boolean;
  useFSCache: boolean;
};

function cacheStorage(): CacheStorage | undefined {
  const candidate = globalThis as typeof globalThis & { caches?: CacheStorage };
  return candidate.caches;
}

let cachePromise: Promise<Cache | undefined> | undefined;

/** Open the versioned cache, returning undefined when the host denies Cache API access. */
export async function openMangaModelCache(): Promise<Cache | undefined> {
  if (cachePromise !== undefined) return cachePromise;
  const storage = cacheStorage();
  if (storage === undefined) return undefined;
  cachePromise = storage.open(MANGA_MODEL_CACHE_NAME).catch(() => undefined);
  return cachePromise;
}

/**
 * Route Transformers.js through the explicit Manga cache. The fallback to its
 * default cache remains safe for older browsers or restricted iframes.
 */
export async function configureMangaTransformersCache(
  environment: TransformersEnvironment,
): Promise<boolean> {
  const cache = await openMangaModelCache();
  if (cache === undefined) return false;
  environment.useCustomCache = true;
  environment.customCache = cache;
  environment.useBrowserCache = false;
  environment.useFSCache = false;
  return true;
}

function requestBelongsToModel(request: Request, model: string): boolean {
  try {
    const pathname = new URL(request.url).pathname;
    return pathname.includes(`/${model}/resolve/`);
  } catch {
    return request.url.includes(`/${model}/resolve/`);
  }
}

/** Count cached model files without reading their bodies into memory. */
export async function inspectMangaModelCache(
  models: ReadonlyArray<string>,
): Promise<MangaModelCacheInfo> {
  const cache = await openMangaModelCache();
  if (cache === undefined) {
    return { supported: false, entryCount: 0, modelFiles: [] };
  }
  try {
    const requests = await cache.keys();
    const modelFiles = models
      .map((model) => ({
        model,
        files: requests.filter((request) => requestBelongsToModel(request, model)).length,
      }))
      .filter((entry) => entry.files > 0);
    return { supported: true, entryCount: requests.length, modelFiles };
  } catch {
    return { supported: false, entryCount: 0, modelFiles: [] };
  }
}

/** Delete only the versioned Manga model cache; future loads recreate it. */
export async function clearMangaModelCache(): Promise<boolean> {
  const storage = cacheStorage();
  if (storage === undefined) return false;
  try {
    const deleted = await storage.delete(MANGA_MODEL_CACHE_NAME);
    cachePromise = undefined;
    return deleted;
  } catch {
    return false;
  }
}
