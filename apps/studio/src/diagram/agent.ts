import { textVersion } from "@bcr/core";
import type { AgentCapability, AgentTool } from "@bcr/agent";
import {
  describeScene,
  nativeFile,
  record,
  validId,
  type DiagramDocument,
  type DiagramScene,
} from "./model";
import { parseGraph } from "./graph";
import type { DiagramStore } from "./store";

const nodeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label"],
  properties: {
    id: { type: "string", maxLength: 100 },
    label: { type: "string", maxLength: 4000 },
    type: { enum: ["rectangle", "ellipse", "diamond"] },
    x: { type: "number" },
    y: { type: "number" },
    width: { type: "number", minimum: 20 },
    height: { type: "number", minimum: 20 },
    strokeColor: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
    backgroundColor: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
  },
};
const edgeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "source", "target"],
  properties: {
    id: { type: "string" },
    source: { type: "string" },
    target: { type: "string" },
    label: { type: "string", maxLength: 4000 },
  },
};
const graphSchema = {
  type: "object",
  additionalProperties: false,
  required: ["nodes"],
  properties: {
    nodes: { type: "array", maxItems: 500, items: nodeSchema },
    edges: { type: "array", maxItems: 2000, items: edgeSchema },
    direction: { enum: ["RIGHT", "DOWN"] },
  },
};
const { type: _shapeType, ...updateFields } = nodeSchema.properties;
const target = {
  id: { type: "string", description: "Diagram ID; omit only to use the active drawing." },
};
const display = (document: Pick<DiagramDocument, "title" | "scene">) =>
  `图表：${document.title}\n\n${JSON.stringify(describeScene(document.scene), null, 2)}`;
const receipt = (document: DiagramDocument) => ({
  status: "saved",
  id: document.id,
  title: document.title,
  revision: document.revision,
  elements: describeScene(document.scene).length,
  message: "已保存到本机",
});

/** Tools address live drafts; the same native scene drives manual editing and AI operations. */
export function diagramCapability(store: DiagramStore): AgentCapability {
  async function read(args: Record<string, unknown>) {
    await store.ready;
    const id = args.id ?? store.current?.id;
    if (!validId(id)) throw new Error("请提供图表 ID，或先打开一张图表");
    return store.open(id);
  }
  const tools: AgentTool[] = [
    {
      presentation: { kind: "diagram.list", version: 1, label: "查找图表" },
      spec: {
        name: "diagram_list",
        description:
          "List saved local diagrams without opening the editor. Returns IDs, titles and revisions. Use diagram_read to get the live scene before editing.",
        risk: "read_only",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: { type: "string", maxLength: 200 },
            offset: { type: "integer", minimum: 0 },
          },
        },
      },
      call: async (raw) => {
        const args = record(JSON.parse(raw));
        await store.ready;
        if (args.query !== undefined && (typeof args.query !== "string" || args.query.length > 200))
          throw new Error("查询无效");
        const offset = args.offset ?? 0;
        if (!Number.isSafeInteger(offset) || (offset as number) < 0)
          throw new Error("分页位置无效");
        const items = store
          .getSnapshot()
          .filter((item) =>
            item.title
              .toLowerCase()
              .includes(typeof args.query === "string" ? args.query.toLowerCase() : ""),
          );
        return JSON.stringify({
          total: items.length,
          diagrams: items.slice(offset as number, (offset as number) + 40),
          nextOffset: (offset as number) + 40 < items.length ? (offset as number) + 40 : null,
        });
      },
    },
    {
      presentation: { kind: "diagram.document", version: 1, label: "读取画布" },
      spec: {
        name: "diagram_read",
        description:
          "Read the CURRENT native drawing as semantic nodes/edges, including manual edits and selection. Stable IDs and revision are required for patch/layout. Bound text appears as its container label. Images/freehand remain in the native scene. Pages contain 100 items; subsequent pages MUST use revision and nextOffset. Set selectionOnly to read the selected region.",
        risk: "read_only",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            ...target,
            offset: { type: "integer", minimum: 0 },
            revision: { type: "string" },
            selectionOnly: { type: "boolean" },
          },
        },
      },
      call: async (raw) => {
        const args = record(JSON.parse(raw)),
          draft = await read(args),
          document = draft.getSnapshot().document;
        const offset = args.offset ?? 0;
        if (
          !Number.isSafeInteger(offset) ||
          (offset as number) < 0 ||
          (args.selectionOnly !== undefined && typeof args.selectionOnly !== "boolean")
        )
          throw new Error("读取参数无效");
        if (
          ((offset as number) > 0 && args.revision !== document.revision) ||
          (args.revision !== undefined && args.revision !== document.revision)
        )
          throw new Error("画布已变化，请从第一页重新读取");
        const selection = store.current?.id === document.id ? store.current.selection : [];
        const nodes = describeScene(document.scene).filter(
          (element) => !args.selectionOnly || selection.includes(element.id),
        );
        return JSON.stringify({
          id: document.id,
          title: document.title,
          revision: document.revision,
          state: draft.getSnapshot().dirty ? "draft" : "saved",
          selection,
          total: nodes.length,
          elements: nodes.slice(offset as number, (offset as number) + 100),
          nextOffset: (offset as number) + 100 < nodes.length ? (offset as number) + 100 : null,
        });
      },
    },
    {
      presentation: { kind: "diagram.document", version: 1, label: "导出图表" },
      spec: {
        name: "diagram_export",
        description:
          "Export the current live diagram as editable Excalidraw JSON or rendered SVG. SVG is textual geometry, not a multimodal image attachment. Output is bounded to 120000 characters; use the drawing UI for large files. Export does not modify or persist the drawing.",
        risk: "read_only",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: { ...target, format: { enum: ["excalidraw", "svg"] } },
          required: ["format"],
        },
      },
      call: async (raw, context) => {
        const args = record(JSON.parse(raw)),
          document = (await read(args)).getSnapshot().document;
        context?.signal?.throwIfAborted();
        if (args.format !== "svg" && args.format !== "excalidraw") throw new Error("导出格式无效");
        const content =
          args.format === "svg"
            ? await (await import("./scene")).renderSvg(document.scene, [], true)
            : nativeFile(document);
        context?.signal?.throwIfAborted();
        if (content.length > 120000) throw new Error("导出内容过大，请在绘图工作区下载文件");
        return JSON.stringify({
          id: document.id,
          title: document.title,
          revision: document.revision,
          format: args.format,
          content,
        });
      },
    },
  ];
  type Prepared = {
    title: string;
    scene: DiagramScene;
    document?: DiagramDocument;
    creation?: { id: string; creationKey: string };
  };
  function writeTool(
    kind: "create" | "patch" | "layout",
    properties: Record<string, unknown>,
    required: string[],
  ): AgentTool {
    const prepared = new Map<string, Promise<Prepared>>();
    async function prepare(raw: string): Promise<Prepared> {
      const args = record(JSON.parse(raw));
      if (Object.keys(args).some((key) => !Object.hasOwn(properties, key)))
        throw new Error("包含不支持的绘图参数");
      const draft = kind === "create" ? undefined : await read(args);
      const document = draft?.getSnapshot().document;
      if (document && args.revision !== document.revision)
        throw new Error("画布已变化，请重新读取 revision 后修改");
      const key = `${document?.revision ?? "create"}:${raw}`;
      let result = prepared.get(key);
      if (!result) {
        result = (async () => {
          if (kind === "create") {
            if (
              !validId(args.requestId) ||
              typeof args.title !== "string" ||
              !args.title.trim() ||
              args.title.length > 200 ||
              (args.mermaid !== undefined && typeof args.mermaid !== "string") ||
              (args.graph === undefined) === (args.mermaid === undefined)
            )
              throw new Error("请提供 requestId、名称，以及 graph 或 mermaid 中的一种");
            const creation = {
              id: `ai-${textVersion(args.requestId)}`,
              creationKey: textVersion(JSON.stringify(args)),
            };
            const scene =
              args.graph !== undefined
                ? await (await import("./scene")).createGraph(parseGraph(args.graph))
                : await (await import("./scene")).importMermaid(args.mermaid as string);
            return { title: args.title.trim(), scene, creation };
          }
          const engine = await import("./scene");
          if (
            kind === "layout" &&
            ((args.direction !== undefined &&
              args.direction !== "RIGHT" &&
              args.direction !== "DOWN") ||
              (args.ids !== undefined &&
                (!Array.isArray(args.ids) ||
                  args.ids.length > 500 ||
                  !args.ids.every((id) => typeof id === "string"))))
          )
            throw new Error("布局方向或选区无效");
          const scene =
            kind === "patch"
              ? await engine.patchScene(document!.scene, args.patch)
              : await engine.layoutScene(
                  document!.scene,
                  args.ids as string[] | undefined,
                  args.direction as "RIGHT" | "DOWN" | undefined,
                );
          return { title: document!.title, scene, document: document! };
        })();
        if (prepared.size >= 12) prepared.delete(prepared.keys().next().value!);
        prepared.set(key, result);
        void result.catch(() => prepared.delete(key));
      }
      return result;
    }
    return {
      presentation: {
        kind: "diagram.document",
        version: 1,
        label: kind === "create" ? "创建图表" : kind === "patch" ? "修改画布" : "整理布局",
        approvalLabel: kind === "create" ? "创建图表" : "应用修改",
      },
      spec: {
        name: `diagram_${kind}`,
        risk: "high",
        description:
          kind === "create"
            ? "Create a local editable drawing after approval. Supply a stable unique requestId; reuse the SAME requestId and content on retry. Prefer a graph with semantic nodes/edges and let layout compute positions. Mermaid is optional; unsupported raster-only conversions are rejected. Does not need an open editor."
            : kind === "patch"
              ? "Apply one undoable batch after approval. Read diagram_read first and supply its exact revision. Add nodes/edges, update label/geometry/colors or arrow source/target, remove IDs. Untouched native elements and image files are retained. Deleting a node also deletes attached connectors/labels. Locked elements must not be edited. No full-scene replacement."
              : "Automatically lay out supported nodes after approval using the exact revision from diagram_read. Supply ids for a local region, otherwise all unlocked rectangle/ellipse/diamond nodes. Text follows its container, connectors follow moved nodes; unrelated freehand/images remain unchanged.",
        input_schema: { type: "object", additionalProperties: false, properties, required },
      },
      preview: async (raw) => {
        const next = await prepare(raw);
        return {
          targetLabel: `${kind === "create" ? "创建" : "修改"}图表：${next.title}`,
          before: next.document ? display(next.document) : "",
          after: display(next),
        };
      },
      call: async (raw, context) => {
        context?.signal?.throwIfAborted();
        const next = await prepare(raw);
        context?.signal?.throwIfAborted();
        if (next.creation) {
          const draft = await store.create(next.title, next.scene, next.creation);
          return JSON.stringify(receipt(await draft.flush()));
        }
        const draft = await store.open(next.document!.id);
        draft.apply(next.scene, next.document!.revision);
        const saved = await draft.flush();
        return JSON.stringify(receipt(saved));
      },
    };
  }
  tools.push(
    writeTool(
      "create",
      {
        requestId: { type: "string", maxLength: 100 },
        title: { type: "string", maxLength: 200 },
        graph: graphSchema,
        mermaid: { type: "string", maxLength: 50000 },
      },
      ["requestId", "title"],
    ),
  );
  tools.push(
    writeTool(
      "patch",
      {
        ...target,
        revision: { type: "string" },
        patch: {
          type: "object",
          additionalProperties: false,
          properties: {
            addNodes: { type: "array", maxItems: 500, items: nodeSchema },
            addEdges: { type: "array", maxItems: 500, items: edgeSchema },
            remove: { type: "array", maxItems: 500, items: { type: "string" } },
            update: {
              type: "array",
              maxItems: 500,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id"],
                properties: {
                  ...updateFields,
                  source: { type: "string" },
                  target: { type: "string" },
                },
              },
            },
          },
        },
      },
      ["revision", "patch"],
    ),
  );
  tools.push(
    writeTool(
      "layout",
      {
        ...target,
        revision: { type: "string" },
        ids: { type: "array", maxItems: 500, items: { type: "string" } },
        direction: { enum: ["RIGHT", "DOWN"] },
      },
      ["revision"],
    ),
  );
  return {
    id: "diagram.library",
    domain: "diagram",
    scope: "shared",
    label: "绘图",
    description: "查找和读取图表，生成、局部修改与整理画布",
    tools,
    context: () =>
      store.current
        ? `当前绘图 ID：${store.current.id}；选中元素：${JSON.stringify(store.current.selection)}。修改前使用 diagram_read 获取当前 revision。`
        : null,
  };
}
