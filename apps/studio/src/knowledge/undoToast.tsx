/**
 * 通用撤销提示（Wave 2a 对外契约）。
 *
 * `showUndoToast(message, onUndo)` 供知识工作台的可撤销操作调用（重命名、移动等）。
 * 提示固定在底部居中，约 6 秒后自动消失，可点「撤销」立即回退。
 * 进出场过渡由 knowledge.css 的 @starting-style + allow-discrete 承担；
 * 视觉只用共享令牌，按钮复用 ui-btn 原语类。
 */

import "./knowledge.css";

const LIFETIME_MS = 6000;

interface ActiveToast {
  element: HTMLElement;
  timer: number;
  restart(): void;
}
let active: ActiveToast | null = null;

function removeSoon(element: HTMLElement) {
  element.classList.remove("knowledge-undo-toast-show");
  const done = () => element.remove();
  element.addEventListener("transitionend", done, { once: true });
  window.setTimeout(done, 400);
}

function dismissActive() {
  const toast = active;
  active = null;
  if (!toast) return;
  window.clearTimeout(toast.timer);
  removeSoon(toast.element);
}

/** 显示一次可撤销的操作反馈；同一时刻只保留一条提示。 */
export function showUndoToast(message: string, onUndo: () => void): void {
  if (typeof document === "undefined") return;
  dismissActive();

  const element = document.createElement("div");
  element.className = "knowledge-undo-toast";
  element.setAttribute("role", "status");

  const text = document.createElement("span");
  text.className = "knowledge-undo-toast-message";
  text.textContent = message;

  const undo = document.createElement("button");
  undo.type = "button";
  undo.className = "ui-btn ui-btn-ghost ui-btn-sm knowledge-undo-toast-action";
  undo.textContent = "撤销";
  undo.addEventListener("click", () => {
    dismissActive();
    try {
      onUndo();
    } catch {
      /* 撤销失败由各操作自身的状态行反馈，提示不重开。 */
    }
  });

  element.append(text, undo);
  document.body.append(element);

  const restart = () => {
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(dismissActive, LIFETIME_MS);
  };
  const toast: ActiveToast = { element, timer: 0, restart };
  active = toast;
  // 悬停或聚焦时暂停自动消失，移开后重新计时。
  element.addEventListener("mouseenter", () => window.clearTimeout(toast.timer));
  element.addEventListener("mouseleave", restart);
  element.addEventListener("focusin", () => window.clearTimeout(toast.timer));
  element.addEventListener("focusout", restart);
  restart();
  // 下一帧再加显隐类，@starting-style 才能播放进场过渡。
  requestAnimationFrame(() => element.classList.add("knowledge-undo-toast-show"));
}
