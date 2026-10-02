import { useId, useState } from "react";
import { Pencil, X } from "lucide-react";
import type { ReaderAnnotation, ReaderBookmark } from "@bcr/reader-core";
import { ReaderSheet } from "../workbench/ReaderSheet";
import { reader } from "../state/store";

export function ReaderRecordEditor(props: {
  bookId: string;
  record: ReaderBookmark | ReaderAnnotation;
}) {
  const title = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const annotation = "note" in props.record;
  const label = annotation ? "编辑笔记" : "重命名书签";
  return (
    <>
      <button
        type="button"
        className="reader-record-edit"
        aria-label={`${label} ${props.record.label}`}
        title={label}
        onClick={() => {
          setValue("note" in props.record ? props.record.note : props.record.label);
          setOpen(true);
        }}
      >
        <Pencil className="reader-icon" />
      </button>
      <ReaderSheet open={open} onClose={() => setOpen(false)} labelId={title}>
        <form
          className="reader-mobile-sheet reader-data-sheet"
          onSubmit={(event) => {
            event.preventDefault();
            if (!value.trim()) return;
            if (annotation) reader.updateAnnotation(props.bookId, props.record.id, value);
            else reader.renameBookmark(props.bookId, props.record.id, value);
            setOpen(false);
          }}
        >
          <header className="reader-data-heading">
            <h2 id={title}>{label}</h2>
            <button
              type="button"
              className="ui-btn ui-icon-btn ui-btn-ghost ui-btn-lg"
              aria-label={`关闭${label}`}
              onClick={() => setOpen(false)}
            >
              <X className="reader-icon" />
            </button>
          </header>
          <label>
            {annotation ? "笔记内容" : "书签名称"}
            {annotation ? (
              <textarea
                autoFocus
                aria-label="笔记内容"
                maxLength={2000}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            ) : (
              <input
                autoFocus
                aria-label="书签名称"
                maxLength={160}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            )}
          </label>
          <button
            type="submit"
            className="ui-btn ui-btn-lg ui-btn-primary"
            disabled={!value.trim()}
          >
            保存修改
          </button>
        </form>
      </ReaderSheet>
    </>
  );
}
