import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  AppToolbar,
  Button,
  Select,
  useLocationSearch,
  useNavigation,
  useOpenAssistant,
  useRuntime,
} from "@bcr/react";
import { Code2, FilePlus2, Sparkles } from "lucide-react";
import { workspaceServices } from "../workspace";
import { ReviewDesk } from "./ReviewDesk";
import { LocalWork } from "./LocalWork";
import { BrowserWork } from "./BrowserWork";
import { RunnerConnection } from "./RunnerConnection";
import { BROWSER_SOURCE, workKey, workRoute } from "./service";
import "./works.css";

const INITIAL =
  '<!doctype html>\n<html lang="zh-CN">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>我的作品</title>\n<style>body{max-width:720px;margin:64px auto;padding:24px;font-family:system-ui;line-height:1.7}</style>\n<h1>从一个想法开始</h1>\n<p>请 AI 助手将这里变成你的交互作品。</p>\n</html>\n';

/** Navigation and source selection only; editing and execution have separate sessions. */
export function WorksApp() {
  const runtime = useRuntime();
  const workspace = useMemo(() => workspaceServices(runtime), [runtime]);
  const service = workspace.workService,
    runner = service.local;
  const items = useSyncExternalStore(service.subscribe, service.getSnapshot);
  const connection = useSyncExternalStore(runner.subscribe, runner.getSnapshot);
  const works = useSyncExternalStore(service.browser.subscribe, service.browser.getSnapshot);
  const navigation = useNavigation(),
    search = useLocationSearch(),
    openAssistant = useOpenAssistant();
  const route = new URLSearchParams(search);
  const sourceId =
    route.get("source") ??
    (route.get("provider") === "local" ? connection.sourceId : BROWSER_SOURCE);
  const isLocal = sourceId !== BROWSER_SOURCE;
  const id = route.get("work");
  const localWork =
    isLocal && sourceId === connection.sourceId
      ? connection.items.find((w) => w.ref.id === id)
      : undefined;
  const work = !isLocal ? (id ? works.find((w) => w.id === id) : works[0]) : undefined;
  const [connecting, setConnecting] = useState(false),
    [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false);
  useEffect(() => {
    let disposed = false;
    void service.browser.ready.then(
      () => {
        if (!disposed) setReady(true);
      },
      (e) => {
        if (!disposed) setError(String(e));
      },
    );
    return () => {
      disposed = true;
    };
  }, [service]);
  // Bind old provider-based links once. Reconnecting a different Runner cannot retarget this URL.
  useEffect(() => {
    if (!route.get("source") && localWork) navigation.navigate(workRoute(localWork.ref));
  }, [search, localWork, navigation]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        await service.list();
      } catch (e) {
        if (!disposed) setError(String(e));
      }
      if (!disposed) timer = setTimeout(() => void refresh(), 5000);
    };
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [service]);
  const selected =
    localWork?.ref ??
    (work ? { sourceId: BROWSER_SOURCE, provider: "browser" as const, id: work.id } : undefined);
  return (
    <div className="works-app">
      <AppToolbar>
        <Code2 size={18} aria-hidden="true" />
        <strong>作品</strong>
        <Select
          aria-label="选择作品"
          value={selected ? workKey(selected) : ""}
          disabled={blocked || busy}
          onChange={(event) => {
            const next = items.find((w) => workKey(w.ref) === event.target.value);
            if (!next) return;
            service.preview.stop();
            runner.preview.stop();
            navigation.navigate(workRoute(next.ref));
          }}
        >
          {!selected && <option value="">选择作品</option>}
          <optgroup label="浏览器作品">
            {items
              .filter((w) => w.ref.provider === "browser")
              .map((w) => (
                <option key={workKey(w.ref)} value={workKey(w.ref)}>
                  {w.title}
                </option>
              ))}
          </optgroup>
          {connection.status === "connected" && (
            <optgroup label="本地工程">
              {items
                .filter((w) => w.ref.provider === "local")
                .map((w) => (
                  <option key={workKey(w.ref)} value={workKey(w.ref)}>
                    {w.title}
                  </option>
                ))}
            </optgroup>
          )}
        </Select>
        <Button
          variant="ghost"
          disabled={!ready || blocked || busy}
          onClick={() => {
            setBusy(true);
            setError("");
            void service
              .commit({
                requestId: crypto.randomUUID(),
                revision: null,
                title: "新作品",
                entry: "index.html",
                put: [{ path: "index.html", text: INITIAL }],
              })
              .then(
                (next) => {
                  service.preview.stop();
                  runner.preview.stop();
                  navigation.navigate(
                    `${workRoute({ sourceId: BROWSER_SOURCE, provider: "browser", id: next.id })}&mode=build`,
                  );
                },
                (e) => setError(String(e)),
              )
              .finally(() => setBusy(false));
          }}
        >
          <FilePlus2 size={16} />
          新建页面
        </Button>
        <Button
          variant="ghost"
          disabled={blocked || busy}
          onClick={() => setConnecting(!connecting)}
        >
          {connection.status === "connected" ? "本地已连接" : "连接本地工程"}
        </Button>
        <span className="works-spacer" />
        <Button variant="ghost" onClick={() => openAssistant?.()}>
          <Sparkles size={16} />
          AI 助手
        </Button>
      </AppToolbar>
      {connecting && <RunnerConnection runner={runner} close={() => setConnecting(false)} />}
      {connection.errors.map((e) => (
        <p className="works-error" role="alert" key={e.directory}>
          {e.directory}: {e.message}
        </p>
      ))}
      {error && (
        <p className="works-error" role="alert">
          {error}
        </p>
      )}
      {selected && route.get("mode") !== "build" ? (
        <ReviewDesk
          key={workKey(selected)}
          service={service}
          work={items.find((item) => workKey(item.ref) === workKey(selected))!}
          initialSubmit={route.get("intent") === "submit"}
          onBlocked={setBlocked}
          onBuild={() => navigation.navigate(`${workRoute(selected)}&mode=build`)}
        />
      ) : selected ? (
        <>
          {localWork ? (
            <LocalWork
              key={workKey(localWork.ref)}
              service={service}
              work={localWork}
              onBlocked={setBlocked}
              onReview={() => navigation.navigate(workRoute(selected))}
              onSubmit={() => navigation.navigate(`${workRoute(selected)}&intent=submit`)}
            />
          ) : work ? (
            <BrowserWork
              key={work.id}
              service={service}
              work={work}
              onBlocked={setBlocked}
              onReview={() => navigation.navigate(workRoute(selected))}
              onSubmit={() => navigation.navigate(`${workRoute(selected)}&intent=submit`)}
            />
          ) : null}
        </>
      ) : (
        <section className="works-empty">
          <span className="works-kicker">WORKSPACE</span>
          <h1>
            {isLocal ? "连接作品所属的 Runner" : id ? "未找到此作品" : "从页面或本地工程开始"}
          </h1>
          <p>
            {isLocal
              ? "作品链接已绑定来源。连接原来的 Runner，或从列表选择当前来源中的作品。"
              : "创建交互页面，或连接由 Agent 编写的本地工程，继续预览、批注与导出。"}
          </p>
          {isLocal && <Button onClick={() => setConnecting(true)}>连接本地工程</Button>}
        </section>
      )}
    </div>
  );
}
