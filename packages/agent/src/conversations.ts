import type { AgentHostServices } from "./host";
import { createAgentSession } from "./session";
import type { AgentSessionOptions } from "./sessionTypes";
import type { RunRound } from "./loop";
import type {
  AgentConversation,
  AgentRun,
  ConversationArchive,
  ConversationStorage,
} from "./conversationTypes";
import { conversationHistory } from "./conversationHistory";
import { restoreConversationArchive } from "./conversationArchive";
import { agentConfigured } from "./settings";

export interface ConversationsSnapshot extends ConversationArchive {
  readonly loading: boolean;
  readonly storageError: string | null;
  readonly running: { readonly conversationId: string; readonly runId: string } | null;
  readonly options: AgentSessionOptions;
}
const newConversation = (): AgentConversation => ({
  id: crypto.randomUUID(),
  title: "新对话",
  draft: "",
  createdAt: Date.now(),
  runs: [],
});

/** Host-owned state: mounting, hiding or replacing a view never owns an execution. */
export function createConversations(
  host: AgentHostServices,
  config: { storage?: ConversationStorage; runRound?: RunRound } = {},
) {
  const first = newConversation();
  let state: ConversationsSnapshot = {
    version: 1,
    activeId: first.id,
    conversations: [first],
    loading: !!config.storage,
    storageError: null,
    running: null,
    options: {
      workspaceId: "home",
      workspaceLabel: "工作台",
      includeContext: true,
      allowEdits: true,
      disabledCapabilities: [],
    },
  };
  const listeners = new Set<() => void>();
  let execution: {
    engine: ReturnType<typeof createAgentSession>;
    controller: AbortController;
  } | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let saveQueue = Promise.resolve();
  let writable = true;
  const emit = (patch: Partial<ConversationsSnapshot>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const archive = (): ConversationArchive => ({
    version: 1,
    activeId: state.activeId,
    conversations: state.conversations,
  });
  const flush = () => {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (!config.storage || !writable || state.loading) return saveQueue;
    const value = archive();
    saveQueue = saveQueue
      .then(() => config.storage!.save(value))
      .then(
        () => {
          if (state.storageError) emit({ storageError: null });
        },
        () =>
          emit({
            storageError:
              "会话保存失败，本页记录仍可用。请检查存储空间，或是否有其他页面更新了会话。",
          }),
      );
    return saveQueue;
  };
  const persist = (immediate = false) => {
    if (immediate) void flush();
    else saveTimer ??= setTimeout(() => void flush(), 350);
  };
  const change = (id: string, fn: (conversation: AgentConversation) => AgentConversation) => {
    emit({ conversations: state.conversations.map((item) => (item.id === id ? fn(item) : item)) });
  };
  const ready = config.storage
    ? Promise.resolve()
        .then(() => config.storage!.load())
        .then((stored) => {
          if (stored !== undefined && stored !== null) emit(restoreConversationArchive(stored));
        })
        .catch(() => {
          writable = false;
          emit({ storageError: "无法读取本地会话，原始存档未覆盖。本次对话仅保留在内存中。" });
        })
        .finally(() => emit({ loading: false }))
    : Promise.resolve();

  async function send(conversationId: string, input: string) {
    await ready;
    const conversation = state.conversations.find((item) => item.id === conversationId);
    if (!conversation || !input.trim()) throw new Error("请输入问题或任务。");
    if (state.running) throw new Error("请先完成或停止正在执行的任务。");
    const endpoint = host.settings.getSnapshot();
    if (!agentConfigured(endpoint)) throw new Error("请先配置接口地址和模型。");
    const messages = [
      ...conversationHistory(conversation.runs),
      { role: "user" as const, content: input.trim() },
    ];
    const run: AgentRun = {
      id: crypto.randomUUID(),
      input: input.trim(),
      workspace: state.options.workspaceLabel,
      startedAt: Date.now(),
      status: "running",
      parts: [],
      error: null,
    };
    const engine = createAgentSession(() => state.options, host, config.runRound);
    const controller = new AbortController();
    execution = { engine, controller };
    emit({ running: { conversationId, runId: run.id } });
    change(conversationId, (item) => ({
      ...item,
      title: item.runs.length ? item.title : run.input.slice(0, 48),
      draft: "",
      runs: [...item.runs, run],
    }));
    persist(true);
    let renderTimer: ReturnType<typeof setTimeout> | undefined;
    const publish = () => {
      clearTimeout(renderTimer);
      renderTimer = undefined;
      const next = engine.getSnapshot();
      change(conversationId, (item) => ({
        ...item,
        runs: item.runs.map((r) =>
          r.id === run.id ? { ...r, parts: next.parts, status: next.status, error: next.error } : r,
        ),
      }));
      persist(next.parts.at(-1)?.type === "tool" || !next.running);
    };
    const unsubscribe = engine.subscribe(() => {
      const next = engine.getSnapshot();
      if (next.parts.at(-1)?.type === "text" && next.status === "running") {
        renderTimer ??= setTimeout(publish, 32);
      } else publish();
    });
    try {
      await engine.run(endpoint, messages, controller.signal);
    } catch {
      // The failed/cancelled run and its receipts are retained, not re-executed.
    } finally {
      publish();
      unsubscribe();
      execution = null;
      emit({ running: null });
      await flush();
    }
  }
  return {
    ready,
    getSnapshot: () => state,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setOptions(options: Partial<AgentSessionOptions>) {
      emit({ options: { ...state.options, ...options } });
    },
    create() {
      if (state.loading) throw new Error("会话正在加载");
      const conversation = newConversation();
      emit({ activeId: conversation.id, conversations: [...state.conversations, conversation] });
      persist(true);
      return conversation.id;
    },
    select(id: string) {
      if (state.conversations.some((item) => item.id === id)) {
        emit({ activeId: id });
        persist();
      }
    },
    setDraft(id: string, draft: string) {
      if (!state.loading) {
        change(id, (item) => ({ ...item, draft }));
        persist();
      }
    },
    send,
    retry(conversationId: string, runId: string) {
      const run = state.conversations.find((item) => item.id === conversationId)?.runs.at(-1);
      if (
        !run ||
        run.id !== runId ||
        run.status !== "failed" ||
        run.parts.some((part) => part.type === "tool")
      )
        throw new Error("本次操作不能直接重试，请核实执行记录后发送新指令。");
      return send(conversationId, run.input);
    },
    cancel(runId: string) {
      if (state.running?.runId === runId) execution?.controller.abort();
    },
    resolveApproval(runId: string, callId: string, approved: boolean) {
      return (
        state.running?.runId === runId &&
        execution?.engine.resolveApproval(callId, approved) === true
      );
    },
    flush,
    dispose() {
      execution?.controller.abort();
      void flush();
      listeners.clear();
    },
  };
}
export type AgentConversations = ReturnType<typeof createConversations>;
