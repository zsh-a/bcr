import type { ApprovalRecord } from "@bcr/agent";

export function ApprovalCard({
  approval,
  resolve,
}: {
  approval: ApprovalRecord;
  resolve: (approved: boolean) => void;
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
        <div className="bcr-chat-changes">
          <div>
            <small>原内容</small>
            <pre>
              {approval.preview
                ? approval.preview.before || "（无原内容）"
                : approval.original || "（插入位置）"}
            </pre>
          </div>
          <div>
            <small>建议内容</small>
            <pre>
              {(approval.preview?.after ?? approval.suggestion?.replacement) || "（删除内容）"}
            </pre>
          </div>
        </div>
      ) : (
        <pre className="bcr-chat-diff">{JSON.stringify(approval.call.input ?? {}, null, 2)}</pre>
      )}
      {pending && (
        <div className="bcr-chat-card-actions">
          <button type="button" className="bcr-chat-primary" onClick={() => resolve(true)}>
            {approval.suggestion || approval.preview ? "应用修改" : "允许执行"}
          </button>
          <button type="button" className="bcr-chat-button" onClick={() => resolve(false)}>
            放弃
          </button>
        </div>
      )}
    </div>
  );
}
