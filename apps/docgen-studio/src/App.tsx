import {
  Camera,
  Download,
  Droplets,
  FileBadge,
  Flame,
  History,
  Image as ImageIcon,
  Loader2,
  Shuffle,
  Wifi,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  formatMoney,
  getTemplate,
  isoToday,
  listTemplates,
  mulberry32,
  randomAddress,
  REGIONS,
  validateBillInput,
  type BillInput,
  type BillKind,
  type BillViewModel,
  type RegionId,
} from "@bcr/docgen-core";
import type { GeneratedBill } from "@bcr/docgen-core/dom";
import "./styles.css";

const KIND_ICONS: Record<BillKind, LucideIcon> = {
  water: Droplets,
  power: Zap,
  gas: Flame,
  telecom: Wifi,
};

interface GeneratedEntry {
  readonly id: number;
  readonly time: string;
  readonly input: BillInput;
  readonly vm: BillViewModel;
  readonly watermark: boolean;
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

async function runPipeline(input: BillInput, watermark: boolean): Promise<GeneratedBill> {
  // 动态导入 DOM 子路径：node 测试/首屏 bundle 不会碰到栅格化代码
  const { generateBill } = await import("@bcr/docgen-core/dom");
  return await generateBill(input, { watermark });
}

export function App() {
  const [regionId, setRegionId] = useState<RegionId>("nordhavn");
  const [docType, setDocType] = useState<string>("nh_water");
  const [name, setName] = useState<string>("");
  const [address, setAddress] = useState<Record<string, string>>({});
  const [dateAuto, setDateAuto] = useState<boolean>(true);
  const [billDate, setBillDate] = useState<string>(isoToday());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState<boolean>(false);
  const [entries, setEntries] = useState<ReadonlyArray<GeneratedEntry>>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [previewTab, setPreviewTab] = useState<"document" | "paper">("document");
  const [toast, setToast] = useState<string | null>(null);

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

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(timer);
  }, [toast]);

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
      setToast("表单校验未通过，请检查标红字段");
      return;
    }
    setGenerating(true);
    try {
      const generated = await runPipeline(input, active?.watermark ?? true);
      const entry: GeneratedEntry = {
        id: nextEntryId++,
        time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        input,
        vm: generated.vm,
        watermark: active?.watermark ?? true,
        documentBlob: generated.documentPng,
        paperBlob: generated.paperJpeg,
      };
      setEntries((prev) => [entry, ...prev].slice(0, 12));
      setActiveId(entry.id);
    } catch (error) {
      setToast(`生成失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setGenerating(false);
    }
  };

  const toggleWatermark = async (): Promise<void> => {
    if (active === null || generating) return;
    const watermark = !active.watermark;
    setGenerating(true);
    try {
      const generated = await runPipeline(active.input, watermark);
      setEntries((prev) =>
        prev.map((e) =>
          e.id === active.id
            ? { ...e, watermark, documentBlob: generated.documentPng, paperBlob: generated.paperJpeg }
            : e,
        ),
      );
    } catch (error) {
      setToast(`重新渲染失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setGenerating(false);
    }
  };

  const fillRandomAddress = (): void => {
    const rng = mulberry32((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
    setAddress(randomAddress(regionId, rng));
    setErrors({});
    if (name.trim().length === 0) {
      const names = regionId === "nordhavn"
        ? ["Elin Sorensen", "Marek Volkov", "Ida Bergstrom", "Lars Nyholm"]
        : ["Ana Ribeiro", "Theo Marchetti", "Priya Anand", "Jonah Whitfield"];
      const pick = names[Math.floor(rng() * names.length)];
      if (pick !== undefined) setName(pick);
    }
  };

  const activeUrl = urls === null ? null : previewTab === "document" ? urls.documentUrl : urls.paperUrl;

  return (
    <div className="docgen-studio">
      <header className="flex items-center gap-4 border-b border-border bg-surface/95 px-5 py-3">
        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <FileBadge size={20} className="text-accent" />
          DocGen Lab
        </div>
        <div className="flex items-center gap-1">
          {REGIONS.map((r) => (
            <button
              key={r.id}
              type="button"
              className="docgen-tab"
              data-active={r.id === regionId}
              onClick={() => selectRegion(r.id)}
            >
              <span aria-hidden>{r.flag}</span>
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 border-l border-border pl-4">
          {listTemplates(regionId).map((t) => {
            const Icon = KIND_ICONS[t.kind];
            return (
              <button
                key={t.docType}
                type="button"
                className="docgen-tab"
                data-active={t.docType === docType}
                onClick={() => {
                  setDocType(t.docType);
                  setErrors({});
                }}
              >
                <Icon size={15} />
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="ml-auto text-xs text-faint">{region?.description ?? ""}</div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[380px] flex-none flex-col gap-4 overflow-y-auto border-r border-border p-5">
          <div>
            <label className="mb-1 block text-sm text-muted">
              客户姓名 <span className="text-danger">*</span>
            </label>
            <input
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
              <label className="mb-1 block text-sm text-muted">
                {field.label}
                {field.required && <span className="text-danger"> *</span>}
              </label>
              <input
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
                value={dateAuto ? "auto" : "manual"}
                onChange={(e) => setDateAuto(e.target.value === "auto")}
                style={{ width: "auto" }}
              >
                <option value="auto">自动（当天）</option>
                <option value="manual">手动</option>
              </select>
              {!dateAuto && (
                <input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
              )}
            </div>
            {errors["billDate"] !== undefined && errors["billDate"] !== "" && (
              <div className="docgen-field-error">{errors["billDate"]}</div>
            )}
          </div>

          <div className="flex gap-2">
            <button type="button" className="btn" onClick={fillRandomAddress}>
              <Shuffle size={15} />
              随机地址
            </button>
            <button
              type="button"
              className="btn btn-primary flex-1"
              disabled={generating}
              onClick={() => void generate()}
            >
              {generating ? <Loader2 size={15} className="animate-spin" /> : <FileBadge size={15} />}
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
                    onClick={() => setActiveId(entry.id)}
                  >
                    <span className="truncate">
                      {entry.time} · {getTemplate(entry.input.docType)?.label ?? entry.input.docType} ·{" "}
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

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-border px-5 py-2.5">
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
            <button
              type="button"
              className="docgen-tab"
              disabled={active === null || generating}
              onClick={() => void toggleWatermark()}
              title="切换后重新栅格化"
            >
              水印：{active?.watermark ?? true ? "开" : "关"}
            </button>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                className="btn"
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
                className="btn"
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
            </div>
          </div>

          <div className="docgen-preview-frame relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6">
            {generating && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg/60 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-muted">
                  <Loader2 size={18} className="animate-spin" />
                  正在栅格化与合成…
                </div>
              </div>
            )}
            {active !== null && activeUrl !== null ? (
              <img
                src={activeUrl}
                alt={previewTab === "document" ? "账单预览" : "实拍合成预览"}
                className="max-h-full max-w-full rounded-sm object-contain shadow-2xl"
              />
            ) : (
              <div className="text-center text-faint">
                <FileBadge size={40} className="mx-auto mb-3 opacity-40" />
                填写左侧表单后点击「生成预览」
                <div className="mt-1 text-xs">同一姓名 + 地址将生成完全一致的虚构账单</div>
              </div>
            )}
          </div>

          <footer className="border-t border-border px-5 py-2 text-xs text-faint">
            生成文档为虚构示例，仅供版式学习 — 所有机构、地名、货币均为虚构，伪 QR 仅供装饰不可扫描。
          </footer>
        </main>
      </div>

      {toast !== null && <div className="docgen-toast">{toast}</div>}
    </div>
  );
}
