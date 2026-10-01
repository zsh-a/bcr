import {
  ActionMenu,
  EmptyState,
  Toast,
  type Notice,
  type NoticeTone,
  AppToolbar,
} from "@bcr/react";
import {
  Camera,
  Download,
  FileBadge,
  History,
  Image as ImageIcon,
  Shuffle,
  Settings2,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  formatMoney,
  getTemplate,
  isoToday,
  listTemplates,
  mulberry32,
  PHOTO_SCENES,
  randomAddress,
  REGIONS,
  validateBillInput,
  type BillInput,
  type BillViewModel,
  type RegionId,
  type PhotoScene,
} from "@bcr/docgen-core";
import type { GeneratedBill } from "@bcr/docgen-core/dom";
import { Spinner } from "@bcr/react";
import "./styles.css";

interface GeneratedEntry {
  readonly id: number;
  readonly time: string;
  readonly input: BillInput;
  readonly vm: BillViewModel;
  readonly watermark: boolean;
  readonly photoScene: PhotoScene;
  readonly documentBlob: Blob;
  readonly paperBlob: Blob;
}

let nextEntryId = 1;

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

async function runPipeline(
  input: BillInput,
  watermark: boolean,
  scene: PhotoScene,
): Promise<GeneratedBill> {
  // 动态导入 DOM 子路径：node 测试/首屏 bundle 不会碰到栅格化代码
  const { generateBill } = await import("@bcr/docgen-core/dom");
  return await generateBill(input, { watermark }, { scene });
}

export function App() {
  const [regionId, setRegionId] = useState<RegionId>("australia");
  const [docType, setDocType] = useState<string>("au_agl_gas");
  const [name, setName] = useState<string>("");
  const [address, setAddress] = useState<Record<string, string>>({});
  const [dateAuto, setDateAuto] = useState<boolean>(true);
  const [billDate, setBillDate] = useState<string>(isoToday());
  const [photoScene, setPhotoScene] = useState<PhotoScene>("daylight");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState<boolean>(false);
  const [entries, setEntries] = useState<ReadonlyArray<GeneratedEntry>>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [previewTab, setPreviewTab] = useState<"document" | "paper">("document");
  const [workspaceTab, setWorkspaceTab] = useState<"edit" | "preview">("edit");
  const [notice, setNotice] = useState<Notice | null>(null);

  const template = getTemplate(docType) ?? listTemplates(regionId)[0];
  const region = REGIONS.find((r) => r.id === regionId);
  const active = entries.find((e) => e.id === activeId) ?? null;

  const [urls, setUrls] = useState<{ documentUrl: string; paperUrl: string } | null>(null);
  useEffect(() => {
    if (active === null) {
      setUrls(null);
      return;
    }
    const documentUrl = URL.createObjectURL(active.documentBlob);
    const paperUrl = URL.createObjectURL(active.paperBlob);
    setUrls({ documentUrl, paperUrl });
    return () => {
      URL.revokeObjectURL(documentUrl);
      URL.revokeObjectURL(paperUrl);
    };
  }, [active]);

  const showToast = (message: string, tone: NoticeTone = "error"): void =>
    setNotice({ message, tone });

  const selectRegion = (id: RegionId): void => {
    setRegionId(id);
    const first = listTemplates(id)[0];
    if (first !== undefined) setDocType(first.docType);
    setAddress({});
    setErrors({});
  };

  const buildInput = (): BillInput => ({
    docType: template?.docType ?? docType,
    name: name.trim(),
    address,
    billDate: dateAuto ? null : billDate,
  });

  const generate = async (): Promise<void> => {
    if (template === undefined || generating) return;
    const input = buildInput();
    const validation = validateBillInput(template, input);
    setErrors(validation.errors);
    if (!validation.ok) {
      showToast("请填写标记的必填信息", "warning");
      return;
    }
    setGenerating(true);
    setNotice(null);
    try {
      const generated = await runPipeline(input, active?.watermark ?? true, photoScene);
      const entry: GeneratedEntry = {
        id: nextEntryId++,
        time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        input,
        vm: generated.vm,
        watermark: active?.watermark ?? true,
        photoScene,
        documentBlob: generated.documentPng,
        paperBlob: generated.paperJpeg,
      };
      setEntries((prev) => [entry, ...prev].slice(0, 12));
      setActiveId(entry.id);
      setWorkspaceTab("preview");
      showToast("预览已生成，可直接下载", "success");
    } catch (error) {
      showToast(`生成失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setGenerating(false);
    }
  };

  const toggleWatermark = async (): Promise<void> => {
    if (active === null || generating) return;
    const watermark = !active.watermark;
    setGenerating(true);
    setNotice(null);
    try {
      const generated = await runPipeline(active.input, watermark, active.photoScene);
      setEntries((prev) =>
        prev.map((e) =>
          e.id === active.id
            ? {
                ...e,
                watermark,
                documentBlob: generated.documentPng,
                paperBlob: generated.paperJpeg,
              }
            : e,
        ),
      );
    } catch (error) {
      showToast(`重新渲染失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setGenerating(false);
    }
  };

  const fillRandomAddress = (): void => {
    const rng = mulberry32((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
    setAddress(randomAddress(regionId, rng));
    setErrors({});
    if (name.trim().length === 0) {
      const names: Record<RegionId, string[]> = {
        australia: ["Liam Walker", "Olivia Harris", "Noah Clarke", "Ruby Thompson"],
        canada: ["Liam Tremblay", "Emma MacDonald", "Noah Gagnon", "Chloe Martin"],
        hongkong: ["Chan Tai Man", "Cheung Ka Yan", "Lee Wai Kit", "Wong Siu Ling"],
        singapore: ["Tan Wei Ming", "Lim Su Ling", "Ng Kai Jie", "Priya Anand"],
        uk: ["Oliver Smith", "Amelia Jones", "George Brown", "Isla Wilson"],
        germany: ["Lukas Müller", "Anna Schmidt", "Jonas Weber", "Lena Fischer"],
      };
      const pool = names[regionId];
      const pick = pool[Math.floor(rng() * pool.length)];
      if (pick !== undefined) setName(pick);
    }
  };

  const activeUrl =
    urls === null ? null : previewTab === "document" ? urls.documentUrl : urls.paperUrl;

  return (
    <div className="docgen-studio">
      <AppToolbar className="docgen-header">
        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap font-semibold">
          <FileBadge size={20} className="text-accent" />
          DocGen Lab
        </div>
        <nav className="docgen-workspace-tabs" aria-label="文档工作区">
          <button
            type="button"
            aria-pressed={workspaceTab === "edit"}
            onClick={() => setWorkspaceTab("edit")}
          >
            填写
          </button>
          <button
            type="button"
            aria-pressed={workspaceTab === "preview"}
            onClick={() => setWorkspaceTab("preview")}
          >
            预览
          </button>
        </nav>
      </AppToolbar>

      <div className="docgen-layout" data-view={workspaceTab}>
        <aside className="docgen-form">
          <div className="docgen-selectors">
            <label>
              地区
              <select
                className="ui-select"
                aria-label="账单地区"
                value={regionId}
                onChange={(event) => selectRegion(event.target.value as RegionId)}
              >
                {REGIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              模板
              <select
                className="ui-select"
                aria-label="账单模板"
                value={docType}
                onChange={(event) => {
                  setDocType(event.target.value);
                  setErrors({});
                }}
              >
                {listTemplates(regionId).map((t) => (
                  <option key={t.docType} value={t.docType}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="docgen-template-description">{region?.description}</p>
          <div>
            <label htmlFor="docgen-name" className="mb-1 block text-sm text-muted">
              客户姓名{" "}
              <span className="text-danger" aria-hidden="true">
                *
              </span>
            </label>
            <input
              className="ui-input w-full"
              id="docgen-name"
              aria-label="客户姓名"
              aria-required="true"
              value={name}
              placeholder="Elin Sorensen"
              aria-invalid={errors["name"] !== undefined}
              onChange={(e) => {
                setName(e.target.value);
                setErrors((prev) => ({ ...prev, name: "" }));
              }}
            />
            {errors["name"] !== undefined && errors["name"] !== "" && (
              <div className="docgen-field-error">{errors["name"]}</div>
            )}
          </div>

          {template?.fields.map((field) => (
            <div key={field.key}>
              <label
                htmlFor={`docgen-field-${field.key}`}
                className="mb-1 block text-sm text-muted"
              >
                {field.label}
                {field.required && (
                  <span className="text-danger" aria-hidden="true">
                    {" "}
                    *
                  </span>
                )}
              </label>
              <input
                className="ui-input w-full"
                id={`docgen-field-${field.key}`}
                value={address[field.key] ?? ""}
                placeholder={field.placeholder}
                aria-invalid={errors[field.key] !== undefined}
                onChange={(e) => {
                  const value = e.target.value;
                  setAddress((prev) => ({ ...prev, [field.key]: value }));
                  setErrors((prev) => ({ ...prev, [field.key]: "" }));
                }}
              />
              {errors[field.key] !== undefined && errors[field.key] !== "" && (
                <div className="docgen-field-error">{errors[field.key]}</div>
              )}
            </div>
          ))}

          <div>
            <label className="mb-1 block text-sm text-muted">账单日期</label>
            <div className="flex items-center gap-2">
              <select
                className="ui-select"
                value={dateAuto ? "auto" : "manual"}
                onChange={(e) => setDateAuto(e.target.value === "auto")}
              >
                <option value="auto">自动（当天）</option>
                <option value="manual">手动</option>
              </select>
              {!dateAuto && (
                <input
                  className="ui-input flex-1"
                  type="date"
                  value={billDate}
                  onChange={(e) => setBillDate(e.target.value)}
                />
              )}
            </div>
            {errors["billDate"] !== undefined && errors["billDate"] !== "" && (
              <div className="docgen-field-error">{errors["billDate"]}</div>
            )}
          </div>

          <div>
            <label htmlFor="photo-scene" className="mb-1 block text-sm text-muted">
              拍摄场景
            </label>
            <select
              id="photo-scene"
              className="ui-select w-full"
              value={photoScene}
              disabled={generating}
              onChange={(event) => setPhotoScene(event.target.value as PhotoScene)}
            >
              {PHOTO_SCENES.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  {scene.label}
                </option>
              ))}
            </select>
          </div>

          <div className="docgen-form-actions">
            <button type="button" className="ui-btn ui-btn-default" onClick={fillRandomAddress}>
              <Shuffle size={15} />
              随机地址
            </button>
            <button
              type="button"
              className="ui-btn ui-btn-primary flex-1"
              disabled={generating}
              onClick={() => void generate()}
            >
              {generating ? <Spinner size="sm" label="生成中" /> : <FileBadge size={15} />}
              {generating ? "生成中…" : "生成预览"}
            </button>
          </div>

          {entries.length > 0 && (
            <div className="mt-2">
              <div className="mb-2 flex items-center gap-2 text-sm text-muted">
                <History size={14} />
                本次会话生成记录
              </div>
              <div className="flex flex-col gap-1">
                {entries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="docgen-tab w-full justify-between"
                    data-active={entry.id === activeId}
                    onClick={() => {
                      setActiveId(entry.id);
                      setWorkspaceTab("preview");
                    }}
                  >
                    <span className="truncate">
                      {entry.time} ·{" "}
                      {getTemplate(entry.input.docType)?.label ?? entry.input.docType} ·{" "}
                      {entry.vm.customerName}
                    </span>
                    <span className="ml-2 flex-none font-mono text-xs text-faint">
                      {formatMoney(entry.vm.currency, entry.vm.total)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        <main className="docgen-main">
          <div className="docgen-preview-toolbar">
            <button
              type="button"
              className="docgen-tab"
              data-active={previewTab === "document"}
              onClick={() => setPreviewTab("document")}
            >
              <ImageIcon size={15} />
              账单 PNG
            </button>
            <button
              type="button"
              className="docgen-tab"
              data-active={previewTab === "paper"}
              onClick={() => setPreviewTab("paper")}
            >
              <Camera size={15} />
              实拍 JPG
            </button>
            {active !== null && (
              <button
                type="button"
                className="ui-btn ui-btn-primary docgen-download"
                disabled={urls === null || generating}
                onClick={() => {
                  if (activeUrl && active)
                    triggerDownload(
                      activeUrl,
                      `${active.vm.invoiceNumber}${previewTab === "paper" ? "-photo.jpg" : ".png"}`,
                    );
                }}
              >
                <Download size={16} />
                下载
              </button>
            )}
            <ActionMenu
              label="更多预览操作"
              icon={<Settings2 size={18} />}
              className="docgen-preview-actions"
            >
              <button
                type="button"
                className="docgen-tab"
                disabled={active === null || generating}
                onClick={() => void toggleWatermark()}
                title="切换水印并更新预览"
              >
                水印：{(active?.watermark ?? true) ? "开" : "关"}
              </button>

              <button
                type="button"
                className="ui-btn ui-btn-default"
                disabled={urls === null || active === null}
                onClick={() => {
                  if (urls !== null && active !== null) {
                    triggerDownload(urls.documentUrl, `${active.vm.invoiceNumber}.png`);
                  }
                }}
              >
                <Download size={15} />
                下载 PNG
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-default"
                disabled={urls === null || active === null}
                onClick={() => {
                  if (urls !== null && active !== null) {
                    triggerDownload(urls.paperUrl, `${active.vm.invoiceNumber}-photo.jpg`);
                  }
                }}
              >
                <Download size={15} />
                下载实拍 JPG
              </button>
            </ActionMenu>
          </div>

          <div className="docgen-preview-frame relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6">
            {generating && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-scrim">
                <div className="flex items-center gap-2 text-muted">
                  <Spinner label="正在生成预览" />
                  正在生成预览…
                </div>
              </div>
            )}
            {active !== null && activeUrl !== null ? (
              <img
                src={activeUrl}
                alt={previewTab === "document" ? "账单预览" : "实拍合成预览"}
                className="docgen-preview-image max-h-full max-w-full object-contain"
              />
            ) : (
              <EmptyState
                icon={<FileBadge size={20} />}
                title="预览你的文档"
                description="选择模板并填写信息，生成后即可查看和下载。"
                action={
                  <button
                    type="button"
                    className="ui-btn ui-btn-default docgen-empty-action"
                    onClick={() => {
                      setWorkspaceTab("edit");
                      requestAnimationFrame(() =>
                        document.querySelector<HTMLInputElement>(".docgen-form input")?.focus(),
                      );
                    }}
                  >
                    填写信息
                  </button>
                }
              />
            )}
          </div>

          <footer className="border-t border-border px-5 py-2 text-xs text-faint">
            生成文档为虚构示例，仅供版式学习 — 所有机构、地名、货币均为虚构，伪 QR
            仅供装饰不可扫描。
          </footer>
        </main>
      </div>

      <Toast notice={notice} onDismiss={() => setNotice(null)} />
    </div>
  );
}
