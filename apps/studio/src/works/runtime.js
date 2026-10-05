/* Embedded in an opaque-origin iframe or an exported offline document. No host APIs. */
window.installWorkRuntime = (assets) => {
  const reports = [];
  let port;
  const stringify = (value) => {
    try {
      return typeof value === "string" ? value : JSON.stringify(value);
    } catch {
      return String(value);
    }
  };
  const report = (level, message) => {
    const event = { level, message: String(message).slice(0, 2000) };
    reports.push(event);
    if (reports.length > 50) reports.shift();
    port?.postMessage({ kind: "log", event });
  };
  for (const level of ["log", "info", "warn", "error"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      report(level, args.map(stringify).join(" "));
    };
  }
  addEventListener(
    "error",
    (event) =>
      report(
        "error",
        event.message || `资源加载失败：${event.target?.src || event.target?.href || "unknown"}`,
      ),
    true,
  );
  addEventListener("unhandledrejection", (event) =>
    report("error", stringify(event.reason?.message || event.reason)),
  );
  addEventListener("securitypolicyviolation", (event) =>
    report("error", `CSP: ${event.violatedDirective} ${event.blockedURI}`),
  );
  Object.defineProperty(window, "bcr", {
    value: Object.freeze({
      files: Object.freeze(Object.keys(assets)),
      asset(path) {
        if (!Object.hasOwn(assets, path)) throw new Error(`作品文件不存在：${path}`);
        return assets[path];
      },
      async readText(path) {
        const url = this.asset(path),
          binary = atob(url.slice(url.indexOf(",") + 1));
        return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
      },
    }),
    writable: false,
    configurable: false,
  });
  // The parent transfers a private port; messages never dispatch host commands or evaluate code.
  addEventListener("message", (event) => {
    if (event.source !== parent || event.data !== "bcr-work-connect" || port || !event.ports[0])
      return;
    port = event.ports[0];
    port.onmessage = async ({ data }) => {
      try {
        if (data.action === "page-state" || data.action === "page-restore") {
          const api = window.__bcrPageReview;
          if (!api) throw new Error("此历史页面没有状态接口");
          const result =
            data.action === "page-state" ? await api.capture() : await api.restore(data.page);
          port.postMessage({ kind: "result", id: data.id, text: "", pageResult: result });
          return;
        }
        const node = data.selector ? document.querySelector(data.selector) : document.body;
        if (!node) throw new Error("未找到目标元素");
        if (data.action === "click") node.click();
        if (data.action === "input") {
          if (
            !(
              node instanceof HTMLInputElement ||
              node instanceof HTMLTextAreaElement ||
              node instanceof HTMLSelectElement
            )
          )
            throw new Error("目标不是输入控件");
          node.value = String(data.value ?? "");
          node.dispatchEvent(new Event("input", { bubbles: true }));
          node.dispatchEvent(new Event("change", { bubbles: true }));
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        port.postMessage({
          kind: "result",
          id: data.id,
          text: (node.innerText ?? node.textContent ?? "").slice(0, 12000),
          value: typeof node.value === "string" ? node.value.slice(0, 2000) : undefined,
        });
      } catch (error) {
        port.postMessage({ kind: "result", id: data.id, error: String(error.message || error) });
      }
    };
    port.postMessage({ kind: "ready", reports });
  });
};
