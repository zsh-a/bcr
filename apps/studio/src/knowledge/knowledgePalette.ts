import type { Dispatch, SetStateAction } from "react";
import type { PaletteAction } from "./NoteSwitcher";
import type { KnowledgeNote } from "./model";
import { closeOtherNotes, setContext, setSidebar, type WorkbenchState } from "./workbench";

/** 面板种类：与外壳的面板栈同型。 */
export type KnowledgePanel = "sync" | "history" | "restore" | "conflicts" | null;

/**
 * 命令面板「操作」组的全部依赖。命令定义集中在本文件，外壳只负责把状态与
 * 能力装进来——新增命令不再让 KnowledgeApp 继续膨胀。
 */
export interface KnowledgePaletteContext {
  note: KnowledgeNote | undefined;
  locked: boolean;
  /** 新建命令的目标集合描述（含「未归类」文案），由外壳按当前筛选算好。 */
  newTargetHint: string;
  tabCount: number;
  focusMode: boolean;
  setWorkbench: Dispatch<SetStateAction<WorkbenchState>>;
  setFocusMode: (next: boolean) => void;
  run: (action: () => Promise<void>) => Promise<void>;
  select: (id: string, open?: boolean) => Promise<void>;
  create: () => Promise<void>;
  daily: () => Promise<string>;
  flushEditor: () => Promise<void>;
  exportNote: () => Promise<void>;
  importResearch: () => Promise<void>;
  exportAll: () => Promise<void>;
  openPanel: (panel: KnowledgePanel) => void;
  closeDrawer: () => void;
  moveNote: (noteId: string) => void;
  confirmDelete: (noteId: string) => void;
  importMarkdown: () => void;
}

export function knowledgePaletteActions(context: KnowledgePaletteContext): PaletteAction[] {
  const {
    note,
    locked,
    newTargetHint,
    tabCount,
    focusMode,
    setWorkbench,
    setFocusMode,
    run,
    select,
    create,
    daily,
    flushEditor,
    exportNote,
    importResearch,
    exportAll,
    openPanel,
    closeDrawer,
    moveNote,
    confirmDelete,
    importMarkdown,
  } = context;
  return [
    {
      id: "new",
      label: "新建笔记",
      hint: `新建到${newTargetHint}`,
      run: async () => {
        await run(create);
      },
    },
    {
      id: "daily",
      label: "今日日记",
      hint: "打开或创建今天的日记",
      run: async () => {
        await run(async () => {
          await select(await daily(), true);
        });
      },
    },
    {
      id: "history",
      label: "打开版本历史",
      run: async () => {
        openPanel("history");
        closeDrawer();
      },
    },
    {
      id: "sync",
      label: "打开同步设置",
      run: async () => {
        openPanel("sync");
        closeDrawer();
      },
    },
    {
      id: "restore",
      label: "备份与恢复",
      run: async () => {
        openPanel("restore");
        closeDrawer();
      },
    },
    {
      id: "export-note",
      label: "导出当前笔记",
      disabled: !note,
      run: async () => {
        await run(exportNote);
      },
    },
    {
      id: "move",
      label: "移动当前笔记",
      hint: "更改集合与文件夹",
      disabled: !note,
      run: async () => {
        await flushEditor();
        moveNote(note!.id);
      },
    },
    {
      id: "rename",
      label: "重命名当前笔记",
      hint: "在标题处直接编辑",
      disabled: !note,
      run: async () => {
        await flushEditor();
        document.querySelector<HTMLInputElement>(".knowledge-title")?.focus();
      },
    },
    {
      id: "delete",
      label: "删除当前笔记",
      hint: "删除后可从历史恢复",
      disabled: !note || locked,
      run: async () => {
        await flushEditor();
        if (note) confirmDelete(note.id);
      },
    },
    {
      id: "import-md",
      label: "导入 Markdown",
      run: async () => {
        importMarkdown();
      },
    },
    {
      id: "import-research",
      label: "从资料集合导入",
      run: async () => {
        await run(importResearch);
      },
    },
    {
      id: "export-all",
      label: "导出知识库",
      run: async () => {
        await run(exportAll);
      },
    },
    {
      id: "close-others",
      label: "关闭其他标签",
      hint: "固定标签保留",
      disabled: !note || tabCount < 2,
      run: async () => {
        await flushEditor();
        setWorkbench((current) => closeOtherNotes(current, note!.id));
      },
    },
    {
      id: "toggle-sidebar",
      label: "切换侧边栏",
      hint: "⌘B",
      run: async () => {
        setWorkbench((current) =>
          setSidebar(current, current.sidebar === "expanded" ? "hidden" : "expanded"),
        );
      },
    },
    {
      id: "toggle-context",
      label: "切换上下文栏",
      run: async () => {
        setWorkbench((current) =>
          setContext(current, current.context === "expanded" ? "hidden" : "expanded"),
        );
      },
    },
    {
      id: "toggle-focus",
      label: focusMode ? "退出专注模式" : "进入专注模式",
      hint: "Esc 退出",
      run: async () => {
        setFocusMode(!focusMode);
      },
    },
  ];
}
