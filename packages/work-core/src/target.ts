import type { Target } from "./index";

/** The review surface exposed by a target. Rendering adapters stay behind this boundary. */
export type TargetSurface = "page" | "timeline";

export type TargetCapabilities = {
  surface: TargetSurface;
  preview: true;
  validate: true;
  archive: true;
  capture: boolean;
  video: boolean;
  parameters: boolean;
  seek: boolean;
};

export function targetSurface(target: Target): TargetSurface {
  return target.runtime === "html" ? "page" : "timeline";
}

export function targetCapabilities(target: Target): TargetCapabilities {
  const timeline = targetSurface(target) === "timeline";
  const supportsParameters =
    target.runtime === "remotion" && !!target.propsFile && !!target.parameters?.length;
  return {
    surface: timeline ? "timeline" : "page",
    preview: true,
    validate: true,
    archive: true,
    capture: timeline,
    video: timeline,
    parameters: supportsParameters,
    seek: timeline,
  };
}
