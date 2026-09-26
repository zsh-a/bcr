import { Button, IconButton } from "@bcr/react";
import { useId, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
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
  const trigger = useRef<HTMLButtonElement>(null);
  function close() {
    panel.current?.hidePopover();
    trigger.current?.focus();
  }
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
        ref={trigger}
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
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      >
        <header>
          <div>
            <h2>工作区背景</h2>
            <p>用于主页与知识库，阅读和创作画布不变。</p>
          </div>
          <IconButton label="关闭背景设置" size="sm" onClick={close}>
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
