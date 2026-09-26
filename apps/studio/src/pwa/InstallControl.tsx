import { Button } from "@bcr/react";
import { Download } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { pwaAtPath, type PwaApp } from "./apps";
import { installPrompt } from "./install";
import "./install.css";

export function InstallControl({ app }: { app: PwaApp }) {
  const prompt = useSyncExternalStore(installPrompt.subscribe, installPrompt.getSnapshot);
  const [instructions, setInstructions] = useState(false);
  const current = pwaAtPath(location.pathname);
  const installed =
    matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  if (current?.key === app.key && installed) return null;
  const label = `安装${app.shortName}`;
  if (current?.key !== app.key) {
    const search = location.pathname === app.path ? location.search : "";
    return (
      <a className="ui-btn ui-btn-ghost pwa-install" href={`${app.startUrl}${search}`}>
        <Download size={16} />
        {label}
      </a>
    );
  }
  return (
    <div className="pwa-install-control">
      <Button
        variant="ghost"
        className="pwa-install"
        onClick={() => {
          if (prompt) void installPrompt.request().catch(() => setInstructions(true));
          else setInstructions((value) => !value);
        }}
        aria-expanded={instructions}
      >
        <Download size={16} />
        {label}
      </Button>
      {instructions && (
        <p role="status" className="pwa-install-help">
          在浏览器菜单中选择“安装应用”或“添加到主屏幕”。iPhone / iPad
          请使用分享菜单中的“添加到主屏幕”。如果已安装，可从桌面打开。
        </p>
      )}
    </div>
  );
}
