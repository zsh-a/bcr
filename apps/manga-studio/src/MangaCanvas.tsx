import { FileImage, Minus, Plus, RotateCcw, ScanText } from "lucide-react";
import { useState } from "react";
import type { MangaState, OutputMode } from "./model";
import { manga } from "./store";

export function MangaCanvas({ state }: { readonly state: MangaState }) {
  const [zoom, setZoom] = useState(0.82);

  return (
    <main className="manga-main">
      <div className="manga-main-toolbar">
        <div className="manga-view-tabs" role="tablist" aria-label="页面预览模式">
          {(
            [
              ["translated", "TRANSLATED"],
              ["clean", "CLEAN PAGE"],
              ["original", "ORIGINAL"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={state.outputMode === mode}
              className={
                state.outputMode === mode
                  ? "manga-view-tab manga-view-tab-active"
                  : "manga-view-tab"
              }
              onClick={() => manga.setOutputMode(mode as OutputMode)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="manga-canvas-tools">
          <span className="manga-canvas-label">
            <FileImage className="size-3.5" /> {state.source.name}
          </span>
          <button
            type="button"
            className="manga-icon-button"
            aria-label="缩小页面"
            onClick={() => setZoom((value) => Math.max(0.55, Number((value - 0.08).toFixed(2))))}
          >
            <Minus className="size-4" />
          </button>
          <span className="manga-zoom-value">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="manga-icon-button"
            aria-label="放大页面"
            onClick={() => setZoom((value) => Math.min(1.2, Number((value + 0.08).toFixed(2))))}
          >
            <Plus className="size-4" />
          </button>
          <button
            type="button"
            className="manga-icon-button"
            aria-label="重置缩放"
            onClick={() => setZoom(0.82)}
          >
            <RotateCcw className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="manga-canvas-area">
        <div className="manga-canvas-grid" aria-hidden="true" />
        <div className="manga-canvas-scroll">
          <div className="manga-page-stage" style={{ transform: `scale(${zoom})` }}>
            <div className="manga-page-art">
              <img src={state.source.objectUrl} alt="正在翻译的漫画页面" draggable={false} />
              {state.outputMode !== "original" &&
                state.regions.map((region) => (
                  <button
                    type="button"
                    key={region.id}
                    className={`manga-region manga-region-${state.outputMode} ${
                      region.id === state.activeRegionId ? "manga-region-active" : ""
                    }`}
                    style={{
                      left: `${region.x}%`,
                      top: `${region.y}%`,
                      width: `${region.width}%`,
                      height: `${region.height}%`,
                      transform: `rotate(${region.rotation}deg)`,
                    }}
                    onClick={() => manga.setActiveRegion(region.id)}
                    aria-label={`${region.label}，${region.translatedText}`}
                  >
                    <span className="manga-region-tag">{region.label}</span>
                    {state.outputMode === "translated" && (
                      <span className="manga-region-copy">{region.translatedText}</span>
                    )}
                  </button>
                ))}
            </div>
          </div>
        </div>
        <div className="manga-canvas-caption">
          <span>
            <ScanText className="size-3.5" /> {state.regions.length} text regions · click a region
            to review
          </span>
          <span className="manga-caption-right">
            {state.settings.sourceLanguage.toUpperCase()} → ZH
          </span>
        </div>
      </div>
    </main>
  );
}
