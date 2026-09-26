import type { Plugin } from "vite-plus";
import { PWA_APPS } from "./src/pwa/apps";

/** Rolldown coalesces HTML entries with identical scripts. Keep each offline
 * document's bootstrap discoverable even when it only has a shared chunk. */
export function pwaBuildManifest(): Plugin {
  return {
    name: "bcr-pwa-entry-manifests",
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const output = bundle["build-manifest.json"];
        if (!output || output.type !== "asset") throw new Error("Missing build manifest");
        const manifest = JSON.parse(String(output.source)) as Record<string, { file: string }>;
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
