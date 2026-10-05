import type { PageState, PageElement } from "./page";

/** Serialized into a work document. No host access, fetch or closure dependencies. */
export function installPageReview() {
  type Hooks = { exportState?(): unknown; importState?(state: unknown): unknown };
  const scope = window as unknown as {
    bcrReview?: Hooks;
    __bcrPageReview?: ReturnType<typeof create>;
  };
  function create() {
    const selector = (element: Element): string => {
      for (const name of ["data-review-id", "data-testid", "id"]) {
        const value = element.getAttribute(name);
        if (value) {
          const s = `[${name}=${JSON.stringify(value)}]`;
          if (document.querySelectorAll(s).length === 1) return s;
        }
      }
      const parts: string[] = [];
      let at: Element | null = element;
      while (at && at !== document.documentElement && parts.length < 12) {
        const siblings = at.parentElement
          ? Array.from(at.parentElement.children).filter((e) => e.tagName === at!.tagName)
          : [at];
        parts.unshift(`${at.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(at) + 1})`);
        at = at.parentElement;
      }
      return parts.join(" > ").slice(0, 1000);
    };
    const allowed = (element: Element) =>
      !(
        element instanceof HTMLInputElement && ["password", "file", "hidden"].includes(element.type)
      );
    const capture = async () => {
      const custom = scope.bcrReview?.exportState
        ? JSON.stringify(await scope.bcrReview.exportState())
        : undefined;
      if (custom && custom.length > 64000) throw new Error("页面状态超过 64 KB");
      return {
        path: "",
        viewport: { width: innerWidth, height: innerHeight },
        hash: location.hash.slice(0, 1000),
        scroll: { x: Math.max(0, scrollX), y: Math.max(0, scrollY) },
        controls: Array.from(
          document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
            "input,select,textarea",
          ),
        )
          .filter(allowed)
          .slice(0, 100)
          .map((e) => ({
            selector: selector(e),
            value: e.value.slice(0, 4000),
            ...(e instanceof HTMLInputElement && ["checkbox", "radio"].includes(e.type)
              ? { checked: e.checked }
              : {}),
          })),
        details: Array.from(document.querySelectorAll("details"))
          .slice(0, 100)
          .map((e) => ({ selector: selector(e), open: e.open })),
        ...(custom !== undefined ? { custom } : {}),
      };
    };
    const restore = async (state: PageState) => {
      const warnings: string[] = [];
      if (state.hash && state.hash.startsWith("#")) location.hash = state.hash;
      if (state.custom !== undefined) {
        if (scope.bcrReview?.importState)
          await scope.bcrReview.importState(JSON.parse(state.custom));
        else warnings.push("页面未提供 bcrReview.importState，无法恢复自定义状态");
      }
      for (const item of state.controls ?? []) {
        const element = document.querySelector(item.selector);
        if (
          !(
            element instanceof HTMLInputElement ||
            element instanceof HTMLSelectElement ||
            element instanceof HTMLTextAreaElement
          ) ||
          !allowed(element)
        ) {
          warnings.push(`未找到控件：${item.selector}`);
          continue;
        }
        if (item.value !== undefined) {
          // Native setter also notifies controlled React inputs when events are dispatched below.
          const prototype =
            element instanceof HTMLInputElement
              ? HTMLInputElement.prototype
              : element instanceof HTMLSelectElement
                ? HTMLSelectElement.prototype
                : HTMLTextAreaElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, item.value);
        }
        if (item.checked !== undefined && element instanceof HTMLInputElement)
          element.checked = item.checked;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }
      for (const item of state.details ?? []) {
        const element = document.querySelector(item.selector);
        if (element instanceof HTMLDetailsElement) element.open = item.open;
        else warnings.push(`未找到折叠区域：${item.selector}`);
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.scrollTo({
        left: state.scroll?.x ?? 0,
        top: state.scroll?.y ?? 0,
        behavior: "instant",
      });
      if (Math.abs(scrollY - (state.scroll?.y ?? 0)) > 2)
        warnings.push("页面高度变化，滚动位置已调整");
      return warnings.slice(0, 20);
    };
    const elements = (): PageElement[] =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-review-id],[data-testid],h1,h2,h3,p,button,label,input,select,textarea,output,li,td,th,caption,a,img,svg",
        ),
      )
        .filter((e) => allowed(e))
        .flatMap((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 &&
            r.height > 0 &&
            r.bottom > 0 &&
            r.right > 0 &&
            r.top < innerHeight &&
            r.left < innerWidth
            ? [
                {
                  selector: selector(e),
                  text: (
                    e.innerText ||
                    e.getAttribute("aria-label") ||
                    e.getAttribute("alt") ||
                    e.tagName
                  ).slice(0, 300),
                  x: r.x,
                  y: r.y,
                  width: r.width,
                  height: r.height,
                },
              ]
            : [];
        })
        .slice(0, 200);
    return { capture, restore, elements };
  }
  scope.__bcrPageReview ??= create();
}
export const pageReviewScript = `;(${installPageReview.toString()})();`;
