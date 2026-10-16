import { checkForAppUpdate, useAppUpdateState } from "./appUpdateState";

export function AppUpdateButton({ className = "" }: { className?: string }) {
  const update = useAppUpdateState();
  if (update.phase === "unavailable") return null;
  return (
    <button
      type="button"
      className={`ui-btn ui-btn-ghost ${className}`}
      disabled={update.phase === "checking"}
      onClick={(event) => {
        // The global notice must remain reachable after checking from a modal
        // installation panel or a top-layer workspace menu.
        event.currentTarget.closest("dialog")?.close();
        event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
        checkForAppUpdate();
      }}
    >
      {update.phase === "checking" ? "正在检查更新…" : "检查更新"}
    </button>
  );
}
