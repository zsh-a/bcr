import type { ReactNode } from "react";

export function ConnectionSummary({
  title,
  detail,
  status,
  children,
}: {
  title: string;
  detail: string;
  status: string;
  children?: ReactNode;
}) {
  return (
    <section className="bcr-connection-summary" aria-label="连接摘要">
      <span className="bcr-connection-eyebrow">当前连接</span>
      <strong>{title}</strong>
      <code>{detail}</code>
      <p>{status}</p>
      {children}
    </section>
  );
}
