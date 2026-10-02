import { useAgentHost, useRuntime } from "@bcr/react";
import { useEffect, useState } from "react";
import type { WorkspacePlugin } from "@bcr/shell-contract";
import { PLUGINS } from "./registry";
import { activatePlugins } from "./plugins";

export function PluginHost({ plugins = PLUGINS }: { plugins?: readonly WorkspacePlugin[] }) {
  const runtime = useRuntime();
  const agent = useAgentHost();
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    setErrors({});
    let active = true;
    const reportError = (value: unknown, id = "host") => {
      if (active)
        setErrors((previous) => {
          const next = { ...previous };
          if (value === undefined) delete next[id];
          else next[id] = String(value);
          return next;
        });
    };
    try {
      const dispose = activatePlugins(plugins, { runtime, agent, reportError });
      return () => {
        active = false;
        dispose();
      };
    } catch (value) {
      reportError(value);
      return () => {
        active = false;
      };
    }
  }, [runtime, agent, plugins]);
  const error = Object.values(errors).join("；");
  return error ? <div role="alert">领域能力初始化失败：{error}</div> : null;
}
