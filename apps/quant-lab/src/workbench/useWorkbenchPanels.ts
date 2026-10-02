import { useEffect, useState, type RefObject } from "react";

type SettingsTab = "parameters" | "data" | "changes";

/** Display state belongs to the workbench; execution state belongs to the research service. */
export function useWorkbenchPanels(root: RefObject<HTMLElement | null>) {
  const [libraryOpen, setLibraryOpen] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1200px)").matches,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("parameters");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const [gridOpen, setGridOpen] = useState(false);
  const [studyOpen, setStudyOpen] = useState(false);

  useEffect(() => {
    const compact = window.matchMedia("(max-width: 1100px)");
    const resize = () => {
      if (compact.matches) setLibraryOpen(false);
    };
    compact.addEventListener("change", resize);
    return () => compact.removeEventListener("change", resize);
  }, []);

  useEffect(() => {
    if (!libraryOpen) return;
    const dismiss = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        window.matchMedia("(max-width: 1100px)").matches &&
        !document.querySelector("dialog[open]") &&
        root.current?.getClientRects().length
      )
        setLibraryOpen(false);
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [libraryOpen, root]);

  const openSettings = (tab: SettingsTab = "parameters") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };
  return {
    libraryOpen,
    setLibraryOpen,
    settingsOpen,
    setSettingsOpen,
    settingsTab,
    setSettingsTab,
    openSettings,
    historyOpen,
    setHistoryOpen,
    comparisonOpen,
    setComparisonOpen,
    storageOpen,
    setStorageOpen,
    gridOpen,
    setGridOpen,
    studyOpen,
    setStudyOpen,
  };
}
export type WorkbenchPanels = ReturnType<typeof useWorkbenchPanels>;
