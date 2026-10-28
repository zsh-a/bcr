import { lazy, Suspense } from "react";
import { Activity, Globe2, Landmark, PanelsTopLeft } from "lucide-react";
import { Button, Spinner, useLocationSearch, useNavigation } from "@bcr/react";
import { legacyWorkspaceUrl } from "../research/legacy-state";
import "./workspace.css";

const LongTermView = lazy(() => import("./MacroView"));
const CycleView = lazy(() => import("../cycle/CycleView"));
const DebtView = lazy(() => import("../debt/DebtView"));
const ResearchView = lazy(() => import("../research/ResearchView"));
export default function MacroWorkspace() {
  const search = useLocationSearch(),
    navigation = useNavigation();
  const params = new URLSearchParams(search),
    requested = params.get("layer");
  const layer =
    requested === "cycle" || requested === "debt" || requested === "history"
      ? requested
      : requested === "research"
        ? "research"
        : ["indicator", "from", "to", "year", "mode", "category", "event"].some((key) =>
              params.has(key),
            )
          ? "history"
          : "research";
  const move = (next: "history" | "cycle" | "debt" | "research") =>
    navigation.navigate(legacyWorkspaceUrl(next, search));
  return (
    <div className="macro-workspace">
      <nav
        className={`macro-layer-nav${layer === "research" ? " macro-unified-nav" : ""}`}
        aria-label="宏观研究视图"
      >
        <Button
          variant="ghost"
          aria-pressed={layer === "research"}
          onClick={() => move("research")}
        >
          <PanelsTopLeft size={15} />
          研究总览
        </Button>
        {layer === "research" ? (
          <details className="macro-specialized-menu">
            <summary>专用图表</summary>
            <div>
              <Button variant="ghost" onClick={() => move("history")}>
                <Globe2 size={15} />
                长期比较
              </Button>
              <Button variant="ghost" onClick={() => move("cycle")}>
                <Activity size={15} />
                周期监测
              </Button>
              <Button variant="ghost" onClick={() => move("debt")}>
                <Landmark size={15} />
                债务信用
              </Button>
            </div>
          </details>
        ) : (
          <>
            <Button
              variant="ghost"
              aria-pressed={layer === "history"}
              onClick={() => move("history")}
            >
              <Globe2 size={15} />
              长期比较
            </Button>
            <Button variant="ghost" aria-pressed={layer === "cycle"} onClick={() => move("cycle")}>
              <Activity size={15} />
              周期监测
            </Button>
            <Button variant="ghost" aria-pressed={layer === "debt"} onClick={() => move("debt")}>
              <Landmark size={15} />
              债务信用
            </Button>
          </>
        )}
        <span>
          {layer === "research"
            ? "统一国家与时间 · 多指标联动"
            : layer === "debt"
              ? "部门杠杆 · 偿债负担 · 信用周期"
              : layer === "cycle"
                ? "月度景气 · 实体活动 · 周期轨迹"
                : "年度宏观 · 全球比较 · 历史事件"}
        </span>
      </nav>
      <Suspense
        fallback={
          <p className="ma-operation" role="status">
            <Spinner size="sm" />
            正在加载内置研究数据…
          </p>
        }
      >
        {layer === "research" ? (
          <ResearchView />
        ) : layer === "debt" ? (
          <DebtView />
        ) : layer === "cycle" ? (
          <CycleView />
        ) : (
          <LongTermView />
        )}
      </Suspense>
    </div>
  );
}
