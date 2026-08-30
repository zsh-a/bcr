import type { RuntimeServices } from "@bcr/react";
import { useEffect, useState } from "react";
import { Outlet } from "@tanstack/react-router";
import { CommandPalette } from "./components/CommandPalette";
import { Dock } from "./components/Dock";
import { TopBar } from "./components/TopBar";
import { createRuntimeServices } from "./runtime";
import { ServicesContext } from "./services";
import { studio } from "./store";

export function App() {
  const [services, setServices] = useState<RuntimeServices | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    void createRuntimeServices().then((s) => {
      setServices(s);
      studio.log("info", "runtime ready · scheduler/worker-pool/opfs online");
    });
  }, []);

  // ⌘K / Ctrl+K 打开命令面板
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (services === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-[11px] text-faint">
          runtime 初始化中…（scheduler · worker pool · opfs）
        </p>
      </div>
    );
  }

  return (
    <ServicesContext.Provider value={services}>
      <div className="flex h-full flex-col">
        <TopBar onOpenPalette={() => setPaletteOpen(true)} />
        <div className="min-h-0 flex-1">
          <Dock />
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <Outlet />
    </ServicesContext.Provider>
  );
}
