import { useState } from "react";
import { Button, Dialog, Spinner } from "@bcr/react";
import { Play, RotateCcw } from "lucide-react";
import { DataSettings } from "./DataSource";
import { Parameters } from "./Parameters";
import { ResearchTabs } from "./ResearchTabs";
import type { DataSourceController } from "./useDataSource";
import type { ResearchSession } from "./session";
import type { JsgConfig } from "./model";
import type { DraftChange } from "./draft";

export function RunSettings({
  open,
  tab,
  onTab,
  onClose,
  source,
  state,
  changes,
  busy,
  ready,
  onChange,
  onReset,
  onRestore,
  onRun,
  onImport,
  onDemo,
}: {
  open: boolean;
  tab: "parameters" | "data" | "changes";
  onTab: (tab: "parameters" | "data" | "changes") => void;
  onClose: () => void;
  source: DataSourceController;
  state: ResearchSession;
  changes: DraftChange[];
  busy: boolean;
  ready: boolean;
  onChange: (patch: Partial<JsgConfig>) => void;
  onReset: () => void;
  onRestore: () => Promise<void>;
  onRun: () => void;
  onImport: () => void;
  onDemo: () => void;
}) {
  const [restoring, setRestoring] = useState(false),
    [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="运行设置"
      closeLabel="关闭运行设置"
      closable={!restoring}
      className="research-settings-drawer"
    >
      <p className="research-settings-intro">编辑下一次运行，当前结果保持原始配置。</p>
      <ResearchTabs
        label="运行设置分类"
        value={tab}
        onChange={onTab}
        tabs={[
          { value: "parameters", label: "参数" },
          { value: "data", label: "数据与区间" },
          { value: "changes", label: "修改", count: changes.length },
        ]}
      >
        {tab === "parameters" && (
          <Parameters
            config={state.draft}
            manifest={state.dataset?.manifest}
            onChange={onChange}
            onReset={onReset}
            busy={busy || restoring}
          />
        )}
        {tab === "data" && (
          <DataSettings
            source={source}
            disabled={busy || restoring}
            onImport={onImport}
            onDemo={onDemo}
          />
        )}
        {tab === "changes" && (
          <div className="research-draft-changes">
            {changes.length ? (
              <>
                <p>与当前查看的运行相比</p>
                <dl>
                  {changes.map((change) => (
                    <div key={change.label}>
                      <dt>{change.label}</dt>
                      <dd>
                        <span>{change.before}</span>
                        <span aria-label="修改为">→</span>
                        <strong>{change.after}</strong>
                      </dd>
                    </div>
                  ))}
                </dl>
                <Button
                  variant="ghost"
                  disabled={busy || restoring}
                  onClick={() => {
                    setRestoring(true);
                    setError(null);
                    void onRestore()
                      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                      .finally(() => setRestoring(false));
                  }}
                >
                  {restoring ? <Spinner size="sm" /> : <RotateCcw size={14} />}恢复本次运行设置
                </Button>
              </>
            ) : (
              <div className="research-settings-unchanged">
                <RotateCcw size={22} />
                <p>
                  {state.selected ? "设置与当前运行一致" : "开始研究，保存一次运行后即可对比修改。"}
                </p>
              </div>
            )}
            {error && (
              <p className="research-error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </ResearchTabs>
      <div className="research-settings-footer">
        <span>{changes.length ? `${changes.length} 项修改` : "下一次运行"}</span>
        <Button variant="primary" disabled={!ready || busy || restoring} onClick={onRun}>
          <Play size={14} />
          使用设置运行
        </Button>
      </div>
    </Dialog>
  );
}
