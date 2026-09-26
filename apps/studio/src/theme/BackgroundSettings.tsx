import { Button, IconButton } from "@bcr/react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { ImagePlus, X } from "lucide-react";
import { backgroundStore } from "./backgroundBrowser";
import { prepareBackground } from "./background";
import "./background.css";

export function BackgroundSettings() {
  const id = useId();
  const { value, error } = useSyncExternalStore(
    backgroundStore.subscribe,
    backgroundStore.getSnapshot,
  );
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState("");
  const [shade, setShade] = useState<number | null>(null);
  const locked = useRef(false);
  const [message, setMessage] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  // anchor() 在本 Chromium 不支持 max-height（解析期存活、计算期无效）。
  // toggle 时刻的 rect.top 是布局未定态（顶栏换行/主题重排在其后落定），
  // 故 clamp 自校正：rAF 合并 + ResizeObserver 兜住一切布局漂移，逐帧收敛。
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    let frame = 0;
    const clamp = () => {
      if (!element.matches(":popover-open")) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!element.matches(":popover-open")) return;
        const top = element.getBoundingClientRect().top;
        element.style.maxHeight = `calc(100dvh - ${Math.round(top)}px - var(--space-2) - env(safe-area-inset-bottom, 0px))`;
      });
    };
    const observer = new ResizeObserver(clamp);
    observer.observe(document.body);
    const toggle = () => {
      if (element.matches(":popover-open")) clamp();
      // 关闭即清残留：display:none 时 rect.top=0 的假量不得跨开启存活，
      // 下次开启的首帧回落到 CSS 地板预算。
      else element.style.removeProperty("max-height");
    };
    element.addEventListener("toggle", toggle);
    window.addEventListener("resize", clamp);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener("toggle", toggle);
      window.removeEventListener("resize", clamp);
    };
  }, []);
  async function upload(file: File) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setFailure("");
    setMessage("");
    try {
      const image = await prepareBackground(file);
      if (
        backgroundStore.save({
          image,
          name: file.name.slice(0, 200),
          shade: backgroundStore.getSnapshot().value?.shade ?? 65,
        })
      ) {
        setShade(null);
        setMessage("背景已保存到此浏览器");
      }
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : "无法设置背景");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  function commitShade() {
    if (value && shade !== null) {
      setMessage("");
      backgroundStore.save({ ...value, shade });
      setShade(null);
    }
  }
  return (
    <>
      <IconButton
        label="自定义背景"
        title="自定义背景"
        className="studio-background-trigger"
        popoverTarget={id}
      >
        <ImagePlus size={16} aria-hidden="true" />
      </IconButton>
      <div
        ref={panel}
        id={id}
        popover="auto"
        role="dialog"
        aria-label="背景设置"
        className="ui-popover studio-background-settings"
      >
        <header>
          <div>
            <h2>工作区背景</h2>
            <p>用于主页与知识库，阅读和创作画布不变。</p>
          </div>
          <IconButton label="关闭背景设置" size="sm" popoverTarget={id} popoverTargetAction="hide">
            <X size={18} />
          </IconButton>
        </header>
        <div
          className="studio-background-preview"
          style={
            {
              backgroundImage: value ? `url("${value.image}")` : undefined,
              "--workspace-shade": `${shade ?? value?.shade ?? 65}%`,
            } as CSSProperties
          }
        >
          <span>专注于你的想法</span>
          <small>{value ? value.name : "使用主题默认背景"}</small>
        </div>
        <fieldset disabled={busy} aria-busy={busy}>
          <label className="studio-background-upload">
            {busy ? "正在处理图片…" : value ? "更换图片" : "选择本地图片"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label="背景图片"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void upload(file);
              }}
            />
          </label>
          <p>JPG、PNG、WebP，最大 10 MB。自动压缩后仅保存在此浏览器，不上传、不参与笔记同步。</p>
          {value && (
            <label className="studio-background-shade">
              遮罩强度 <output>{shade ?? value.shade}%</output>
              <input
                aria-label="背景遮罩强度"
                type="range"
                min="40"
                max="90"
                step="5"
                value={shade ?? value.shade}
                onChange={(event) => setShade(Number(event.target.value))}
                onPointerUp={commitShade}
                onKeyUp={commitShade}
                onBlur={commitShade}
              />
              <small>越高越柔和；编辑区和助手保持不透明，确保阅读清晰。</small>
            </label>
          )}
          <Button
            variant="default"
            disabled={!value && !error}
            onClick={() => {
              setFailure("");
              setMessage("");
              if (backgroundStore.save(null)) {
                setShade(null);
                setMessage("已恢复主题默认背景");
              }
            }}
          >
            恢复默认背景
          </Button>
        </fieldset>
        {(failure || error) && <p role="alert">{failure || error}</p>}
        {message && <p role="status">{message}</p>}
      </div>
    </>
  );
}
