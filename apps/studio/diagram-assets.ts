import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, relative, sep } from "node:path";
import type { Plugin } from "vite-plus";

/** Serve and emit the SDK's font assets without checking generated binaries into the repo. */
export function diagramAssets(): Plugin {
  const root = fileURLToPath(
    new URL("./node_modules/@excalidraw/excalidraw/dist/prod/fonts/", import.meta.url),
  );
  return {
    name: "bcr-diagram-assets",
    async config() {
      const fonts = (await readdir(root, { recursive: true }))
        .filter((name) => /^(Liberation|Excalifont)[/\\].*\.woff2$/.test(name))
        .map((name) => `/diagram-assets/fonts/${name.split(sep).join("/")}`)
        .sort();
      return { define: { "globalThis.__BCR_DIAGRAM_FONT_ASSETS__": JSON.stringify(fonts) } };
    },
    configureServer(server) {
      server.middlewares.use("/diagram-assets/fonts", (request, response, next) => {
        let filename: string;
        try {
          filename = resolve(root, `.${decodeURIComponent((request.url ?? "").split("?")[0]!)}`);
        } catch {
          response.statusCode = 400;
          response.end();
          return;
        }
        if (relative(root, filename).startsWith(`..${sep}`) || !filename.endsWith(".woff2")) {
          next();
          return;
        }
        void readFile(filename).then(
          (data) => {
            response.setHeader("Content-Type", "font/woff2");
            response.end(data);
          },
          () => {
            response.statusCode = 404;
            response.end();
          },
        );
      });
    },
    async generateBundle() {
      const files = await readdir(root, { recursive: true });
      for (const filename of files.filter((filename) => filename.endsWith(".woff2")))
        this.emitFile({
          type: "asset",
          fileName: `diagram-assets/fonts/${filename.split(sep).join("/")}`,
          source: await readFile(resolve(root, filename)),
        });
    },
  };
}
