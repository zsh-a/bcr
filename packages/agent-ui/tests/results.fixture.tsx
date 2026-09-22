import { createRoot } from "react-dom/client";
import { createResultRegistry } from "../src/renderers";
import { ToolExecutionCard } from "../src/ToolExecutionCard";
import type { AgentToolPart } from "@bcr/agent";

/** Browser-only fixture: a broken plugin must not take down the conversation. */
export function mountResults(container: HTMLElement) {
  const registry = createResultRegistry([
    {
      kind: "broken",
      version: 1,
      accepts: () => true,
      component: () => {
        throw new Error("fixture renderer failure");
      },
    },
    {
      kind: "invalid",
      version: 1,
      accepts: () => false,
      component: () => <p>invalid payload rendered</p>,
    },
    {
      kind: "validator",
      version: 1,
      accepts: () => {
        throw new Error("fixture validator failure");
      },
      component: () => null,
    },
  ]);
  const root = createRoot(container);
  root.render(
    <div className="bcr-chat">
      {["broken", "invalid", "validator", "unknown"].map((kind) => {
        const part: AgentToolPart = {
          type: "tool",
          id: kind,
          call: { id: kind, name: kind, input: {} },
          presentation: { kind, version: 1, label: kind },
          result: { tool_call_id: kind, tool_name: kind, output: { raw: `retained-${kind}` } },
        };
        return (
          <ToolExecutionCard
            key={kind}
            part={part}
            running={false}
            resolve={() => {
              throw new Error("renderer may not resolve approvals");
            }}
            registry={registry}
          />
        );
      })}
    </div>,
  );
  return () => root.unmount();
}
