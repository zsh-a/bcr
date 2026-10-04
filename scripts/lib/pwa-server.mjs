import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

export async function startPwaServer() {
  const root = resolve("apps/studio/dist");
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".wasm": "application/wasm",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
  };
  let postedFiles = 0;
  const server = createServer(async (request, response) => {
    if (request.method === "POST") {
      postedFiles++;
      response.writeHead(405).end();
      return;
    }
    try {
      const url = new URL(request.url, "http://localhost");
      let file = resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (file !== root && !file.startsWith(root + sep)) {
        response.writeHead(403).end();
        return;
      }
      try {
        if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
      } catch {
        if (!extname(file)) file = resolve(root, "index.html");
      }
      const body = await readFile(file);
      response.writeHead(200, {
        "Content-Type": types[extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "credentialless",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    postedFiles: () => postedFiles,
    close: () => new Promise((done) => server.close(done)),
  };
}
