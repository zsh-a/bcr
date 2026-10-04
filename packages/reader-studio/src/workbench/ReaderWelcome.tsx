import { useRef, useState } from "react";
import { BookOpen, Upload } from "lucide-react";
import { readerAcceptAttribute } from "@bcr/reader-core";
import { useReader } from "../state/useReader";
import "./reader-welcome.css";

const WELCOME_KEY = "bcr-reader-welcome-dismissed";
export function ReaderWelcome({ onImport }: { onImport: (files: readonly File[]) => void }) {
  const hasBooks = useReader((state) =>
    state.library.some((book) => book.id !== "demo-reading-space"),
  );
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(WELCOME_KEY) === "true";
    } catch {
      return false;
    }
  });
  const input = useRef<HTMLInputElement>(null);
  if (hasBooks || dismissed) return null;
  return (
    <section className="reader-welcome" aria-label="开始阅读">
      <div>
        <span className="reader-welcome-label">你的随身书库</span>
        <h2>带上你的第一本书</h2>
        <p>导入 EPUB、PDF、TXT 等本地文件，随时继续阅读。</p>
      </div>
      <div className="reader-welcome-actions">
        <button
          type="button"
          className="ui-btn ui-btn-primary"
          onClick={() => input.current?.click()}
        >
          <Upload size={18} />
          导入第一本书
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-ghost"
          onClick={() => {
            setDismissed(true);
            try {
              localStorage.setItem(WELCOME_KEY, "true");
            } catch {
              /* Dismiss for this session. */
            }
          }}
        >
          <BookOpen size={18} />
          先读示例
        </button>
      </div>
      <input
        ref={input}
        hidden
        type="file"
        multiple
        accept={readerAcceptAttribute()}
        aria-label="导入第一本书的文件"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (files.length) onImport(files);
        }}
      />
    </section>
  );
}
