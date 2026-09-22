import { useAgentHost, useRuntime } from "@bcr/react";
import { useEffect, useState } from "react";
import { PLUGINS } from "./registry";
import { activatePlugins } from "./plugins";

export function PluginHost() {
  const runtime = useRuntime();
  const agent = useAgentHost();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    let active = true;
    const reportError = (value: unknown) => {
      if (active) setError(String(value));
    };
    try {
      const dispose = activatePlugins(PLUGINS, { runtime, agent, reportError });
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
  }, [runtime, agent]);
  return error ? <div role="alert">领域能力初始化失败：{error}</div> : null;
}
