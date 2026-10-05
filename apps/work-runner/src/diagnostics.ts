import { renderSettings, type Project, type RenderRequest, type Target } from "@bcr/work-core";

/** Inspect the immutable inventory, not a second scan of the mutable project directory. */
export function diagnose(project: Project, target: Target, request: RenderRequest) {
  const required = target.runtime === "remotion" ? (target.assets ?? []) : [];
  const assets = project.files.filter(
    (file) => file.path.startsWith("public/") || required.includes(file.path),
  );
  const errors: string[] = [];
  for (const path of new Set(required)) {
    const file = project.files.find((item) => item.path === path);
    if (!file) errors.push(`缺少声明的素材：${path}`);
    else if (!file.size) errors.push(`素材为空：${path}`);
  }
  const fonts = assets.filter((file) => /\.(woff2?|otf|ttf)$/iu.test(file.path));
  const warnings: string[] = [];
  if (target.runtime === "remotion" && !fonts.length)
    warnings.push("未发现本地字体；系统字体或外部字体可能导致预览与导出不一致。");
  return {
    sourceRevision: project.revision,
    target: target.id,
    settings: target.runtime === "remotion" ? renderSettings(request) : null,
    assets,
    fonts: fonts.map((file) => file.path),
    errors,
    warnings,
  };
}
