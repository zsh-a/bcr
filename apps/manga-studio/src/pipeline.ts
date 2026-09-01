import { createImportedRegion } from "./fixture";
import { manga } from "./store";

let activeRun = 0;

const stageTimings: ReadonlyArray<{ id: Parameters<typeof manga.updateStage>[0]; ms: number }> = [
  { id: "normalize", ms: 360 },
  { id: "detect", ms: 440 },
  { id: "ocr", ms: 520 },
  { id: "reading-order", ms: 280 },
  { id: "translate", ms: 480 },
  { id: "remove-text", ms: 380 },
  { id: "typeset", ms: 360 },
  { id: "export", ms: 240 },
];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function translateText(text: string): string {
  const dictionary: Record<string, string> = {
    "ここから、始めよう。": "就从这里开始吧。",
    もうすぐ春だね: "春天快到了呢",
    "見つけた！": "找到了！",
    静かな午後: "安静的午后",
    ページをめくる: "翻开下一页",
    "また明日。": "明天见。",
    待识别文本: "请编辑译文",
  };
  return dictionary[text] ?? (text.trim().length > 0 ? `译：${text}` : "请编辑译文");
}

export async function runMangaPipeline(): Promise<void> {
  const runId = ++activeRun;
  manga.beginRun();

  for (const [index, stage] of stageTimings.entries()) {
    if (runId !== activeRun) return;
    manga.updateStage(stage.id, { status: "running", progress: 0.08 });
    await wait(stage.ms);
    if (runId !== activeRun) return;

    if (
      stage.id === "detect" &&
      manga.getSnapshot().source.kind === "image" &&
      manga.getSnapshot().regions.length === 0
    ) {
      const source = manga.getSnapshot().source;
      manga.addRegion(createImportedRegion(source.width, source.height));
    }
    if (stage.id === "translate") {
      const regions = manga.getSnapshot().regions.map((region) => ({
        ...region,
        translatedText: translateText(region.sourceText),
      }));
      manga.setRegionsForPipeline(regions);
    }

    manga.updateStage(stage.id, { status: "done", progress: 1 });
    manga.log("ok", `${stage.id} · ${index + 2}/9 · artifact ready`);
  }

  if (runId === activeRun) manga.finishRun();
}

export function cancelMangaPipeline(): void {
  activeRun += 1;
  manga.cancelRun();
}
