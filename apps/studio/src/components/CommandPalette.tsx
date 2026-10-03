import { Dialog, Kbd, useRuntime } from "@bcr/react";
import { useNavigate } from "@tanstack/react-router";
import {
  AudioWaveform,
  Eraser,
  FilePlus2,
  Hash,
  House,
  LayoutGrid,
  Search,
  Trash2,
} from "lucide-react";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LAUNCH_PAD_APPS, MANIFESTS, PANELS, launchShortcut } from "../shell/registry";
import { resetLayout } from "../workbench/Dock";
import { StorageMaintenanceDialogs } from "../workbench/StorageMaintenanceDialogs";
import { useStorageMaintenance } from "../workbench/useStorageMaintenance";
import { importFile, runTask } from "../runtime";
import { useSelection } from "../workbench/useSelection";
import { studio } from "../store";
import { useStudio } from "../useStudio";

interface Command {
  readonly id: string;
  readonly title: string;
  readonly hint?: string;
  readonly alias?: string;
  readonly disabled?: boolean;
  readonly icon: React.ReactNode;
  readonly run: () => void;
}

/** 命令面板（⌘K）：统一 ui-dialog 浮层 + 键盘导航，进出场由 ui.css 统一。 */
export function CommandPalette(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenPanel: (id: string) => void;
}) {
  const services = useRuntime();
  const selection = useSelection();
  const navigate = useNavigate();
  const currentFile = useStudio((s) => s.files.find((f) => f.ref.id === selection.file));
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const keyboardSelection = useRef(false);
  const listId = useId();
  const storageMaintenance = useStorageMaintenance();

  const commands = useMemo<ReadonlyArray<Command>>(
    () => [
      {
        id: "go-home",
        title: "返回主页",
        hint: "Alt+0",
        icon: <House className="size-3.5" />,
        run: () => void navigate({ to: "/" }),
      },
      // Primary workspaces first, then auxiliary apps and global panels. All
      // registered capabilities remain searchable when their home cards are hidden.
      ...[
        ...LAUNCH_PAD_APPS,
        ...MANIFESTS.filter((app) => !LAUNCH_PAD_APPS.includes(app)),
        ...PANELS,
      ].map((app) => {
        const shortcut = launchShortcut(app.id);
        return {
          id: `go-${app.id}`,
          title: `打开 ${app.kind === "workspace" ? (app.displayTitle ?? app.paletteTitle ?? app.title) : app.title}`,
          alias: `打开 ${app.paletteTitle ?? app.title}`,
          ...(shortcut === undefined ? {} : { hint: shortcut }),
          icon: <app.icon className="size-3.5" />,
          run: () =>
            app.kind === "panel" ? props.onOpenPanel(app.id) : void navigate({ to: app.path }),
        };
      }),
      {
        id: "import",
        title: "导入文件…",
        hint: "保存到本地工作台",
        icon: <FilePlus2 className="size-3.5" />,
        run: () => {
          const input = document.createElement("input");
          input.type = "file";
          input.onchange = () => {
            const file = input.files?.[0];
            if (file !== undefined) {
              void importFile(services, file).then((ref) => selection.select({ file: ref.id }));
            }
          };
          input.click();
        },
      },
      {
        id: "blake3",
        title: "计算文件校验值",
        alias: "运行 hash.blake3",
        hint: currentFile?.name ?? "请先在计算工作台选择文件",
        disabled: currentFile === undefined,
        icon: <Hash className="size-3.5" />,
        run: () => {
          if (currentFile !== undefined) {
            void runTask(services, currentFile.ref, "hash.blake3", currentFile.size);
          }
        },
      },
      {
        id: "waveform",
        title: "生成音频波形",
        alias: "运行 audio.waveform",
        hint: currentFile?.name ?? "请先在计算工作台选择文件",
        disabled: currentFile === undefined,
        icon: <AudioWaveform className="size-3.5" />,
        run: () => {
          if (currentFile !== undefined) {
            void runTask(services, currentFile.ref, "audio.waveform", currentFile.size);
          }
        },
      },
      {
        id: "cleanup-artifacts",
        title: "清理未使用的本地文件",
        alias: "清理未追踪 Artifact",
        hint: "预览后确认",
        icon: <Trash2 className="size-3.5" />,
        run: storageMaintenance.startCleanup,
      },
      {
        id: "maintenance-retention",
        title: "整理过期缓存与历史",
        hint: "缓存保留 30 天 · 历史保留 90 天",
        icon: <Eraser className="size-3.5" />,
        run: storageMaintenance.startMaintenance,
      },
      {
        id: "clear-console",
        title: "清空控制台",
        icon: <Eraser className="size-3.5" />,
        run: () => studio.clearLogs(),
      },
      {
        id: "reset-layout",
        title: "重置工作台布局",
        hint: "清除布局缓存并刷新",
        icon: <LayoutGrid className="size-3.5" />,
        run: resetLayout,
      },
    ],
    [
      services,
      selection,
      currentFile,
      navigate,
      props.onOpenPanel,
      storageMaintenance.startCleanup,
      storageMaintenance.startMaintenance,
    ],
  );

  const filtered = commands.filter((c) =>
    `${c.title} ${c.alias ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const close = () => props.onOpenChange(false);

  useLayoutEffect(() => {
    if (props.open) {
      setQuery("");
      setActive(0);
      if (list.current) list.current.scrollTop = 0;
    }
  }, [props.open]);

  useLayoutEffect(() => {
    if (!props.open || !keyboardSelection.current) return;
    list.current
      ?.querySelector<HTMLElement>(`[data-command-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
    keyboardSelection.current = false;
  }, [active, props.open]);

  const execute = (command: Command | undefined) => {
    if (!command || command.disabled) return;
    command.run();
    close();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      keyboardSelection.current = true;
      setActive((i) => Math.max(0, Math.min(i + 1, filtered.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      keyboardSelection.current = true;
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      execute(filtered[active]);
    }
  };

  return (
    <>
      <Dialog
        open={props.open}
        onClose={close}
        title="命令面板"
        className="studio-command-palette"
        initialFocusRef={input}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="size-3.5 shrink-0 text-faint" />
          <input
            ref={input}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              if (list.current) list.current.scrollTop = 0;
            }}
            onKeyDown={onKeyDown}
            placeholder="输入命令…"
            aria-label="搜索命令"
            aria-controls={listId}
            className="min-w-0 flex-1 bg-transparent text-lg text-text placeholder:text-faint"
          />
          <Kbd>esc</Kbd>
        </div>
        <div ref={list} id={listId} className="max-h-64 overflow-auto py-1">
          {filtered.length === 0 && <p className="px-3 py-3 text-xs text-faint">无匹配命令</p>}
          {filtered.map((command, index) => (
            <button
              key={command.id}
              type="button"
              data-command-index={index}
              data-command-id={command.id}
              disabled={command.disabled}
              onFocus={() => setActive(index)}
              onMouseEnter={() => setActive(index)}
              onClick={() => {
                execute(command);
              }}
              className={`studio-command-row flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                index === active ? "bg-accent-dim/50 text-text" : "text-muted"
              }`}
            >
              <span className="text-faint">{command.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block">{command.title}</span>
                {command.id.startsWith("go-") &&
                  command.alias &&
                  command.alias !== command.title && (
                    <span className="block text-xs text-faint">
                      {command.alias.replace(/^打开 /u, "")}
                    </span>
                  )}
              </span>
              {command.hint !== undefined && (
                <span className="font-mono text-xs text-faint">{command.hint}</span>
              )}
            </button>
          ))}
        </div>
      </Dialog>

      <StorageMaintenanceDialogs controller={storageMaintenance} />
    </>
  );
}
