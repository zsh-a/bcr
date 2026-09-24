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
import { useEffect, useMemo, useState } from "react";
import { LAUNCH_PAD_APPS, MANIFESTS, PANELS } from "../shell/registry";
import { resetLayout } from "./Dock";
import { StorageMaintenanceDialogs } from "./StorageMaintenanceDialogs";
import { useStorageMaintenance } from "./useStorageMaintenance";
import { importFile, runTask } from "../runtime";
import { useSelection } from "../router";
import { studio, useStudio } from "../store";

interface Command {
  readonly id: string;
  readonly title: string;
  readonly hint?: string;
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
      // Derived from the app registry so a new app cannot appear on the launch
      // pad and in the Alt+N shortcuts but go missing here. Shortcut hints come
      // from the launch-pad order, so a URL-only route (DocGen Lab) advertises
      // no number instead of inheriting one it does not own.
      ...[...MANIFESTS, ...PANELS].map((app) => {
        const shortcut = LAUNCH_PAD_APPS.indexOf(app) + 1;
        return {
          id: `go-${app.id}`,
          title: `打开 ${app.paletteTitle ?? app.title}`,
          ...(shortcut >= 1 && shortcut <= 9 ? { hint: `Alt+${shortcut}` } : {}),
          icon: <app.icon className="size-3.5" />,
          run: () =>
            app.kind === "panel" ? props.onOpenPanel(app.id) : void navigate({ to: app.path }),
        };
      }),
      {
        id: "import",
        title: "导入文件…",
        hint: "写入 OPFS",
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
        title: "运行 hash.blake3",
        hint: currentFile?.name ?? "未选择文件",
        icon: <Hash className="size-3.5" />,
        run: () => {
          if (currentFile !== undefined) {
            void runTask(services, currentFile.ref, "hash.blake3", currentFile.size);
          }
        },
      },
      {
        id: "waveform",
        title: "运行 audio.waveform",
        hint: currentFile?.name ?? "未选择文件",
        icon: <AudioWaveform className="size-3.5" />,
        run: () => {
          if (currentFile !== undefined) {
            void runTask(services, currentFile.ref, "audio.waveform", currentFile.size);
          }
        },
      },
      {
        id: "cleanup-artifacts",
        title: "清理未追踪 Artifact",
        hint: "预览后确认",
        icon: <Trash2 className="size-3.5" />,
        run: storageMaintenance.startCleanup,
      },
      {
        id: "maintenance-retention",
        title: "整理过期缓存与历史",
        hint: "30d cache · 90d history",
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

  const filtered = commands.filter((c) => c.title.toLowerCase().includes(query.toLowerCase()));

  const close = () => props.onOpenChange(false);

  useEffect(() => {
    if (props.open) {
      setQuery("");
      setActive(0);
    }
  }, [props.open]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      filtered[active]?.run();
      close();
    }
  };

  return (
    <>
      <Dialog open={props.open} onClose={close} title="命令面板" className="studio-command-palette">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="size-3.5 shrink-0 text-faint" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="输入命令…"
            aria-label="搜索命令"
            className="min-w-0 flex-1 bg-transparent text-sm text-text placeholder:text-faint"
          />
          <Kbd>esc</Kbd>
        </div>
        <div className="max-h-64 overflow-auto py-1">
          {filtered.length === 0 && <p className="px-3 py-3 text-xs text-faint">无匹配命令</p>}
          {filtered.map((command, index) => (
            <button
              key={command.id}
              type="button"
              onMouseEnter={() => setActive(index)}
              onClick={() => {
                command.run();
                close();
              }}
              className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors ${
                index === active ? "bg-accent-dim/50 text-text" : "text-muted"
              }`}
            >
              <span className="text-faint">{command.icon}</span>
              <span className="flex-1">{command.title}</span>
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
