import { AppToolbar, Button, Skeleton } from "@bcr/react";
import { RefreshCw } from "lucide-react";

/** 启动失败卡：错误文案与重试时机由外壳持有，这里只负责呈现。 */
export function KnowledgeBootError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="knowledge-boot" role="alert">
      <p className="knowledge-boot-title">知识库没有打开。</p>
      <p className="knowledge-boot-error">{error}</p>
      <Button variant="primary" onClick={onRetry}>
        <RefreshCw size={15} />
        重试
      </Button>
    </div>
  );
}

/** 启动骨架：复刻侧栏 + 主区的形状，等真实内容接位，不闪跳。 */
export function KnowledgeBootShell() {
  return (
    <div
      className="knowledge-app knowledge-boot-shell"
      role="status"
      aria-label="正在打开本地知识库"
    >
      <AppToolbar className="knowledge-toolbar">
        <Skeleton className="knowledge-skeleton-sm" />
      </AppToolbar>
      <div className="knowledge-layout">
        <aside className="knowledge-sidebar">
          <Skeleton className="knowledge-skeleton-sm" />
          <Skeleton />
          <Skeleton />
          <Skeleton />
          <Skeleton className="knowledge-skeleton-fill" />
        </aside>
        <main className="knowledge-main">
          <Skeleton className="knowledge-skeleton-sm" />
          <Skeleton />
          <Skeleton className="knowledge-skeleton-fill" />
        </main>
      </div>
    </div>
  );
}
