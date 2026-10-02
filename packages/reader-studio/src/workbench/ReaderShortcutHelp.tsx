import { X } from "lucide-react";
import { ReaderSheet } from "./ReaderSheet";

export function ReaderShortcutHelp(props: { open: boolean; onClose: () => void }) {
  return (
    <ReaderSheet open={props.open} onClose={props.onClose} labelId="reader-shortcut-title">
      <section className="reader-mobile-sheet reader-data-sheet">
        <header className="reader-data-heading">
          <h2 id="reader-shortcut-title">阅读快捷键</h2>
          <button
            type="button"
            className="ui-btn ui-icon-btn ui-btn-ghost ui-btn-lg"
            aria-label="关闭快捷键帮助"
            onClick={props.onClose}
          >
            <X className="reader-icon" />
          </button>
        </header>
        <dl className="reader-shortcut-list">
          {[
            ["Ctrl / ⌘ + F", "搜索全文"],
            ["T", "打开目录"],
            ["S", "阅读设置"],
            ["B", "切换当前位置书签"],
            ["?", "打开快捷键帮助"],
            ["方向键 / PageUp / PageDown / 空格", "滚动或翻页（正文聚焦时）"],
            ["Home / End", "滚动到开头 / 结尾"],
            ["Esc", "关闭最上层面板"],
          ].map(([key, action]) => (
            <div key={key}>
              <dt>
                <kbd>{key}</kbd>
              </dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
        <p>点击正文或用 Tab 聚焦正文即可使用阅读键；输入文字时不会触发单键快捷键。</p>
      </section>
    </ReaderSheet>
  );
}
