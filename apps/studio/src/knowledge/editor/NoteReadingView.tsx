import { useMemo, useRef } from "react";
import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { internalTarget, remarkKnowledgeLinks } from "../notes/markdownAnalysis";
import { attachmentId, type AttachmentReference } from "../attachments/attachmentModel";
import { AttachmentInline, RemoteImage } from "../attachments/AttachmentView";
import type { KnowledgeStore } from "../session/store";

const plugins = [remarkGfm, remarkKnowledgeLinks];
const transformUrl = (url: string) => (attachmentId(url) ? url : defaultUrlTransform(url));
interface ReadingProps {
  body: string;
  refs: AttachmentReference[];
  store: KnowledgeStore;
  locked: boolean;
  onOpenAttachment: (id: string) => void;
  onMenuAttachment: (ref: AttachmentReference, x: number, y: number) => void;
  onOpenLink: (target: string) => void;
  onSaveImage: (file: File, range: { from: number; to: number; expected: string }) => void;
}

/** Stable renderer types preserve loaded image URLs across autosave and analysis updates. */
export function NoteReadingView(props: ReadingProps) {
  const byOffset = useMemo(() => new Map(props.refs.map((ref) => [ref.from, ref])), [props.refs]);
  const latest = useRef({ ...props, byOffset });
  latest.current = { ...props, byOffset };
  const components = useMemo<Components>(
    () => ({
      img: ({ alt, src, node }) => {
        const p = latest.current;
        const id = attachmentId(typeof src === "string" ? src : "");
        const candidate = p.byOffset.get(node?.position?.start.offset ?? -1);
        const ref = candidate?.id === id ? candidate : undefined;
        return id ? (
          <AttachmentInline
            asset={p.store.getSnapshot().attachments?.[id]}
            storage={p.store.attachments}
            label={alt || ""}
            image
            displayWidth={ref?.width}
            onOpen={() => latest.current.onOpenAttachment(id)}
            onMenu={ref ? (x, y) => latest.current.onMenuAttachment(ref, x, y) : undefined}
          />
        ) : (
          <RemoteImage
            src={typeof src === "string" ? src : ""}
            alt={alt || "外部图片"}
            onSave={
              p.locked
                ? undefined
                : async (file) => {
                    const from = node?.position?.start.offset,
                      to = node?.position?.end.offset;
                    if (from === undefined || to === undefined) return;
                    latest.current.onSaveImage(file, {
                      from,
                      to,
                      expected: p.body.slice(from, to),
                    });
                  }
            }
          />
        );
      },
      a: ({ children, href, node }) => {
        const p = latest.current;
        const id = attachmentId(href ?? "");
        if (id) {
          const candidate = p.byOffset.get(node?.position?.start.offset ?? -1);
          const ref = candidate?.id === id ? candidate : undefined;
          return (
            <AttachmentInline
              asset={p.store.getSnapshot().attachments?.[id]}
              storage={p.store.attachments}
              label={ref?.label || ""}
              onOpen={() => latest.current.onOpenAttachment(id)}
              onMenu={ref ? (x, y) => latest.current.onMenuAttachment(ref, x, y) : undefined}
            />
          );
        }
        const prefix = "#knowledge-link=";
        const target = href?.startsWith(prefix)
          ? decodeURIComponent(href.slice(prefix.length))
          : internalTarget(href ?? "");
        return target !== null ? (
          <a
            href={href}
            onClick={(event) => {
              event.preventDefault();
              latest.current.onOpenLink(target);
            }}
          >
            {children}
          </a>
        ) : (
          <a href={href} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        );
      },
    }),
    [],
  );
  const assets = props.store.getSnapshot().attachments;
  return useMemo(
    () =>
      props.body ? (
        <Markdown remarkPlugins={plugins} urlTransform={transformUrl} components={components}>
          {props.body}
        </Markdown>
      ) : (
        <p className="knowledge-hint">开始记录你的第一个想法。</p>
      ),
    [props.body, props.refs, props.locked, assets, components],
  );
}
