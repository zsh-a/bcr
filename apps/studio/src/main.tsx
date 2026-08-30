import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "dockview-react/dist/styles/dockview.css";
import "./styles.css";

import { RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { router } from "./router";

// 不用 StrictMode：OffscreenCanvas 的 transferControlToOffscreen
// 每块 canvas 只能执行一次，double-effect 会破坏 render.worker 挂载。
const container = document.getElementById("root");
if (container === null) throw new Error("missing #root");

createRoot(container).render(<RouterProvider router={router} />);
