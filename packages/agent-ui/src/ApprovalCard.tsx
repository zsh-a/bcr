import type { ApprovalRecord } from "@bcr/agent";
import { ChangePreview } from "./ChangePreview";

export function ApprovalCard({
  approval,
  resolve,
  actionLabel,
}: {
  approval: ApprovalRecord;
  resolve: (approved: boolean) => void;
  actionLabel?: string | undefined;
}) {
  const pending = approval.decision === "pending";
  return (
    <div
      className="bcr-chat-approval"
      role="group"
      aria-label={pending ? "待确认的操作" : "审批记录"}
    >
      <strong>
        {pending
          ? "确认后才会修改"
          : { approved: "已批准", denied: "已拒绝", expired: "审批已失效", pending: "等待确认" }[
              approval.decision
            ]}
      </strong>
      <span>{approval.targetLabel}</span>
      {approval.suggestion || approval.preview ? (
        <ChangePreview
          before={approval.preview?.before ?? approval.original ?? ""}
          after={approval.preview?.after ?? approval.suggestion?.replacement ?? ""}
        />
      ) : (
        <pre className="bcr-chat-diff">{JSON.stringify(approval.call.input ?? {}, null, 2)}</pre>
      )}
      {pending && (
        <div className="bcr-chat-card-actions">
          <button
            type="button"
            className="ui-btn ui-btn-primary ui-btn-lg"
            onClick={() => resolve(true)}
          >
            {actionLabel ?? (approval.suggestion || approval.preview ? "应用修改" : "允许执行")}
          </button>
          <button type="button" className="ui-btn ui-btn-default" onClick={() => resolve(false)}>
            放弃
          </button>
        </div>
      )}
    </div>
  );
}
