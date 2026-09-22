import type { AgentToolPart } from "@bcr/agent";
import type { ResultRenderer } from "@bcr/agent-ui";
import { useNavigation } from "@bcr/react";

type Evidence = { id: string; title: string; preview?: string; body?: string };
const isEvidence = (value: unknown): value is Evidence => {
  if (!value || typeof value !== "object") return false;
  const note = value as Record<string, unknown>;
  return (
    typeof note.id === "string" &&
    typeof note.title === "string" &&
    (note.preview === undefined || typeof note.preview === "string") &&
    (note.body === undefined || typeof note.body === "string")
  );
};
const isSearch = (value: unknown): value is { notes: Evidence[] } =>
  !!value &&
  typeof value === "object" &&
  "notes" in value &&
  Array.isArray(value.notes) &&
  value.notes.every(isEvidence);

function EvidenceList({ notes }: { notes: Evidence[] }) {
  const navigation = useNavigation();
  return (
    <div className="bcr-chat-evidence">
      {notes.length === 0 && <p>没有找到匹配的笔记。</p>}
      {notes.map((note) => {
        const route = `/knowledge?note=${encodeURIComponent(note.id)}`;
        return (
          <div key={note.id}>
            <a
              href={route}
              onClick={(event) => {
                if (
                  event.button !== 0 ||
                  event.ctrlKey ||
                  event.metaKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                navigation.navigate(route);
              }}
            >
              {note.title || "未命名笔记"} ↗
            </a>
            <p>{(note.preview ?? note.body ?? "").slice(0, 320)}</p>
          </div>
        );
      })}
    </div>
  );
}
function SearchResult({ part }: { part: AgentToolPart }) {
  return isSearch(part.result?.output) ? <EvidenceList notes={part.result.output.notes} /> : null;
}
function NoteResult({ part }: { part: AgentToolPart }) {
  return isEvidence(part.result?.output) ? <EvidenceList notes={[part.result.output]} /> : null;
}
export const knowledgeResultRenderers: readonly ResultRenderer[] = [
  { kind: "knowledge.search-results", version: 1, accepts: isSearch, component: SearchResult },
  { kind: "knowledge.note", version: 1, accepts: isEvidence, component: NoteResult },
];
