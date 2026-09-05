import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { SearchDocument } from "@bcr/core";
import {
  consumeDocumentHandoff,
  getDocumentHandoffMarker,
  markDocumentHandoffExpired,
  publishDocumentHandoff,
} from "@bcr/document-core";
import { useLocationSearch, useOptionalRuntime } from "@bcr/react";
import {
  importReaderDocumentHandoff,
  importReaderExportBundle,
  importReaderFile,
  indexBook,
  prepareReaderDocumentHandoff,
} from "./runtime";
import {
  BootScreen,
  ReaderHeader,
  ReaderInstallHelp,
  ReaderRecoveryBanner,
  ReaderUpdateNotice,
  type ImportFailure,
  type ImportJob,
} from "./ReaderChrome";
import { ReaderWorkspace } from "./ReaderWorkspace";
import { activeBook } from "./model";
import { formatBadge } from "./readerPresentation";
import { getReaderState, reader, useReader } from "./store";
import { useReaderPwaInstall } from "./useReaderPlatform";
import {
  isAbortError,
  persistReaderSnapshot,
  useDebouncedPersist,
  useReaderBoot,
  useReaderPwaUpdate,
  useReaderSearch,
} from "./useReaderRuntime";
import "./styles.css";
import "./reading-layout.css";

interface ReaderRouteSearch {
  readonly book?: string;
  readonly section?: string;
}

function parseReaderRouteSearch(value: string): ReaderRouteSearch {
  const params = new URLSearchParams(value);
  const book = params.get("book");
  const section = params.get("section");
  return {
    ...(book === null ? {} : { book }),
    ...(section === null ? {} : { section }),
  };
}

export function App() {
  const { runtime, error: runtimeError, recovery } = useReaderBoot();
  const hostServices = useOptionalRuntime();
  const pwaInstall = useReaderPwaInstall();
  const pwaUpdate = useReaderPwaUpdate(runtime);
  const routeSearch = parseReaderRouteSearch(useLocationSearch());
  const status = useReader((state) => state.status);
  const stateError = useReader((state) => state.error);
  const active = useReader((state) => activeBook(state));
  const settings = useReader((state) => state.settings);
  const library = useReader((state) => state.library);
  const searchOpen = useReader((state) => state.searchOpen);
  const sidebarOpen = useReader((state) => state.sidebarOpen);
  const searchRef = useRef<HTMLInputElement>(null);
  const importAbortRef = useRef<AbortController | null>(null);
  const importDismissRef = useRef<number | null>(null);
  const handoffRef = useRef<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [handoffRecovery, setHandoffRecovery] = useState(false);
  const [documentHandoffBusy, setDocumentHandoffBusy] = useState(false);
  const [importJob, setImportJob] = useState<ImportJob | null>(null);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [mobileChromeVisible, setMobileChromeVisible] = useState(true);
  const appliedRouteRef = useRef("");
  const mobileSidebarInitializedRef = useRef(false);

  useEffect(() => {
    document.title = active === undefined ? "BCR Reader" : `${active.title} · BCR Reader`;
  }, [active?.id, active?.title]);

  useEffect(() => {
    if (status !== "ready" || mobileSidebarInitializedRef.current) return;
    mobileSidebarInitializedRef.current = true;
    if (window.matchMedia("(max-width: 860px)").matches && getReaderState().sidebarOpen) {
      reader.toggleSidebar();
    }
  }, [status]);

  useEffect(() => {
    if (status !== "ready" || routeSearch.book === undefined) return;
    const routeKey = `${routeSearch.book}|${routeSearch.section ?? ""}`;
    if (appliedRouteRef.current === routeKey) return;
    const book = library.find((candidate) => candidate.id === routeSearch.book);
    if (book === undefined) return;
    appliedRouteRef.current = routeKey;
    reader.openBook(book.id, routeSearch.section);
  }, [status, routeSearch.book, routeSearch.section, library]);

  useEffect(() => {
    const search = hostServices?.search;
    if (search === undefined || runtime === null || status !== "ready") return;
    const records: SearchDocument[] = [];
    for (const book of library) {
      const bookBody = [book.author ?? "", book.language ?? "", ...book.tags]
        .filter(Boolean)
        .join(" ");
      records.push({
        id: `reader:book:${book.id}`,
        source: "reader",
        kind: "reader-book",
        title: book.title,
        subtitle: `${formatBadge(book.source.format)}${book.author === undefined ? "" : ` · ${book.author}`}`,
        ...(bookBody.length === 0 ? {} : { body: bookBody }),
        tags: ["reader", book.source.format, ...book.tags],
        route: `/reader?book=${encodeURIComponent(book.id)}`,
        updatedAt: book.updatedAt,
      });
      for (const section of book.sections) {
        records.push({
          id: `reader:section:${book.id}:${section.id}`,
          source: "reader",
          kind: "reader-section",
          title: section.label,
          subtitle: book.title,
          body: section.text.slice(0, 12_000),
          tags: ["reader", book.source.format, "section"],
          route: `/reader?book=${encodeURIComponent(book.id)}&section=${encodeURIComponent(section.id)}`,
          updatedAt: book.updatedAt,
        });
      }
    }
    search.replaceSource("reader", records);
  }, [hostServices?.search, runtime, status, library]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        reader.setSearchOpen(true);
        window.setTimeout(() => searchRef.current?.focus(), 0);
      }
      if (event.key === "Escape") {
        if (document.fullscreenElement !== null) return;
        if (searchOpen) reader.setSearchOpen(false);
        else if (sidebarOpen) reader.toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen, sidebarOpen]);

  const cancelImport = useCallback(() => {
    importAbortRef.current?.abort();
  }, []);

  const installReader = useCallback(async () => {
    const prompted = await pwaInstall.install();
    if (!prompted) setInstallHelpOpen(true);
  }, [pwaInstall.install]);

  useEffect(
    () => () => {
      importAbortRef.current?.abort();
      if (importDismissRef.current !== null) window.clearTimeout(importDismissRef.current);
    },
    [],
  );

  const importFiles = useCallback(
    async (files: ReadonlyArray<File>) => {
      if (runtime === null || files.length === 0 || importAbortRef.current !== null) return;
      if (importDismissRef.current !== null) {
        window.clearTimeout(importDismissRef.current);
        importDismissRef.current = null;
      }
      const controller = new AbortController();
      importAbortRef.current = controller;
      setImportJob({
        total: files.length,
        completed: 0,
        current: "",
        cancelled: false,
        settled: false,
        errors: 0,
        failedFiles: [],
      });
      let errors = 0;
      let completed = 0;
      const failedFiles: ImportFailure[] = [];
      for (const file of files) {
        if (controller.signal.aborted) break;
        setImportJob((previous) =>
          previous === null ? previous : { ...previous, current: file.name },
        );
        try {
          const isExportBundle =
            /\.json$/iu.test(file.name) ||
            file.type.toLocaleLowerCase().startsWith("application/json");
          const book = isExportBundle
            ? await importReaderExportBundle(runtime, file, controller.signal)
            : await importReaderFile(runtime, file, controller.signal);
          if (controller.signal.aborted) break;
          const added = reader.addBook(book);
          await persistReaderSnapshot(runtime, { durableLibrary: true });
          if (added) {
            await indexBook(runtime, book, controller.signal);
            setNotice(
              isExportBundle
                ? `${book.title} 已从 Export Bundle 加入书库`
                : `${book.title} 已加入书库`,
            );
          } else {
            setNotice(`${file.name} 已在书库`);
          }
        } catch (reason) {
          if (isAbortError(reason)) break;
          errors += 1;
          const message = reason instanceof Error ? reason.message : String(reason);
          failedFiles.push({ file, error: message });
          setNotice(message);
        } finally {
          if (!controller.signal.aborted) completed += 1;
          setImportJob((previous) =>
            previous === null
              ? previous
              : {
                  ...previous,
                  completed: controller.signal.aborted ? previous.completed : completed,
                  current: "",
                  errors,
                  failedFiles: [...failedFiles],
                },
          );
        }
      }
      const cancelled = controller.signal.aborted;
      if (cancelled) {
        for (const file of files.slice(completed)) {
          if (!failedFiles.some((failure) => failure.file === file)) {
            failedFiles.push({ file, error: "导入已取消" });
          }
        }
      }
      setImportJob((previous) =>
        previous === null
          ? previous
          : {
              ...previous,
              completed,
              current: "",
              cancelled,
              settled: true,
              errors,
              failedFiles: [...failedFiles],
            },
      );
      importAbortRef.current = null;
      setNotice(
        cancelled ? "导入已取消" : errors > 0 ? `导入完成，${errors} 个文件失败` : "导入完成",
      );
      importDismissRef.current = window.setTimeout(
        () => {
          setNotice(null);
          setImportJob(null);
          importDismissRef.current = null;
        },
        cancelled && failedFiles.length > 0
          ? 12_000
          : cancelled
            ? 1800
            : errors > 0
              ? 12_000
              : 2400,
      );
    },
    [runtime],
  );

  const retryFailedImports = useCallback(() => {
    const files = importJob?.failedFiles.map((failure) => failure.file) ?? [];
    if (files.length === 0 || importAbortRef.current !== null) return;
    setImportJob(null);
    setNotice(`正在重试 ${files.length} 个失败文件`);
    void importFiles(files);
  }, [importFiles, importJob]);

  const handoffDocument = useCallback(() => {
    if (active === undefined || runtime === null || documentHandoffBusy) return;
    const hostArtifacts = hostServices?.artifacts;
    if (hostArtifacts === undefined) {
      setNotice("请从 Studio Shell 打开 Reader，才能把内容交给 Document Studio");
      return;
    }
    setDocumentHandoffBusy(true);
    void prepareReaderDocumentHandoff(runtime, hostArtifacts, active)
      .then(({ file, sourceRef, content, contentRef }) => {
        const handoffId = publishDocumentHandoff({
          jobId: active.id,
          target: "document",
          name: active.source.name,
          format: content.format,
          file,
          size: active.source.size,
          sourceRef,
          contentRef,
          content,
        });
        setNotice(`${active.title} 正在交给 Document Studio；结构化内容与源文件已托管`);
        window.location.assign(`/documents?handoff=${encodeURIComponent(handoffId)}`);
      })
      .catch((reason: unknown) => {
        setNotice(
          `交给 Document Studio 失败：${reason instanceof Error ? reason.message : String(reason)}`,
        );
      })
      .finally(() => setDocumentHandoffBusy(false));
  }, [active, documentHandoffBusy, hostServices?.artifacts, runtime]);

  useEffect(() => {
    if (runtime === null || status !== "ready") return;
    const handoffId = new URLSearchParams(window.location.search).get("document");
    if (handoffId === null || handoffId === handoffRef.current) return;
    handoffRef.current = handoffId;
    const handoff = consumeDocumentHandoff(handoffId, "reader");
    window.history.replaceState({}, "", "/reader");
    if (handoff === undefined) {
      const marker = getDocumentHandoffMarker();
      markDocumentHandoffExpired(handoffId, "reader");
      setHandoffRecovery(true);
      setNotice(
        marker?.id !== handoffId || marker.target !== "reader"
          ? "Document handoff 已过期；请从 Document Studio 重新导入源文件"
          : `Document handoff「${marker.name}」已过期；请从 Document Studio 重新导入源文件`,
      );
      return;
    }
    setHandoffRecovery(false);
    void (async () => {
      try {
        const book = await importReaderDocumentHandoff(runtime, handoff, hostServices?.artifacts);
        const added = reader.addBook(book);
        await persistReaderSnapshot(runtime, { durableLibrary: true });
        if (added) {
          await indexBook(runtime, book);
          setNotice(
            handoff.translation !== undefined || handoff.translationRef !== undefined
              ? `${book.title} 已从 Translation Package 加入书库`
              : handoff.content !== undefined || handoff.contentRef !== undefined
                ? `${book.title} 已从 Content Package 加入书库`
                : `${book.title} 已从源 Artifact 加入书库`,
          );
        } else {
          setNotice(`${handoff.name} 已在书库`);
        }
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setHandoffRecovery(true);
        setNotice(message);
      }
    })();
  }, [hostServices?.artifacts, runtime, status]);

  if (status === "booting" || runtime === null) {
    return <BootScreen error={runtimeError} />;
  }
  if (active === undefined) {
    return <BootScreen error={stateError ?? runtimeError ?? "没有可阅读的内容"} />;
  }
  return (
    <div
      className={`reader-studio reader-theme-${settings.theme} ${mobileChromeVisible ? "mobile-chrome-visible" : "mobile-chrome-hidden"}`}
    >
      <ReaderEffects runtime={runtime} />
      <a className="reader-skip-link" href="#reader-content">
        跳到正文
      </a>
      <ReaderHeader
        book={active}
        searchRef={searchRef}
        onExit={() => window.location.assign("/")}
        onImport={(files) => void importFiles(files)}
        notice={notice}
        importJob={importJob}
        onCancelImport={cancelImport}
        onRetryFailed={retryFailedImports}
        onRecoverHandoff={handoffRecovery ? () => window.location.assign("/documents") : undefined}
        showInstall={!pwaInstall.isInstalled}
        installAvailable={pwaInstall.canInstall}
        onInstall={() => void installReader()}
      />
      <ReaderInstallHelp
        open={installHelpOpen}
        isIos={pwaInstall.isIos}
        onClose={() => setInstallHelpOpen(false)}
      />
      {recovery !== null && recovery.skippedBooks.length > 0 && (
        <ReaderRecoveryBanner recovery={recovery} />
      )}
      {pwaUpdate.visible && (
        <ReaderUpdateNotice
          applying={pwaUpdate.applying}
          blocked={documentHandoffBusy || (importJob !== null && !importJob.settled)}
          onApply={() => void pwaUpdate.apply()}
          onDismiss={pwaUpdate.dismiss}
        />
      )}
      <ReaderWorkspace
        onInstall={() => void installReader()}
        showInstall={!pwaInstall.isInstalled}
        runtime={runtime}
        onImport={(files) => void importFiles(files)}
        onOpenDocument={handoffDocument}
        documentHandoffBusy={documentHandoffBusy}
        onNotice={setNotice}
        onToggleMobileChrome={() => setMobileChromeVisible((visible) => !visible)}
      />
    </div>
  );
}

const ReaderEffects = memo(function ReaderEffects(props: {
  runtime: Parameters<typeof useDebouncedPersist>[0];
}) {
  useDebouncedPersist(props.runtime);
  useReaderSearch(props.runtime);
  return null;
});
