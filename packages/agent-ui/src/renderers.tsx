import { Component, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import type { AgentToolPart } from "@bcr/agent";

export interface ResultRenderer {
  readonly kind: string;
  readonly version: number;
  readonly accepts: (value: unknown) => boolean;
  readonly component: ComponentType<{ part: AgentToolPart }>;
}
/** Presentation-only extensions. They never receive a tool executor or approval resolver. */
export function createResultRegistry(initial: readonly ResultRenderer[] = []) {
  const entries = new Map<string, ResultRenderer>();
  const listeners = new Set<() => void>();
  let snapshot: readonly ResultRenderer[] = [];
  const register = (renderer: ResultRenderer) => {
    const key = `${renderer.kind}@${renderer.version}`;
    if (
      !renderer.kind ||
      !Number.isSafeInteger(renderer.version) ||
      renderer.version < 1 ||
      entries.has(key)
    )
      throw new Error(`Invalid or duplicate Agent renderer: ${key}`);
    entries.set(key, renderer);
    const emit = () => {
      snapshot = [...entries.values()];
      for (const listener of listeners) listener();
    };
    emit();
    return () => {
      if (entries.get(key) === renderer) {
        entries.delete(key);
        emit();
      }
    };
  };
  initial.forEach(register);
  return {
    register,
    getSnapshot: () => snapshot,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export type ResultRegistry = ReturnType<typeof createResultRegistry>;
const empty = createResultRegistry();

class ResultBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p className="bcr-chat-hint">预览不可用，完整结果仍保留在技术详情中。</p>
    ) : (
      this.props.children
    );
  }
}
function ResultContent({ renderer, part }: { renderer: ResultRenderer; part: AgentToolPart }) {
  if (!renderer.accepts(part.result?.output)) return null;
  const View = renderer.component;
  return <View part={part} />;
}
export function ToolResultView({
  part,
  registry = empty,
}: {
  part: AgentToolPart;
  registry?: ResultRegistry | undefined;
}) {
  const renderers = useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot,
  );
  const renderer = renderers.find(
    (item) => item.kind === part.presentation?.kind && item.version === part.presentation.version,
  );
  if (!renderer || !part.result || part.result.is_error) return null;
  return (
    <ResultBoundary key={`${part.id}:${renderer.kind}:${renderer.version}`}>
      <ResultContent renderer={renderer} part={part} />
    </ResultBoundary>
  );
}
