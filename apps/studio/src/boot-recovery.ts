/**
 * 启动失败屏的自救动作（纯 DOM，供 React 起来之前的引导错误用）。
 *
 * 典型故障是「陈旧壳 + 被改名/回收的分块」：Service Worker 保留窗口只覆盖
 * 上一版资产，连续部署后旧壳按旧名加载分块会拿到 SPA 兜底页，预载即炸。
 * 这类失败重试无用，必须能一键卸掉 Worker 与 Cache Storage 再刷新。
 * 只清 SW 与缓存：localStorage / IndexedDB 里的用户内容绝不动。
 */

function action(label: string, run: () => void | Promise<void>): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", () => void run());
  return button;
}

export function appendBootRecovery(container: HTMLElement): void {
  const hint = document.createElement("p");
  hint.className = "bcr-bootstrap-hint";
  hint.textContent =
    "持续出现时，多半是本地缓存的旧版本与线上资源对不上；清除缓存后会重新加载最新版本，笔记与设置保留。";
  const actions = document.createElement("div");
  actions.className = "bcr-bootstrap-actions";
  const reset = action("清除缓存并重载", async () => {
    reset.disabled = true;
    try {
      for (const registration of await navigator.serviceWorker.getRegistrations())
        await registration.unregister();
      for (const key of await caches.keys()) await caches.delete(key);
    } finally {
      location.reload();
    }
  });
  actions.append(
    action("重试", () => location.reload()),
    reset,
  );
  container.append(hint, actions);
}
