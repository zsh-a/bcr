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

/** Settings retain release information after the transient check result disappears. */
export function AppUpdateInfo() {
  const update = useAppUpdateState();
  if (update.phase === "unavailable") return null;
  return (
    <div className="bcr-update-info" aria-label="应用版本">
      {update.buildId && (
        <p>
          当前版本 <span>{update.buildId}</span>
        </p>
      )}
      <p>
        {update.checkedAt ? (
          <>
            上次检查{" "}
            <time dateTime={new Date(update.checkedAt).toISOString()}>
              {new Date(update.checkedAt).toLocaleString()}
            </time>
          </>
        ) : (
          "尚未完成更新检查"
        )}
      </p>
    </div>
  );
}
