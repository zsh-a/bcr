import { RUNNER_PROTOCOL, type RunnerCatalog } from "@bcr/work-core";

export type Connection = { url: string; token: string };
export class RunnerClient {
  constructor(readonly connection: Connection) {
    const parsed = new URL(connection.url);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.origin !== connection.url ||
      parsed.username ||
      parsed.password
    )
      throw new Error("Runner URL 必须为 HTTP(S) origin");
  }
  async request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.connection.token}`);
    headers.set("Content-Type", "application/json");
    const response = await fetch(`${this.connection.url}${path}`, {
      ...init,
      redirect: "error",
      headers,
      signal: init.signal ?? AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw new Error(`Runner HTTP ${response.status}: ${(await response.text()).slice(0, 4000)}`);
    return response;
  }
  async call<T = unknown>(op: string, input: unknown = {}): Promise<T> {
    return (
      await this.request("/rpc", {
        method: "POST",
        body: JSON.stringify({ op, input }),
        signal: AbortSignal.timeout(op === "page_capture" ? 45000 : 20000),
      })
    ).json() as Promise<T>;
  }
  async catalog() {
    const catalog = await this.call<RunnerCatalog>("catalog");
    if (catalog.format !== RUNNER_PROTOCOL) throw new Error("Runner 协议不兼容");
    return catalog;
  }
  pageImage(id: string) {
    return this.request(`/captures/${encodeURIComponent(id)}`);
  }
  output(id: string, name: string) {
    return this.request(`/outputs/${encodeURIComponent(id)}/${encodeURIComponent(name)}`);
  }
}
