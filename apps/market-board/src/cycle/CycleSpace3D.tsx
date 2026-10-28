import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Button, IconButton } from "@bcr/react";
import type { CycleSpacePoint } from "@bcr/market-data/cycle";
import { Box, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import {
  AmbientLight,
  DirectionalLight,
  Group,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Mesh,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  buildSpaceScene,
  cycleSpacePhase,
  disposeSpaceObject,
  prepareCycleSpace,
  readSpacePalette,
  resizeSpaceLabels,
  type CycleRendererState,
  type CycleSpaceCountry,
  type CycleSpaceEngine,
  type CycleSpaceModel,
} from "./cycle-space";
import "./cycle-space.css";

function createCycleSpaceEngine(
  host: HTMLElement,
  onState: (state: CycleRendererState) => void,
  onHover: (country: string | null) => void,
  onSelect: (country: string) => void,
): CycleSpaceEngine | null {
  const canvas = document.createElement("canvas");
  let context: WebGL2RenderingContext | null = null;
  try {
    context = canvas.getContext("webgl2", {
      antialias: true,
      alpha: true,
      powerPreference: "low-power",
    });
  } catch {
    /* A denied graphics context uses the same accessible fallback. */
  }
  if (!context) {
    onState("unavailable");
    return null;
  }
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, context, antialias: true, alpha: true });
  } catch {
    context.getExtension("WEBGL_lose_context")?.loseContext();
    onState("unavailable");
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = SRGBColorSpace;
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  canvas.setAttribute(
    "aria-label",
    "三维周期空间：横轴 CLI，纵轴近三个月变化，纵深为历史月份。可用方向键旋转，Home 复位，加减键缩放。国家与数据也可通过图表外按钮查看。",
  );
  canvas.dataset.renderer = "webgl2";
  host.append(canvas);
  const scene = new Scene(),
    camera = new PerspectiveCamera(42, 1, 0.1, 100),
    controls = new OrbitControls(camera, canvas);
  camera.position.set(9, 6.2, 12);
  controls.target.set(0, 0, -0.4);
  controls.enableDamping = false;
  controls.autoRotate = false;
  controls.minDistance = 9;
  controls.maxDistance = 30;
  controls.minPolarAngle = 0.2;
  controls.maxPolarAngle = Math.PI * 0.8;
  controls.enablePan = false;
  controls.update();
  controls.saveState();
  scene.add(new AmbientLight(0xffffff, 1.45));
  const light = new DirectionalLight(0xffffff, 2.1);
  light.position.set(5, 8, 10);
  scene.add(light);
  let alive = true,
    active = true,
    intersecting = false,
    lost = false,
    failed = false,
    frame = 0,
    count = 0,
    content = new Group(),
    markers: Mesh[] = [],
    model: CycleSpaceModel | null = null,
    selected: string | null = null;
  scene.add(content);
  const canRender = () =>
    alive && active && intersecting && document.visibilityState === "visible" && !lost && !failed;
  const invalidate = () => {
    controls.enabled = canRender();
    if (lost || failed || !alive) return;
    onState(canRender() ? "ready" : "paused");
    if (!canRender() || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!canRender()) return;
      try {
        renderer.render(scene, camera);
        canvas.dataset.renderCount = String(++count);
      } catch {
        failed = true;
        controls.enabled = false;
        onState("unavailable");
      }
    });
  };
  const rebuild = () => {
    if (!alive || lost || failed) return;
    const palette = readSpacePalette(host);
    renderer.setClearColor(palette.surface, 1);
    if (model) {
      scene.remove(content);
      disposeSpaceObject(content);
      const next = buildSpaceScene(model, selected, palette);
      content = next.group;
      markers = next.markers;
      scene.add(content);
      if (host.clientHeight) resizeSpaceLabels(content, camera, host.clientHeight);
    }
    invalidate();
  };
  const resize = () => {
    const width = host.clientWidth,
      height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.zoom = Math.min(1, Math.max(0.25, width / 760));
    camera.updateProjectionMatrix();
    resizeSpaceLabels(content, camera, height);
    invalidate();
  };
  const zoom = (factor: number) => {
    const offset = camera.position.clone().sub(controls.target);
    offset.setLength(
      Math.max(controls.minDistance, Math.min(controls.maxDistance, offset.length() * factor)),
    );
    camera.position.copy(controls.target).add(offset);
    controls.update();
    invalidate();
  };
  const reset = () => {
    controls.reset();
    resize();
    invalidate();
  };
  const raycaster = new Raycaster(),
    pointer = new Vector2();
  const hit = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const value = raycaster.intersectObjects(markers, false)[0]?.object.userData["country"];
    return typeof value === "string" ? value : null;
  };
  let down: [number, number] | null = null;
  const onDown = (event: PointerEvent) => {
    down = [event.clientX, event.clientY];
  };
  const onMove = (event: PointerEvent) => {
    if (!controls.enabled) return;
    const country = hit(event);
    canvas.style.cursor = country ? "pointer" : "grab";
    onHover(country);
  };
  const onUp = (event: PointerEvent) => {
    if (
      !down ||
      !controls.enabled ||
      Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 6
    ) {
      down = null;
      return;
    }
    down = null;
    const country = hit(event);
    if (country) onSelect(country);
  };
  const onLeave = () => {
    down = null;
    onHover(null);
  };
  const onKey = (event: KeyboardEvent) => {
    if (!controls.enabled) return;
    if (["+", "="].includes(event.key)) {
      event.preventDefault();
      zoom(0.85);
      return;
    }
    if (event.key === "-") {
      event.preventDefault();
      zoom(1.15);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      reset();
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const offset = camera.position.clone().sub(controls.target);
    if (event.key === "ArrowLeft" || event.key === "ArrowRight")
      offset.applyAxisAngle(new Vector3(0, 1, 0), event.key === "ArrowLeft" ? -0.12 : 0.12);
    else offset.y = Math.max(1, Math.min(16, offset.y + (event.key === "ArrowUp" ? 0.7 : -0.7)));
    camera.position.copy(controls.target).add(offset);
    controls.update();
    invalidate();
  };
  const onLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    controls.enabled = false;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (alive) onState("lost");
  };
  const onRestored = () => {
    if (!alive) return;
    lost = false;
    rebuild();
    resize();
  };
  const sizeObserver = new ResizeObserver(resize);
  sizeObserver.observe(host);
  const visibilityObserver = new IntersectionObserver((entries) => {
    intersecting = entries[0]?.isIntersecting ?? false;
    invalidate();
  });
  visibilityObserver.observe(host);
  const themeObserver = new MutationObserver(rebuild);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "class"],
  });
  controls.addEventListener("change", invalidate);
  document.addEventListener("visibilitychange", invalidate);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("keydown", onKey);
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  resize();
  return {
    update(next, nextSelected) {
      model = next;
      selected = nextSelected;
      rebuild();
    },
    setActive(value) {
      active = value;
      invalidate();
    },
    reset,
    zoom,
    dispose() {
      alive = false;
      if (frame) cancelAnimationFrame(frame);
      sizeObserver.disconnect();
      visibilityObserver.disconnect();
      themeObserver.disconnect();
      controls.removeEventListener("change", invalidate);
      controls.dispose();
      document.removeEventListener("visibilitychange", invalidate);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("keydown", onKey);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      disposeSpaceObject(content);
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

interface CycleSpace3DProps {
  points: CycleSpacePoint[];
  countries: CycleSpaceCountry[];
  period: string;
  selectedCountry: string | null;
  onSelectCountry: (id: string) => void;
  active: boolean;
}
const STATE_LABEL: Record<CycleRendererState, string> = {
  initializing: "正在准备三维视图",
  ready: "三维视图已就绪",
  paused: "视图已暂停绘制",
  unavailable: "三维视图不可用",
  lost: "图形上下文已中断",
};

export default function CycleSpace3D({
  points,
  countries,
  period,
  selectedCountry,
  onSelectCountry,
  active,
}: CycleSpace3DProps) {
  const host = useRef<HTMLDivElement>(null),
    engine = useRef<CycleSpaceEngine | null>(null);
  const [status, setStatus] = useState<CycleRendererState>("initializing"),
    [hovered, setHovered] = useState<string | null>(null),
    [attempt, setAttempt] = useState(0);
  const model = useMemo(
    () => prepareCycleSpace(points, countries, period),
    [points, countries, period],
  );
  const select = useEffectEvent(onSelectCountry);
  const initialize = useEffectEvent((next: CycleSpaceEngine | null) => {
    next?.update(model, selectedCountry);
    next?.setActive(active);
  });
  useEffect(() => {
    if (!host.current) return;
    const next = createCycleSpaceEngine(host.current, setStatus, setHovered, (id) => select(id));
    engine.current = next;
    initialize(next);
    return () => {
      next?.dispose();
      engine.current = null;
    };
  }, [attempt]);
  useEffect(() => {
    engine.current?.update(model, selectedCountry);
  }, [model, selectedCountry]);
  useEffect(() => {
    engine.current?.setActive(active);
  }, [active]);
  const unavailable = status === "unavailable" || status === "lost";
  const focused =
    hovered ?? selectedCountry ?? model.series.find((series) => series.current)?.country.id;
  const detail = model.series.find((series) => series.country.id === focused),
    point = detail?.current;
  const covered = model.series.filter((series) => series.current).length;
  return (
    <figure className="cycle-space" aria-label="各国 CLI 三维周期轨迹" data-renderer-state={status}>
      <div className="cycle-space-toolbar">
        <span className="cycle-space-status" role="status">
          <Box size={14} aria-hidden="true" />
          {STATE_LABEL[status]}
        </span>
        <div className="cycle-space-actions">
          <IconButton
            label="放大三维视图"
            size="sm"
            disabled={unavailable}
            onClick={() => engine.current?.zoom(0.85)}
          >
            <ZoomIn size={16} />
          </IconButton>
          <IconButton
            label="缩小三维视图"
            size="sm"
            disabled={unavailable}
            onClick={() => engine.current?.zoom(1.15)}
          >
            <ZoomOut size={16} />
          </IconButton>
          <Button
            variant="ghost"
            size="sm"
            disabled={unavailable}
            onClick={() => engine.current?.reset()}
          >
            <RotateCcw size={14} aria-hidden="true" />
            复位视角
          </Button>
        </div>
      </div>
      <div className="cycle-space-stage">
        <div className="cycle-space-canvas" ref={host} />
        {!unavailable && (
          <div className="cycle-space-detail" aria-live="polite" aria-atomic="true">
            <div className="cycle-space-detail-heading">
              <strong>{detail?.country.name ?? "选择一个国家"}</strong>
              <time dateTime={period}>{period}</time>
            </div>
            {point ? (
              <>
                <dl>
                  <div>
                    <dt>CLI</dt>
                    <dd>{point.level.toFixed(2)}</dd>
                  </div>
                  <div>
                    <dt>近三月变化</dt>
                    <dd>
                      {point.momentum > 0 ? "+" : ""}
                      {point.momentum.toFixed(2)}
                      <small> 点</small>
                    </dd>
                  </div>
                </dl>
                <p>{cycleSpacePhase(point)}</p>
              </>
            ) : (
              <p>该国在本月没有可用观测，未向前填充。</p>
            )}
          </div>
        )}
        {unavailable && (
          <div className="cycle-space-fallback" role="status">
            <Box size={28} aria-hidden="true" />
            <strong>{status === "lost" ? "三维视图已暂停" : "此设备暂时无法启用三维视图"}</strong>
            <p>
              {status === "lost"
                ? "图形资源暂时中断，浏览器恢复后会重新绘制。"
                : "需要浏览器支持 WebGL2。二维周期图与指标数据仍可使用。"}
            </p>
            <Button
              size="sm"
              onClick={() => {
                setStatus("initializing");
                setAttempt((value) => value + 1);
              }}
            >
              重新尝试
            </Button>
          </div>
        )}
      </div>
      <figcaption className="cycle-space-caption">
        <p>
          <span>横轴 CLI（100 为趋势）</span>
          <span>纵轴近三月变化（点）</span>
          <span>纵深为历史月份</span>
        </p>
        <p>
          <span>
            {model.from || "—"} — {period} · 当月 {covered}/{countries.length} 国有观测
          </span>
          <span>拖动旋转 · 滚轮缩放 · 点击当月圆点选国</span>
        </p>
        <p className="cycle-space-note">
          仅连接连续月份；各月共用按所选历史区间极值设定的坐标范围。键盘聚焦图形后，可用方向键、加减键与
          Home 操作。
        </p>
      </figcaption>
    </figure>
  );
}
