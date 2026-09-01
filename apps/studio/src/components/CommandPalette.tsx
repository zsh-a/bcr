import { Dialog } from "@base-ui/react/dialog";
import { useNavigate } from "@tanstack/react-router";
import {
  AudioWaveform,
  BookOpenText,
  ChartCandlestick,
  Eraser,
  FilePlus2,
  Globe2,
  Hash,
  House,
  LayoutGrid,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import { resetLayout } from "./Dock";
import { importFile, runTask } from "../runtime";
import { useSelection } from "../router";
import { useServices } from "../services";
import { studio, useStudio } from "../store";

interface Command {
  readonly id: string;
  readonly title: string;
  readonly hint?: string;
  readonly icon: React.ReactNode;
  readonly run: () => void;
}

/** 命令面板（Base UI Dialog + ⌘K）。 */
export function CommandPalette(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const services = useServices();
  const selection = useSelection();
  const navigate = useNavigate();
  const currentFile = useStudio((s) => s.files.find((f) => f.ref.id === selection.file));
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const commands = useMemo<ReadonlyArray<Command>>(
    () => [
      {
        id: "go-home",
        title: "返回主页",
        hint: "Alt+0",
        icon: <House className="size-3.5" />,
        run: () => void navigate({ to: "/" }),
      },
      {
        id: "go-studio",
        title: "打开 Studio 工作台",
        hint: "Alt+1",
        icon: <LayoutGrid className="size-3.5" />,
        run: () => void navigate({ to: "/studio" }),
      },
      {
        id: "go-media",
        title: "打开 Media Studio",
        hint: "Alt+2",
        icon: <AudioWaveform className="size-3.5" />,
        run: () => void navigate({ to: "/media" }),
      },
      {
        id: "go-quant",
        title: "打开 Quant Lab",
        hint: "Alt+3",
        icon: <ChartCandlestick className="size-3.5" />,
        run: () => void navigate({ to: "/quant" }),
      },
      {
        id: "go-markets",
        title: "打开 Market Atlas",
        hint: "Alt+4",
        icon: <Globe2 className="size-3.5" />,
        run: () => void navigate({ to: "/markets" }),
      },
      {
        id: "go-manga",
        title: "打开 Manga Studio",
        hint: "Alt+5",
        icon: <BookOpenText className="size-3.5" />,
        run: () => void navigate({ to: "/manga" }),
      },
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
    [services, selection, currentFile, navigate],
  );

  const filtered = commands.filter((c) => c.title.toLowerCase().includes(query.toLowerCase()));

  const close = () => props.onOpenChange(false);

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
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        props.onOpenChange(open);
        if (open) {
          setQuery("");
          setActive(0);
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Popup className="fixed top-[18%] left-1/2 z-50 w-105 -translate-x-1/2 overflow-hidden rounded-[var(--radius-md)] border border-border-strong bg-raised shadow-2xl shadow-black/60 outline-none studio-enter">
          <Dialog.Title className="sr-only">命令面板</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <Search className="size-3.5 text-faint" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="输入命令…"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-text outline-none placeholder:text-faint"
            />
            <kbd className="rounded-[var(--radius-xs)] border border-border px-1 font-mono text-[10px] text-faint">
              esc
            </kbd>
          </div>
          <div className="max-h-64 overflow-auto py-1">
            {filtered.length === 0 && (
              <p className="px-3 py-3 text-[11px] text-faint">无匹配命令</p>
            )}
            {filtered.map((command, index) => (
              <button
                key={command.id}
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => {
                  command.run();
                  close();
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] transition-colors ${
                  index === active ? "bg-accent-dim/50 text-text" : "text-muted"
                }`}
              >
                <span className="text-faint">{command.icon}</span>
                <span className="flex-1">{command.title}</span>
                {command.hint !== undefined && (
                  <span className="font-mono text-[10px] text-faint">{command.hint}</span>
                )}
              </button>
            ))}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
