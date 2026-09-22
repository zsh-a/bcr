import type { ComponentType, LazyExoticComponent } from "react";
import type { RuntimeServices } from "@bcr/core";
import type { AgentHost } from "@bcr/agent";

export interface PluginContext {
  readonly runtime: RuntimeServices;
  readonly agent: AgentHost;
  readonly reportError: (error: unknown) => void;
}
export interface WorkspacePlugin {
  readonly id: string;
  /** Registers services independently of the workspace view. Cleanup must be idempotent. */
  readonly activate: (context: PluginContext) => () => void;
}

/**
 * The contract an application implements to be embedded in the Studio shell.
 *
 * This is the single declaration point for an app. Path, search parsing, launch
 * placement, palette naming and compute registration all read from one
 * manifest, so adding an app means adding a file rather than editing every list
 * the shell happens to keep.
 *
 * It lives in its own package because apps must not import from `apps/studio`,
 * and the host must not know any app's internals.
 */

/** A component the shell can render lazily, without depending on any icon library. */
export type AppComponent = ComponentType | LazyExoticComponent<ComponentType>;

/**
 * A themeable icon: anything that renders an SVG taking a `className`.
 * Structural on purpose, so the host needs no dependency on `lucide-react`.
 */
export type AppIcon = ComponentType<{ readonly className?: string }>;

/** Where the app belongs on the launch pad. */
export type AppSection = "compute" | "personal" | null;

/**
 * Compute handlers the app contributes to the host's compute worker.
 *
 * `module` is the app's compute entry (its `./compute` export); `backends` maps
 * each operation ID to the executor backend that serves it, which is what the
 * scheduler filters operations on.
 *
 * The operation lists are constrained to a literal union so the host can derive
 * `StudioOperation` from the manifests without widening it to `string`. An app
 * that lists a `string[]` here would silently erase the worker's handler-table
 * check, so `backends` is typed against the union the app itself narrows to.
 */
export interface AppCompute<Operation extends string = string> {
  readonly module: () => Promise<Record<string, unknown>>;
  readonly backends: {
    readonly wasm: ReadonlyArray<Operation>;
    readonly js: ReadonlyArray<Operation>;
  };
}

export interface AppManifest<Operation extends string = string> {
  readonly id: string;
  /** Launch-pad card title. */
  readonly title: string;
  /** Palette label, when the card title alone is ambiguous. */
  readonly paletteTitle?: string;
  /** Route path, e.g. `/reader`. */
  readonly path: `/${string}`;
  readonly icon: AppIcon;
  readonly description: string;
  readonly section: AppSection;
  /** Loads the app's entry component; the registry turns this into `lazy()`. */
  readonly load: () => Promise<{ readonly App: AppComponent }>;
  /** Parses the URL search params this route owns. */
  readonly validateSearch?: (search: Record<string, unknown>) => Record<string, unknown>;
  readonly compute?: AppCompute<Operation>;
  readonly plugins?: readonly WorkspacePlugin[];
}

/** Global tools are commands/panels, not empty workspace routes. */
export interface PanelManifest {
  readonly kind: "panel";
  readonly id: string;
  readonly title: string;
  readonly icon: AppIcon;
  readonly description: string;
  readonly section: AppSection;
  readonly paletteTitle?: string;
}
