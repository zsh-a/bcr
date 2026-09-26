import type { LocationRewrite } from "@tanstack/react-router";
import { pwaAtPath, type PwaApp } from "./apps";

export const currentPwa =
  typeof location === "undefined" ? undefined : pwaAtPath(location.pathname);
/** Keep domain routes canonical inside the router while exposing disjoint installation URLs. */
export function pwaRewrite(app: PwaApp): LocationRewrite {
  return {
    input: ({ url }) => {
      if (url.pathname === app.scope.slice(0, -1) || url.pathname === app.scope)
        url.pathname = app.path;
      else if (app.key === "workspace" && url.pathname.startsWith(app.scope))
        url.pathname = `/${url.pathname.slice(app.scope.length)}`;
      return url;
    },
    output: ({ url }) => {
      if (app.key === "workspace") url.pathname = `${app.scope}${url.pathname.replace(/^\//u, "")}`;
      else if (url.pathname === app.path || url.pathname === `${app.path}/`)
        url.pathname = app.startUrl;
      return url;
    },
  };
}
