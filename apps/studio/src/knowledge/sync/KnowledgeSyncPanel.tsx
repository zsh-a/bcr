import { useEffect, useRef, useState } from "react";
import {
  Button,
  Input,
  SecretField,
  ConnectionSummary,
  useAgentHost,
  useCredential,
} from "@bcr/react";
import { knowledgeCredentialId } from "./credential";
import { pendingCount, type KnowledgeState } from "../session/model";
import type { KnowledgeStore } from "../session/store";
import { GitHubKnowledge } from "./github";
import { parseRepository } from "./repository";
import { syncKnowledge, type SyncSummary } from "./sync";
import { SyncConnectionSuccess } from "./SyncConnectionSuccess";
import { syncPhaseText, type SyncPhase } from "./syncFeedback";

/**
 * 同步设置（渐进披露）：可见项只有仓库地址、Token、记住此设备、自动同步；
 * 分支收进「高级」，清除 Token / 断开连接各自一步确认；诚实提示收成一行小字。
 * 连接、凭据与同步语义保持原样。
 */
export function KnowledgeSyncPanel({
  state,
  store,
  token,
  auto,
  setAuto,
  syncing,
  onError,
  flush,
  onViewConflicts,
  onConnected,
  onSyncFailure,
  onSyncProgress,
  onClose,
}: {
  state: KnowledgeState;
  store: KnowledgeStore;
  token: string;
  auto: boolean;
  setAuto: (value: boolean) => void;
  syncing: boolean;
  onError: (value: string) => void;
  flush: () => Promise<void>;
  onViewConflicts: () => void;
  onConnected: (summary?: SyncSummary) => void;
  onSyncFailure: (reason: unknown) => void;
  onSyncProgress: (phase: SyncPhase) => void;
  onClose: () => void;
}) {
  const { credentials } = useAgentHost();
  const credential = useCredential(knowledgeCredentialId(state.sync.target));
  const [replacement, setReplacement] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"clear" | "disconnect" | null>(null);
  const [scope, setScope] = useState<"memory" | "device">(
    credential.scope === "device" ? "device" : "memory",
  );
  const addressOf = () =>
    state.sync.target ? `${state.sync.target.owner}/${state.sync.target.repo}` : "";
  const [address, setAddress] = useState(addressOf),
    [branch, setBranch] = useState(state.sync.target?.branch ?? "");
  const locked = useRef(false);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [addressError, setAddressError] = useState("");
  const [phase, setPhase] = useState<SyncPhase | null>(null);
  const [connected, setConnected] = useState<{ target: string; summary: SyncSummary } | null>(null);
  useEffect(() => {
    if (syncing && !busy) {
      setConnected(null);
      setMessage("");
    }
  }, [syncing, busy]);
  const showSuccess =
    !!connected &&
    connected.target === JSON.stringify(state.sync.target) &&
    !!token &&
    !state.conflicts.length;
  let identity = null;
  try {
    identity = parseRepository(address);
  } catch {
    /* Validate on submission. */
  }
  const sameTarget =
    !!identity && knowledgeCredentialId(identity) === knowledgeCredentialId(state.sync.target);
  const draftToken = replacement ?? (sameTarget ? token : "");
  const tokenUrl = new URL("https://github.com/settings/personal-access-tokens/new");
  tokenUrl.searchParams.set("name", "BCR Knowledge Sync");
  tokenUrl.searchParams.set("contents", "write");
  if (identity) tokenUrl.searchParams.set("target_name", identity.owner);
  async function action(fn: () => Promise<void>) {
    if (locked.current || syncing) return;
    locked.current = true;
    setBusy(true);
    setMessage("");
    setConnected(null);
    onError("");
    try {
      await fn();
    } catch (error) {
      onError(error instanceof Error ? error.message : "操作未完成，请重试。");
    } finally {
      locked.current = false;
      setBusy(false);
      setPhase(null);
    }
  }
  return (
    <section
      className="knowledge-panel knowledge-sync"
      aria-label="GitHub 同步设置"
      aria-busy={busy || syncing}
    >
      {state.sync.target && (
        <ConnectionSummary
          title={`${state.sync.target.owner}/${state.sync.target.repo}`}
          detail={`${state.sync.target.branch} · ${pendingCount(state)} 项待同步`}
          status={token ? "Token 已配置" : "需要补充 Token"}
        />
      )}
      {!state.sync.target && (
        <p className="knowledge-sync-quiet">
          使用私有 GitHub 仓库，让笔记与附件在设备间同步。先创建仓库并添加 README，再填写连接信息。
        </p>
      )}
      <form
        onChange={() => {
          setMessage("");
          setConnected(null);
          onError("");
          setConfirm(null);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          void action(async () => {
            const remote = await GitHubKnowledge.connect(
              address,
              draftToken,
              branch,
              undefined,
              store.attachments,
            );
            const target = remote.target;
            const previousId = knowledgeCredentialId(state.sync.target),
              nextId = knowledgeCredentialId(target);
            await flush();
            const previous = credentials.get(nextId);
            const result = credentials.save(nextId, draftToken, scope);
            try {
              if (result.error) throw new Error(result.error);
              await store.configure(target);
            } catch (error) {
              credentials.save(nextId, previous.value, previous.scope);
              throw error;
            }
            if (previousId !== nextId && state.sync.target) {
              const removed = credentials.save(previousId, "", "memory");
              if (removed.error) throw new Error(removed.error);
            }
            setAddress(`${target.owner}/${target.repo}`);
            setBranch(target.branch);
            setReplacement(null);
            let outcome;
            let summary: SyncSummary = { uploaded: 0, downloaded: 0 };
            try {
              outcome = await syncKnowledge(store, remote, flush, {
                onProgress: (next) => {
                  setPhase(next);
                  onSyncProgress(next);
                },
                onComplete: (value) => {
                  summary = value;
                },
              });
              onConnected(summary);
            } catch (reason) {
              onSyncFailure(reason);
              throw reason;
            }
            if (outcome === "conflicts") {
              setMessage("连接成功，请处理内容冲突。");
              onViewConflicts();
            } else {
              setConnected({ target: JSON.stringify(target), summary });
              setMessage(
                pendingCount(store.getSnapshot())
                  ? "本批已同步，新修改等待下一次同步"
                  : "已与 GitHub 同步",
              );
            }
          });
        }}
      >
        <fieldset disabled={busy || syncing}>
          <label>
            仓库地址
            <Input
              aria-label="GitHub 仓库地址"
              autoComplete="off"
              placeholder="https://github.com/you/notes"
              spellCheck={false}
              value={address}
              aria-invalid={!!addressError}
              aria-describedby={addressError ? "knowledge-repository-error" : undefined}
              onBlur={() => {
                try {
                  if (address.trim()) parseRepository(address);
                  setAddressError("");
                } catch {
                  setAddressError("请填写 github.com 上的仓库地址，或 owner/repo。");
                }
              }}
              onChange={(e) => {
                setAddress(e.target.value);
                setReplacement(null);
                setScope("memory");
                setBranch("");
                setAddressError("");
              }}
              required
            />
            {addressError && (
              <span
                id="knowledge-repository-error"
                className="knowledge-sync-field-error"
                role="alert"
              >
                {addressError}
              </span>
            )}
            <a
              className="knowledge-sync-help-link"
              href="https://github.com/new"
              target="_blank"
              rel="noreferrer"
            >
              创建私有仓库 ↗
            </a>
          </label>
          <SecretField
            key={knowledgeCredentialId(identity)}
            label="GitHub Token"
            saved={sameTarget && !!token}
            value={replacement}
            onChange={setReplacement}
            placeholder="仅授权此仓库的 Contents 读写权限"
          />
          <p className="knowledge-sync-quiet">
            <a href={tokenUrl.href} target="_blank" rel="noreferrer">
              创建专用 Token ↗
            </a>
            {" · "}选择当前仓库，并授予 Contents 读写权限。
          </p>
          <label className="knowledge-checkbox">
            <input
              type="checkbox"
              checked={scope === "device"}
              onChange={(e) => setScope(e.target.checked ? "device" : "memory")}
            />
            记住此设备
          </label>
          <details className="knowledge-sync-advanced">
            <summary>高级</summary>
            <p className="knowledge-sync-quiet">
              附件同步单文件上限 16 MiB；较大文件可通过完整 ZIP 备份迁移。
            </p>
            <label>
              分支
              <Input
                aria-label="GitHub 分支"
                autoComplete="off"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="留空自动使用默认分支"
              />
            </label>
          </details>
        </fieldset>
        <p className="knowledge-sync-quiet">
          {scope === "device"
            ? "此设备会记住 Token，刷新后可继续自动同步。Token 未加密，仅在可信个人设备上使用。"
            : "Token 仅用于本次打开；刷新或关闭页面后需重新输入。"}
        </p>
        <label className="knowledge-checkbox">
          <input
            type="checkbox"
            checked={auto}
            disabled={!state.sync.target || !token || syncing || busy}
            onChange={(e) => setAuto(e.target.checked)}
          />
          自动同步
        </label>
        {!state.sync.target && <p className="knowledge-sync-quiet">连接成功后，可开启自动同步。</p>}
        {auto && !token && (
          <p className="knowledge-sync-quiet">自动同步已暂停，补充 Token 后恢复。</p>
        )}
        {busy && phase && (
          <p className="knowledge-sync-quiet" role="status">
            {syncPhaseText[phase]}…
          </p>
        )}
        {credential.error && <p role="alert">{credential.error}</p>}
        <div className="knowledge-panel-actions">
          <Button
            type="submit"
            variant="primary"
            disabled={busy || syncing || !address.trim() || !draftToken.trim()}
          >
            {busy ? "连接并同步中…" : "连接并同步"}
          </Button>
        </div>
      </form>
      {state.sync.target && (
        <div className="knowledge-sync-manage">
          <span className="ui-section-label">管理</span>
          <div className="knowledge-panel-actions">
            <Button variant="ghost" disabled={busy || syncing} onClick={() => setConfirm("clear")}>
              清除 Token
            </Button>
            {state.sync.target && (
              <Button
                variant="ghost"
                disabled={busy || syncing}
                onClick={() => setConfirm("disconnect")}
              >
                断开连接
              </Button>
            )}
          </div>
          {confirm && (
            <div role="alert" className="knowledge-sync-confirm">
              <p>
                {confirm === "clear"
                  ? "清除 Token？仓库配置会保留。"
                  : "断开连接并清除 Token？本地笔记不会删除。"}
              </p>
              <div className="knowledge-panel-actions">
                <Button variant="ghost" disabled={busy || syncing} onClick={() => setConfirm(null)}>
                  继续保留
                </Button>
                <Button
                  variant="danger"
                  disabled={busy || syncing}
                  onClick={() => {
                    if (confirm === "clear") {
                      setMessage("");
                      setConnected(null);
                      onError("");
                      const result = credentials.save(
                        knowledgeCredentialId(state.sync.target),
                        "",
                        "memory",
                      );
                      setReplacement(null);
                      setScope("memory");
                      if (result.error) onError(result.error);
                      else {
                        setMessage("Token 已清除，仓库配置仍保留。");
                        setConfirm(null);
                      }
                    } else
                      void action(async () => {
                        await flush();
                        // Refuse disconnect before touching credentials when a merge or
                        // an unacknowledged publish still needs the existing connection.
                        await store.configure(null);
                        const result = credentials.save(
                          knowledgeCredentialId(state.sync.target),
                          "",
                          "memory",
                        );
                        setReplacement(null);
                        setScope("memory");
                        setAuto(false);
                        setConfirm(null);
                        setAddress("");
                        setBranch("");
                        if (result.error) throw new Error(result.error);
                        setMessage("已断开连接，本地笔记仍保留");
                      });
                  }}
                >
                  {confirm === "clear" ? "确认清除" : "确认断开"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      {showSuccess && connected && !busy ? (
        <SyncConnectionSuccess
          message={message}
          summary={connected.summary}
          auto={auto}
          remembered={credential.scope === "device"}
          disabled={busy || syncing}
          onEnable={() => setAuto(true)}
          onClose={() => {
            setConnected(null);
            setMessage("");
            onClose();
          }}
        />
      ) : (
        message && <p role="status">{message}</p>
      )}
      {!showSuccess && message && state.sync.target && !busy && (
        <Button variant="primary" onClick={onClose}>
          完成
        </Button>
      )}
      {state.sync.pending && (
        <p className="knowledge-sync-quiet">
          上次提交待核对；下次同步将确认远端结果，保留未完成期间的编辑。
        </p>
      )}
    </section>
  );
}
