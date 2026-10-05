import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

// Full Chinese glyph coverage travels with the work; no CDN or system font dependency.
export const fontsReady = Promise.all([
  loadFont({
    family: "Work Sans",
    url: staticFile("fonts/SourceHanSansCN-Regular.woff2"),
    weight: "400",
  }),
  loadFont({
    family: "Work Mono",
    url: staticFile("fonts/IBMPlexMono-Regular.woff2"),
    weight: "400",
  }),
]);
export const theme = {
  paper: "#f1eee5",
  ink: "#193d32",
  muted: "#6d796d",
  line: "#cdd1c4",
  accent: "#e07544",
  lime: "#d7eb9b",
  sans: '"Work Sans"',
  mono: '"Work Mono", "Work Sans"',
};
