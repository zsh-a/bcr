import { useState, useSyncExternalStore } from "react";
import { Button } from "@bcr/react";
import type { RunnerClient } from "./runner";

export function RunnerConnection({ runner, close }: { runner: RunnerClient; close: () => void }) {
  const connection = useSyncExternalStore(runner.subscribe, runner.getSnapshot);
  const [url, setUrl] = useState("http://127.0.0.1:5210"),
    [token, setToken] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="works-connect" aria-label="连接 Runner">
      <div>
        <strong>连接 Runner</strong>
        <p>在作品工程所在的环境启动 Runner，用配对密钥连接。密钥只保留在当前会话。</p>
        <code>bcr-runner start --root ./projects --origin {location.origin}</code>
      </div>
      {connection.status === "connected" ? (
        <>
          <p>
            {connection.root}
            {connection.version ? ` · Runner ${connection.version}` : ""}
          </p>
          <Button variant="ghost" onClick={() => runner.disconnect()}>
            断开连接
          </Button>
        </>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await runner.connect(url, token);
              setToken("");
              close();
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Runner 地址
            <input
              aria-label="Runner 地址"
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <label>
            配对密钥
            <input
              aria-label="配对密钥"
              type="password"
              autoComplete="off"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? "连接中…" : "连接"}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="works-error">
          {error}
        </p>
      )}
      <Button variant="ghost" onClick={close}>
        收起
      </Button>
    </section>
  );
}
