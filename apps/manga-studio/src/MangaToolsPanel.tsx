import { Download, Languages, PanelRight, Plus, ScanText, Type, X } from "lucide-react";
import { ModelCacheSummary, ModelStatusNote } from "./ModelStatus";
import { RegionInspector } from "./RegionInspector";
import { modelKeyForExecution, type MangaModelRecord } from "./model-registry";
import type { MangaModelCacheInfo } from "./model-cache";
import {
  OCR_MODEL_MANIFESTS,
  TRANSLATION_MODEL_MANIFESTS,
  type MangaAdapterExecution,
  type MangaCleanMode,
  type MangaCleanModelManifest,
  type MangaOcrAdapterId,
  type MangaOcrAdapterResolution,
  type MangaOcrDevice,
  type MangaState,
  type MangaTranslationAdapterResolution,
  type MangaTranslationEngineId,
  type TextRegion,
} from "./model";
import { fallbackLabel, percent } from "./mangaPresentation";
import { manga } from "./store";

interface MangaToolsPanelProps {
  readonly state: MangaState;
  readonly selectedRegion: TextRegion | null;
  readonly modelCacheInfo: MangaModelCacheInfo | null;
  readonly modelRecords: ReadonlyArray<MangaModelRecord>;
  readonly modelActionKey: string | null;
  readonly online: boolean;
  readonly runtimeReady: boolean;
  readonly translationResolution: MangaTranslationAdapterResolution;
  readonly ocrResolution: MangaOcrAdapterResolution;
  readonly cleanManifest: MangaCleanModelManifest | undefined;
  readonly cleanFallback: boolean;
  readonly glossarySource: string;
  readonly glossaryTarget: string;
  readonly exporting: boolean;
  readonly onClose: () => void;
  readonly onRefreshModelCache: () => void;
  readonly onClearModelCache: () => void;
  readonly onPreloadModel: (execution: MangaAdapterExecution) => void;
  readonly onGlossarySourceChange: (value: string) => void;
  readonly onGlossaryTargetChange: (value: string) => void;
  readonly onAddGlossary: () => void;
  readonly onAddRegion: () => void;
  readonly onExportPage: () => void;
}

export function MangaToolsPanel({
  state,
  selectedRegion,
  modelCacheInfo,
  modelRecords,
  modelActionKey,
  online,
  runtimeReady,
  translationResolution,
  ocrResolution,
  cleanManifest,
  cleanFallback,
  glossarySource,
  glossaryTarget,
  exporting,
  onClose,
  onRefreshModelCache,
  onClearModelCache,
  onPreloadModel,
  onGlossarySourceChange,
  onGlossaryTargetChange,
  onAddGlossary,
  onAddRegion,
  onExportPage,
}: MangaToolsPanelProps) {
  const modelRecordFor = (execution: MangaAdapterExecution): MangaModelRecord | undefined => {
    const key = modelKeyForExecution(execution);
    return key === undefined ? undefined : modelRecords.find((record) => record.key === key);
  };
  const translationModelRecord = modelRecordFor(translationResolution.execution);
  const ocrModelRecord = modelRecordFor(ocrResolution.execution);
  const translationModel = translationResolution.execution.model;
  const ocrManifest = ocrResolution.manifest;
  const ocrIsLocal = state.settings.ocrAdapter !== "review.manual";
  const ocrSupportsLanguage = ocrResolution.execution.fallbackReason !== "language-unsupported";

  return (
    <aside
      id="manga-mobile-tools-panel"
      className="manga-sidebar manga-sidebar-right"
      aria-label="翻译工具"
    >
      <section className="manga-sidebar-section manga-config-section">
        <div className="manga-section-heading">
          <span>TRANSLATION</span>
          <Languages className="size-4 text-[var(--manga-cyan)]" />
          <button
            type="button"
            className="manga-icon-button manga-mobile-tools-close"
            onClick={onClose}
            aria-label="关闭工具面板"
          >
            <X className="size-4" />
          </button>
        </div>
        <ModelCacheSummary
          info={modelCacheInfo}
          online={online}
          busy={modelActionKey !== null}
          onRefresh={onRefreshModelCache}
          onClear={onClearModelCache}
        />
        <div className="manga-config-grid">
          <label>
            <span>源语言</span>
            <select
              aria-label="源语言"
              value={state.settings.sourceLanguage}
              onChange={(event) =>
                manga.setSettings({ sourceLanguage: event.target.value as "ja" | "en" | "ko" })
              }
            >
              <option value="ja">日本語</option>
              <option value="en">English</option>
              <option value="ko">한국어</option>
            </select>
          </label>
          <label>
            <span>目标语言</span>
            <select value="zh" disabled aria-label="目标语言">
              <option value="zh">简体中文</option>
            </select>
          </label>
        </div>
        <label className="manga-config-wide">
          <span>翻译引擎</span>
          <select
            aria-label="翻译引擎"
            value={state.settings.engine}
            onChange={(event) =>
              manga.setSettings({ engine: event.target.value as MangaTranslationEngineId })
            }
          >
            {TRANSLATION_MODEL_MANIFESTS.map((manifest) => (
              <option key={manifest.id} value={manifest.id}>
                {manifest.label}
              </option>
            ))}
          </select>
        </label>
        {state.settings.engine === "local" && (
          <>
            <div className="manga-model-note">
              <strong>{translationModel ?? "No model manifest"}</strong>
              <small>{translationResolution.effectiveManifest.detail}</small>
            </div>
            <ModelStatusNote
              record={translationModelRecord}
              execution={translationResolution.execution}
              disabled={!runtimeReady || modelActionKey !== null}
              onPreload={() => onPreloadModel(translationResolution.execution)}
              onClear={onClearModelCache}
            />
            {translationResolution.execution.fallbackReason !== undefined && (
              <small className="manga-config-help manga-config-warning">
                {fallbackLabel(translationResolution.execution.fallbackReason)}
              </small>
            )}
            <label className="manga-config-wide">
              <span>翻译设备</span>
              <select
                aria-label="翻译设备"
                value={state.settings.translationDevice}
                onChange={(event) =>
                  manga.setSettings({ translationDevice: event.target.value as MangaOcrDevice })
                }
              >
                <option value="auto">Auto / 自动降级</option>
                <option value="webgpu">WebGPU / 优先 GPU</option>
                <option value="wasm">WASM / 兼容模式</option>
              </select>
            </label>
          </>
        )}
        <label className="manga-config-wide">
          <span>OCR 引擎</span>
          <select
            aria-label="OCR 引擎"
            value={state.settings.ocrAdapter}
            onChange={(event) => {
              const ocrAdapter = event.target.value as MangaOcrAdapterId;
              const manifest = OCR_MODEL_MANIFESTS.find((candidate) => candidate.id === ocrAdapter);
              manga.setSettings({
                ocrAdapter,
                ...(manifest?.model === undefined ? {} : { ocrModel: manifest.model }),
              });
            }}
          >
            {OCR_MODEL_MANIFESTS.map((manifest) => (
              <option key={manifest.id} value={manifest.id}>
                {manifest.label}
              </option>
            ))}
          </select>
        </label>
        {ocrIsLocal && (
          <>
            <label className="manga-config-wide">
              <span>OCR 模型</span>
              <input
                aria-label="OCR 模型"
                value={state.settings.ocrModel}
                onChange={(event) => manga.setSettings({ ocrModel: event.target.value })}
                spellCheck={false}
                aria-describedby="manga-ocr-model-help"
              />
              <small id="manga-ocr-model-help" className="manga-config-help">
                {ocrManifest.detail}
              </small>
            </label>
            <ModelStatusNote
              record={ocrModelRecord}
              execution={ocrResolution.execution}
              disabled={!runtimeReady || modelActionKey !== null}
              onPreload={() => onPreloadModel(ocrResolution.execution)}
              onClear={onClearModelCache}
            />
            {!ocrSupportsLanguage && (
              <small className="manga-config-help manga-config-warning">
                当前源语言不在该模型能力范围内；建议切换 Review adapter 并人工审校。
              </small>
            )}
            <label className="manga-config-wide">
              <span>运行设备</span>
              <select
                aria-label="OCR 运行设备"
                value={state.settings.ocrDevice}
                onChange={(event) =>
                  manga.setSettings({ ocrDevice: event.target.value as MangaOcrDevice })
                }
              >
                <option value="auto">Auto / 自动降级</option>
                <option value="webgpu">WebGPU / 优先 GPU</option>
                <option value="wasm">WASM / 兼容模式</option>
              </select>
            </label>
          </>
        )}
        <div className="manga-config-grid manga-typeset-controls">
          <label>
            <span>原文清理</span>
            <select
              aria-label="原文清理模式"
              value={state.settings.cleanMode}
              onChange={(event) =>
                manga.setSettings({ cleanMode: event.target.value as MangaCleanMode })
              }
            >
              <option value="fill">Fill / 稳定</option>
              <option value="inpaint">Inpaint / 实验（回退 Fill）</option>
            </select>
          </label>
          <label>
            <span className="manga-range-label">
              字号 <b>{state.settings.fontSize.toFixed(1)}×</b>
            </span>
            <input
              className="manga-range"
              type="range"
              min="0.7"
              max="1.4"
              step="0.1"
              value={state.settings.fontSize}
              aria-label="译文字号缩放"
              onChange={(event) => manga.setSettings({ fontSize: Number(event.target.value) })}
            />
          </label>
        </div>
        <small
          className={cleanFallback ? "manga-config-help manga-config-warning" : "manga-config-help"}
        >
          {cleanFallback
            ? `${cleanManifest?.detail ?? "Inpaint 尚未接入"} · 本次有效模式：Fill`
            : cleanManifest?.detail}
        </small>
        <div className="manga-capability-row">
          <span
            className={
              ocrIsLocal
                ? "manga-capability-pill manga-capability-experimental"
                : "manga-capability-pill"
            }
          >
            {ocrIsLocal ? `${ocrManifest.label} · EXP` : "REVIEW OCR"}
          </span>
          <span className="manga-capability-pill">GLOSSARY</span>
          <span
            className={
              state.settings.cleanMode === "inpaint"
                ? "manga-capability-pill manga-capability-experimental"
                : "manga-capability-pill manga-capability-muted"
            }
          >
            {state.settings.cleanMode === "inpaint" ? "INPAINT · FALLBACK" : "INPAINT · SOON"}
          </span>
        </div>
      </section>

      <section className="manga-sidebar-section manga-glossary-section">
        <div className="manga-section-heading">
          <span>GLOSSARY</span>
          <span className="manga-count">{state.glossary.length}</span>
        </div>
        <div className="manga-glossary-form">
          <label>
            <span>原文术语</span>
            <input
              value={glossarySource}
              placeholder="例如：勇者"
              onChange={(event) => onGlossarySourceChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onAddGlossary();
                }
              }}
            />
          </label>
          <label>
            <span>固定译法</span>
            <input
              value={glossaryTarget}
              placeholder="例如：勇者大人"
              onChange={(event) => onGlossaryTargetChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onAddGlossary();
                }
              }}
            />
          </label>
          <button
            type="button"
            className="manga-button manga-button-secondary manga-glossary-add"
            disabled={glossarySource.trim().length === 0 || glossaryTarget.trim().length === 0}
            onClick={onAddGlossary}
          >
            <Plus className="size-3.5" /> 添加术语
          </button>
        </div>
        <div className="manga-glossary-list">
          {state.glossary.length === 0 ? (
            <div className="manga-glossary-empty">暂无术语 · 添加后会在翻译阶段优先采用</div>
          ) : (
            state.glossary.map((entry) => (
              <div className="manga-glossary-entry" key={entry.id}>
                <input
                  value={entry.source}
                  aria-label={`术语原文：${entry.source}`}
                  onChange={(event) =>
                    manga.updateGlossaryEntry(entry.id, { source: event.target.value })
                  }
                />
                <span className="manga-glossary-arrow" aria-hidden="true">
                  →
                </span>
                <input
                  value={entry.target}
                  aria-label={`术语译文：${entry.target}`}
                  onChange={(event) =>
                    manga.updateGlossaryEntry(entry.id, { target: event.target.value })
                  }
                />
                <button
                  type="button"
                  className="manga-icon-button manga-glossary-remove"
                  aria-label={`删除术语：${entry.source}`}
                  onClick={() => manga.removeGlossaryEntry(entry.id)}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="manga-sidebar-section manga-region-section">
        <div className="manga-section-heading">
          <span>TEXT REGIONS</span>
          <button type="button" className="manga-add-region" onClick={onAddRegion}>
            <Plus className="size-3.5" /> 添加区域
          </button>
        </div>
        <div className="manga-region-list">
          {state.regions.length === 0 ? (
            <div className="manga-empty-regions">
              <ScanText className="size-5" />
              <span>运行检测或手动添加文本区域</span>
            </div>
          ) : (
            state.regions.map((region) => (
              <button
                type="button"
                key={region.id}
                className={`manga-region-row ${
                  region.id === state.activeRegionId ? "manga-region-row-active" : ""
                }`}
                onClick={() => manga.setActiveRegion(region.id)}
              >
                <span className="manga-region-index">
                  {region.label.replace("BUBBLE ", "").replace("REVIEW ", "#")}
                </span>
                <span className="manga-region-row-copy">
                  <strong>{region.sourceText}</strong>
                  <small>{region.translatedText}</small>
                </span>
                <span
                  className={`manga-confidence ${
                    region.confidence < 0.7 ? "manga-confidence-low" : ""
                  }`}
                >
                  {percent(region.confidence)}
                </span>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="manga-sidebar-section manga-inspector-section">
        <div className="manga-section-heading">
          <span>INSPECTOR</span>
          <PanelRight className="size-4 text-[var(--manga-muted)]" />
        </div>
        {selectedRegion === null ? (
          <div className="manga-inspector-empty">选择一个文本区域开始审校</div>
        ) : (
          <RegionInspector region={selectedRegion} glossary={state.glossary} />
        )}
      </section>

      <section className="manga-sidebar-section manga-export-section">
        <div className="manga-export-note">
          <Type className="size-4" />
          <span>译文会保留页面尺寸，当前导出为 PNG。</span>
        </div>
        <button
          type="button"
          className="manga-button manga-button-primary manga-export-button"
          disabled={exporting}
          onClick={onExportPage}
        >
          <Download className="size-4" />
          {exporting ? "正在编码…" : "导出当前页面"}
        </button>
      </section>
    </aside>
  );
}
