import { useState } from "react";
import type { GitTarget } from "./model";
import { knowledgeCredentialId } from "./credential";

const key = "bcr/knowledge-auto-sync";
export function useAutoSync(target: GitTarget | null, onError: (message: string) => void) {
  const identity = target ? `${knowledgeCredentialId(target)}:${target.branch}` : "";
  const [saved, setSaved] = useState(() => {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  });
  function setAuto(enabled: boolean) {
    const next = enabled ? identity : "";
    try {
      if (next) localStorage.setItem(key, next);
      else localStorage.removeItem(key);
      setSaved(next);
    } catch {
      // Disable in memory even if persistence is unavailable.
      if (!enabled) setSaved("");
      onError("无法保存自动同步偏好，请检查浏览器存储权限。");
    }
  }
  return [!!identity && saved === identity, setAuto] as const;
}
