import type { SearchDocument } from "@bcr/core";
import {
  DOCUMENT_HANDOFF_EVENT,
  consumeDocumentHandoff,
  formatLabel,
  getDocumentHandoffMarker,
  listDocumentHandoffs,
  markDocumentHandoffExpired,
  type DocumentContentPackage,
  type DocumentHandoffRecord,
  type DocumentJob,
  type DocumentTranslationPackage,
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
  active: DocumentJob,
  contentPackage: DocumentContentPackage | undefined,
  translationPackage: DocumentTranslationPackage | undefined,
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
    const records: SearchDocument[] = jobs.map((job) => {
      const done = job.stages.filter((stage) => stage.status === "done").length;
      const body = [
        job.sourceTextPreview ?? "",
        ...job.stages.map((stage) => `${stage.label} ${stage.status} ${stage.detail}`),
      ]
        .filter(Boolean)
        .join(" ")
        .slice(0, 24_000);
      return {
        id: `document:${job.id}`,
        source: "documents",
        kind: "document",
        title: job.name,
        subtitle: `${formatLabel(job.format)} · ${done}/${job.stages.length} stages ready`,
        ...(body.length === 0 ? {} : { body }),
        tags: ["document", job.format],
        route: `/documents?job=${encodeURIComponent(job.id)}`,
        updatedAt: job.updatedAt,
      };
    });
    if (contentPackage !== undefined) {
      for (const block of contentPackage.blocks) {
        records.push({
          id: `document:block:${active.id}:${block.id}`,
          source: "documents",
          kind: "document",
          title: block.label,
          subtitle: `${active.name} · ${formatLabel(active.format)} · 原文`,
          body: block.text,
          tags: ["document", active.format, "content", block.kind],
          route: `/documents?job=${encodeURIComponent(active.id)}&block=${encodeURIComponent(block.id)}`,
          updatedAt: active.updatedAt,
        });
      }
    }
    if (translationPackage !== undefined) {
      for (const block of translationPackage.blocks) {
        const body = [block.text, block.translatedText].filter(Boolean).join(" ");
        records.push({
          id: `document:translation:${active.id}:${block.id}`,
          source: "documents",
          kind: "document",
          title: `${block.label} · 译文`,
          subtitle: `${active.name} · ${translationPackage.targetLanguage}`,
          ...(body.length === 0 ? {} : { body }),
          tags: ["document", active.format, "translation", block.status],
          route: `/documents?job=${encodeURIComponent(active.id)}&block=${encodeURIComponent(block.id)}`,
          updatedAt: active.updatedAt,
        });
      }
    }
    search.replaceSource("documents", records);
  }, [active, contentPackage, hostServices?.search, jobs, translationPackage]);

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
