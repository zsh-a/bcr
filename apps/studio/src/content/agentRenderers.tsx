import { useState, useMemo } from "react";
import type { AgentToolPart } from "@bcr/agent";
import type { ResultRenderer } from "@bcr/agent-ui";
import { Button, useNavigation, useRuntime } from "@bcr/react";
import { workspaceServices } from "../workspace";
import { ArtifactSchema, type ContentArtifact } from "./assets";
import { Schema } from "effect";
type Result = { id: string; title: string; status?: string; artifact?: ContentArtifact };
const accepts = (v: unknown): v is Result =>
  !!v &&
  typeof v === "object" &&
  "id" in v &&
  typeof v.id === "string" &&
  /^[a-zA-Z0-9_-]{1,100}$/u.test(v.id) &&
  "title" in v &&
  typeof v.title === "string";
function ContentResult({ part }: { part: AgentToolPart }) {
  const runtime = useRuntime(),
    navigation = useNavigation(),
    store = useMemo(() => workspaceServices(runtime).content, [runtime]);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const output = part.result?.output;
  if (!accepts(output)) return null;
  return (
    <div className="bcr-chat-evidence">
      <p>
        {output.status === "saved"
          ? "已保存到本机"
          : output.status === "exported"
            ? "导出文件已生成"
            : "内容项目"}
      </p>
      <Button
        onClick={() => navigation.navigate(`/content?project=${encodeURIComponent(output.id)}`)}
      >
        {output.title} ↗
      </Button>
      {output.artifact && (
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            void (async () => {
              const artifact = Schema.decodeUnknownSync(ArtifactSchema)(output.artifact);
              const { download } = await import("./export");
              download(await store.assets.readArtifact(artifact), artifact.name);
            })()
              .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
              .finally(() => setBusy(false));
          }}
        >
          下载文件
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export const contentResultRenderers: readonly ResultRenderer[] = [
  { kind: "content.result", version: 1, accepts, component: ContentResult },
];
