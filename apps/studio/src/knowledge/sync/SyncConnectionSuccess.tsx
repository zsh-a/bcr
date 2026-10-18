import { Button } from "@bcr/react";
import type { SyncSummary } from "./sync";
import { syncResultText } from "./syncFeedback";

export function SyncConnectionSuccess({
  message,
  summary,
  auto,
  remembered,
  disabled,
  onEnable,
  onClose,
}: {
  message: string;
  summary: SyncSummary;
  auto: boolean;
  remembered: boolean;
  disabled: boolean;
  onEnable: () => void;
  onClose: () => void;
}) {
  return (
    <section className="knowledge-sync-success" aria-label="连接完成">
      <h3>连接完成</h3>
      <p role="status">{message}</p>
      <p>{syncResultText({ ...summary, conflicts: 0 })}</p>
      <p>
        {auto
          ? "自动同步已开启，保存后会同步，返回页面时会检查远端更新。"
          : "开启自动同步后，保存笔记和返回页面时会自动检查更新。也可随时手动同步。"}
      </p>
      {!remembered && <p>Token 仅用于本次打开；刷新或关闭后，需要补充 Token 才能继续同步。</p>}
      <div className="knowledge-panel-actions">
        {!auto && (
          <Button variant="primary" disabled={disabled} onClick={onEnable}>
            开启自动同步
          </Button>
        )}
        <Button variant={auto ? "primary" : "default"} disabled={disabled} onClick={onClose}>
          完成
        </Button>
      </div>
    </section>
  );
}
