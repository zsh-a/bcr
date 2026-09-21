import type { TextRange } from "@bcr/core";

/**
 * Something the agent is allowed to read and change.
 *
 * A domain registers one of these while it is on screen, so a single chat panel
 * can serve notes, OCR blocks, translations or anything else without knowing
 * what any of them are. The surface owns the two decisions that cannot be
 * shared: how to address a range, and where an accepted result goes.
 *
 * `write` must go through the domain's own storage path. That is what keeps the
 * guarantees the domain already has — for notes, a revision in 历史 — rather
 * than a second writer that bypasses them.
 */
export interface AgentSurface {
  /** Stable kind, e.g. `knowledge.note`. Used for display and diagnostics. */
  readonly kind: string;
  /** What the user is editing, e.g. a note title. */
  readonly label: string;
  /**
   * The current text and the range the agent should act on.
   *
   * Returns `null` when nothing is editable right now (no selection, no open
   * document), so the panel can say so instead of guessing.
   */
  readonly read: () => SurfaceTarget | null;
  /** Persist an accepted result. */
  readonly write: (next: string) => void;
}

export interface SurfaceTarget {
  /** The whole text the range is addressed against; the version guard's basis. */
  readonly text: string;
  readonly range: TextRange;
  /** Included in the prompt so the model knows what it is editing. */
  readonly instruction: string;
  /** Human description of the range, e.g. "选中 12 字符". */
  readonly scope: string;
}

const surfaces = new Map<string, AgentSurface>();
let active: string | null = null;
const listeners = new Set<() => void>();

/**
 * The last summary handed out, reused while it still describes the same state.
 *
 * `useSyncExternalStore` compares snapshots by identity and re-renders on a
 * change, so returning a fresh object from every read is an infinite loop. The
 * summary is cached per revision instead, and `read()` is called only when the
 * revision moves.
 */
let cached: SurfaceSummary | null = null;
let revision = 0;

function emit(): void {
  revision += 1;
  cached = null;
  for (const listener of listeners) listener();
}

/**
 * Register a surface. Returns an unregister function for the effect cleanup.
 *
 * Registering does not make it active: a workspace that is merely mounted should
 * not hijack a panel the user opened against another one. Call
 * {@link activateSurface} when the user is actually looking at it.
 */
export function registerSurface(surface: AgentSurface): () => void {
  surfaces.set(surface.kind, surface);
  emit();
  return () => {
    if (surfaces.delete(surface.kind) && active === surface.kind) {
      active = null;
      emit();
    }
  };
}

export function activateSurface(kind: string | null): void {
  if (active === kind) return;
  active = kind;
  emit();
}

/** The surface in effect, or `null` when nothing is registered or active. */
export function activeSurface(): AgentSurface | null {
  return active === null ? null : (surfaces.get(active) ?? null);
}

export function subscribeSurfaces(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** How the panel describes the current target, without reaching into a domain. */
export interface SurfaceSummary {
  readonly kind: string;
  readonly label: string;
  readonly scope: string;
  readonly editable: boolean;
}

/**
 * A snapshot for rendering. Kept as a plain object so React can compare it by
 * value; `read()` returns fresh objects each call.
 */
export function surfaceSummary(): SurfaceSummary | null {
  if (cached !== null) return cached;
  const surface = activeSurface();
  if (surface === null) return null;
  const target = surface.read();
  cached = {
    kind: surface.kind,
    label: surface.label,
    scope: target?.scope ?? "无可编辑内容",
    editable: target !== null,
  };
  return cached;
}

/** The current revision, for callers that refresh a cached summary themselves. */
export function surfaceRevision(): number {
  return revision;
}
