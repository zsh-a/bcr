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
import { Code2, Link2, Sparkles } from "lucide-react";
import type { Project } from "@bcr/work-core";
import { workspaceServices } from "../workspace";
import { ReviewDesk } from "./ReviewDesk";
import { WorkBuild } from "./WorkBuild";
import { RunnerConnection } from "./RunnerConnection";
import { workKey, workRoute } from "./service";
import "./works.css";

/** Works is a thin Runner client. Creation happens in the connected source project. */
export function WorksApp() {
  const runtime = useRuntime();
  const service = useMemo(() => workspaceServices(runtime).workService, [runtime]);
  const runner = service.runner;
  const items = useSyncExternalStore(service.subscribe, service.getSnapshot);
  const connection = useSyncExternalStore(runner.subscribe, runner.getSnapshot);
  const navigation = useNavigation();
  const search = useLocationSearch();
  const openAssistant = useOpenAssistant();
  const route = new URLSearchParams(search);
  const sourceId = route.get("source") ?? connection.sourceId;
  const id = route.get("work");
  const selected = items.find(
    (item) => item.ref.sourceId === sourceId && (!id || item.ref.id === id),
  );
  const project = connection.items.find(
    (item) => selected && workKey(item.ref) === workKey(selected.ref),
  ) as Project | undefined;
  const [connecting, setConnecting] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        await service.list();
      } catch (reason) {
        if (!disposed) setError(String(reason));
      }
    };
    void refresh();
    return () => {
      disposed = true;
    };
  }, [service, connection.status]);

  useEffect(() => {
    if (!selected && items.length && connection.sourceId) {
      const first = items[0]!;
      navigation.navigate(workRoute(first.ref));
    }
  }, [connection.sourceId, items, navigation, selected]);

  return (
    <div className="works-app">
      <AppToolbar>
        <Code2 size={18} aria-hidden="true" />
        <strong>作品</strong>
        <Select
          aria-label="选择作品"
          value={selected ? workKey(selected.ref) : ""}
          disabled={blocked || connection.status !== "connected"}
          onChange={(event) => {
            const next = items.find((item) => workKey(item.ref) === event.target.value);
            if (!next) return;
            runner.preview.stop();
            navigation.navigate(workRoute(next.ref));
          }}
        >
          {!selected && <option value="">选择作品</option>}
          {items.map((item) => (
            <option key={workKey(item.ref)} value={workKey(item.ref)}>
              {item.title}
            </option>
          ))}
        </Select>
        <Button variant="ghost" disabled={blocked} onClick={() => setConnecting((value) => !value)}>
          <Link2 size={15} />
          {connection.status === "connected" ? "Runner 已连接" : "连接 Runner"}
        </Button>
        <span className="works-spacer" />
        <Button variant="ghost" onClick={() => openAssistant?.()}>
          <Sparkles size={16} />
          AI 助手
        </Button>
      </AppToolbar>
      {connecting && <RunnerConnection runner={runner} close={() => setConnecting(false)} />}
      {connection.errors.map((item) => (
        <p className="works-error" role="alert" key={item.directory}>
          {item.directory}: {item.message}
        </p>
      ))}
      {error && (
        <p className="works-error" role="alert">
          {error}
        </p>
      )}
      {selected && route.get("mode") !== "build" ? (
        <ReviewDesk
          key={workKey(selected.ref)}
          service={service}
          work={selected}
          initialSubmit={route.get("intent") === "submit"}
          onBlocked={setBlocked}
          onBuild={() => navigation.navigate(`${workRoute(selected.ref)}&mode=build`)}
        />
      ) : selected && project ? (
        <WorkBuild
          key={workKey(selected.ref)}
          service={service}
          work={project}
          onBlocked={setBlocked}
          onReview={() => navigation.navigate(workRoute(selected.ref))}
          onSubmit={() => navigation.navigate(`${workRoute(selected.ref)}&intent=submit`)}
        />
      ) : (
        <section className="works-empty">
          <span className="works-kicker">RUNNER WORKSPACE</span>
          <h1>{connection.status === "connected" ? "选择一个 Work" : "连接 Runner 开始创作"}</h1>
          <p>
            {connection.status === "connected"
              ? "源码、数据和素材由 Work 工程管理，Works 负责预览、审阅和交付。"
              : "Codex 或其他 Agent 在工程目录中创作，Runner 提供可复现的构建和渲染。"}
          </p>
          {connection.status !== "connected" && (
            <Button onClick={() => setConnecting(true)}>连接 Runner</Button>
          )}
        </section>
      )}
    </div>
  );
}
