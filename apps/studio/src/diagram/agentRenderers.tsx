import type { AgentToolPart } from "@bcr/agent";
import type { ResultRenderer } from "@bcr/agent-ui";
import { useNavigation } from "@bcr/react";
import { validId } from "./model";

type Result = { id: string; title: string; status?: string; format?: string; content?: string };
const accepts = (value: unknown): value is Result =>
  !!value &&
  typeof value === "object" &&
  "id" in value &&
  validId(value.id) &&
  "title" in value &&
  typeof value.title === "string";
function DiagramResult({ part }: { part: AgentToolPart }) {
  const navigation = useNavigation(),
    output = part.result?.output;
  if (!accepts(output)) return null;
  const route = `/diagram?diagram=${encodeURIComponent(output.id)}`;
  return (
    <div className="bcr-chat-evidence">
      {output.status === "saved" && !part.result?.is_error && (
        <p className="bcr-chat-receipt">已保存到本机</p>
      )}
      <a
        href={route}
        onClick={(event) => {
          if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
            return;
          event.preventDefault();
          navigation.navigate(route);
        }}
      >
        {output.title} ↗
      </a>
      {output.format === "svg" && typeof output.content === "string" && (
        <img
          alt={output.title}
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(output.content)}`}
          style={{
            width: "100%",
            maxHeight: 260,
            objectFit: "contain",
            marginTop: 12,
            borderRadius: 8,
          }}
        />
      )}
    </div>
  );
}
export const diagramResultRenderers: readonly ResultRenderer[] = [
  { kind: "diagram.document", version: 1, accepts, component: DiagramResult },
];
