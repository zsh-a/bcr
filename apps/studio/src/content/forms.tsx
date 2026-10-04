import { createContext, useContext, useEffect, useId, type ReactNode } from "react";
import { useUpdateParticipant } from "@bcr/react";
import type { ContentProject } from "./model";
export type SaveProject = (project: ContentProject) => Promise<void>;
export type RunAction = (action: () => Promise<void>) => void;
export const ContentDraftContext = createContext<(dirty: boolean) => void>(() => {});
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <label className="content-field">
      <span>{label}</span>
      {children}
      {hint && <small id={id}>{hint}</small>}
    </label>
  );
}
/** Explicit forms retain their inputs on errors and participate in the shell's reload guard. */
export function useUnsavedForm(dirty: boolean) {
  const report = useContext(ContentDraftContext);
  useEffect(() => {
    report(dirty);
    return () => report(false);
  }, [dirty, report]);
  useUpdateParticipant({
    blocked: () => (dirty ? "内容项目有尚未保存的表单，请先保存。" : null),
    save: async () => {},
  });
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty]);
}
