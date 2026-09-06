import { Effect } from "effect";
import type { SearchDocument } from "@bcr/core";
import {
  DOCUMENT_HANDOFF_EVENT,
  decodeDocumentContentPackage,
  decodeDocumentTranslationPackage,
  stageById,
  consumeDocumentHandoff,
  formatLabel,
  getDocumentHandoffMarker,
  listDocumentHandoffs,
  markDocumentHandoffExpired,
  type DocumentHandoffRecord,
  type DocumentJob,
} from "@bcr/document-core";
import { useLocationSearch, useOptionalRuntime, type RuntimeServices } from "@bcr/react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { importDocumentHandoff } from "./runtime";
import { documents } from "./store";

interface DocumentIntegrationState {
  readonly routeBlockId: string | null;
  readonly handoffHistory: ReadonlyArray<DocumentHandoffRecord>;
}

/** Connect Document Studio to host metadata, search, routes, and cross-studio handoffs. */
export function useDocumentIntegration(
  services: RuntimeServices,
  jobs: ReadonlyArray<DocumentJob>,
): DocumentIntegrationState {
  const hostServices = useOptionalRuntime();
  const routeSearch = useLocationSearch();
  const navigate = useNavigate();
  const params = new URLSearchParams(routeSearch);
  const routeJobId = params.get("job");
  const routeHandoffId = params.get("handoff");
  const routeBlockId = params.get("block");
  const appliedRouteRef = useRef("");
  const appliedHandoffRef = useRef("");
  const [handoffHistory, setHandoffHistory] = useState<ReadonlyArray<DocumentHandoffRecord>>(() =>
    listDocumentHandoffs(),
  );

  useEffect(() => {
    documents.connectMetadata(services.metadata);
  }, [services.metadata]);

  useEffect(() => {
    const search = hostServices?.search;
    if (search === undefined) return;
    let cancelled = false;
    // Load each job's durable packages, rather than replacing all block results
    // with whichever job happens to be selected in the Inspector.
    const publish = async () => {
      const records: SearchDocument[] = [];
      for (const job of jobs) {
        if (cancelled) return;
        records.push({
          id: `document:${job.id}`,
          source: "documents",
          kind: "document",
          title: job.name,
          subtitle: `${formatLabel(job.format)} · 文档预览`,
          body: job.sourceTextPreview ?? "",
          tags: ["document", job.format],
          route: `/documents?job=${encodeURIComponent(job.id)}`,
          updatedAt: job.updatedAt,
        });
        const contentRef =
          stageById(job.stages, "extract")?.artifact ?? stageById(job.stages, "ocr")?.artifact;
        const translationRef = stageById(job.stages, "translate")?.artifact;
        for (const [ref, translated] of [
          [contentRef, false],
          [translationRef, true],
        ] as const) {
          if (!ref || cancelled) continue;
          try {
            const bytes = await Effect.runPromise(services.artifacts.get(ref));
            if (cancelled) return;
            const raw: unknown = JSON.parse(new TextDecoder().decode(bytes));
            const content = translated
              ? decodeDocumentTranslationPackage(raw)
              : decodeDocumentContentPackage(raw);
            if (!content) continue;
            for (const block of content.blocks) {
              const translation = "translatedText" in block ? block.translatedText : undefined;
              records.push({
                id: `document:${translated ? "translation" : "block"}:${job.id}:${block.id}`,
                source: "documents",
                kind: "document",
                title: block.label,
                subtitle: `${job.name} · ${translated ? (/fixture/iu.test(content.provenance.adapter) ? "原文 / 演示译文" : "原文 / 译文") : "原文"}`,
                body: [block.text, translation].filter(Boolean).join("\n"),
                tags: ["document", job.format, translated ? "translation" : "content"],
                route: `/documents?job=${encodeURIComponent(job.id)}&block=${encodeURIComponent(block.id)}`,
                updatedAt: job.updatedAt,
              });
            }
          } catch {
            // Missing or malformed artifacts retain the job-level entry only.
          }
        }
      }
      if (!cancelled) search.replaceSource("documents", records);
    };
    void publish();
    return () => {
      cancelled = true;
    };
  }, [hostServices?.search, jobs, services.artifacts]);

  useEffect(() => {
    if (routeJobId === null || appliedRouteRef.current === routeJobId) return;
    if (jobs.some((job) => job.id === routeJobId)) {
      appliedRouteRef.current = routeJobId;
      documents.selectJob(routeJobId);
    }
  }, [jobs, routeJobId]);

  useEffect(() => {
    if (routeHandoffId === null || appliedHandoffRef.current === routeHandoffId) return;
    appliedHandoffRef.current = routeHandoffId;
    const handoff = consumeDocumentHandoff(routeHandoffId, "document");
    if (handoff === undefined) {
      const marker = getDocumentHandoffMarker();
      markDocumentHandoffExpired(routeHandoffId, "document");
      documents.setNotice(
        marker?.id !== routeHandoffId || marker.target !== "document"
          ? "Document handoff 已过期；请从来源工作台重新交接"
          : `Document handoff「${marker.name}」已过期；请从来源工作台重新交接`,
      );
      void navigate({ to: "/documents" });
      return;
    }
    void importDocumentHandoff(services, handoff)
      .then(({ job, file }) => {
        const resolvedJobId = documents.addJob(job, file);
        void navigate({ to: "/documents", search: { job: resolvedJobId } });
      })
      .catch((reason: unknown) => {
        documents.setNotice(
          `接收 ${handoff.name} 失败：${reason instanceof Error ? reason.message : String(reason)}`,
        );
        void navigate({ to: "/documents" });
      });
  }, [navigate, routeHandoffId, services]);

  useEffect(() => {
    const refresh = () => setHandoffHistory(listDocumentHandoffs());
    window.addEventListener(DOCUMENT_HANDOFF_EVENT, refresh);
    return () => window.removeEventListener(DOCUMENT_HANDOFF_EVENT, refresh);
  }, []);

  return { routeBlockId, handoffHistory };
}
