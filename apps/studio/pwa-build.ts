import type { Plugin } from "vite-plus";
import { PWA_APPS } from "./src/pwa/apps";

/** Rolldown coalesces HTML entries with identical scripts. Keep each offline
 * document's bootstrap discoverable even when it only has a shared chunk. */
export function pwaBuildManifest(readerWorkerAssets: ReadonlySet<string>): Plugin {
  return {
    name: "bcr-pwa-entry-manifests",
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const output = bundle["build-manifest.json"];
        if (!output || output.type !== "asset") throw new Error("Missing build manifest");
        const manifest = JSON.parse(String(output.source)) as Record<string, { file: string }>;
        // Vite worker bundles have their own module graph and are absent from
        // the page manifest. Include every emitted dependency of Reader's workers.
        if (readerWorkerAssets.size === 0) throw new Error("Missing Reader offline workers");
        Object.assign(manifest, {
          "reader-offline-workers": {
            assets: [...readerWorkerAssets]
              .filter((name) => name in bundle)
              .sort((a, b) => a.localeCompare(b)),
          },
        });
        for (const app of PWA_APPS.filter((item) => item.key !== "knowledge")) {
          const path = `pwa/${app.key}/index.html`;
          if (manifest[path]) continue;
          const html = bundle[path];
          if (!html || html.type !== "asset") throw new Error(`Missing PWA document: ${path}`);
          const scripts = [
            ...String(html.source).matchAll(/<script\b[^>]*\bsrc="\/([^"\s]+)"/gu),
          ].map((match) => match[1]!);
          const imports = scripts.map((file) => {
            const entry = Object.entries(manifest).find(([, value]) => value.file === file);
            if (!entry) throw new Error(`Missing PWA bootstrap: ${file}`);
            return entry[0];
          });
          if (!imports.length) throw new Error(`Empty PWA bootstrap: ${path}`);
          Object.assign(manifest, {
            [path]: { file: scripts[0], src: path, isEntry: true, imports },
          });
        }
        output.source = JSON.stringify(manifest, null, 2);
      },
    },
  };
}
