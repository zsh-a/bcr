export const RENDERER_VERSION = "visual-1";
export const FONT_FAMILY = "IBM Plex Sans SC";
export interface VisualSpec {
  version: 1;
  template: "comparison" | "break-even";
  layout: "landscape" | "portrait";
  theme: "paper" | "night";
  title: string;
  source: string;
}
export const viewportFor = (layout: VisualSpec["layout"]) =>
  layout === "portrait" ? { width: 1080, height: 1440 } : { width: 1440, height: 900 };
