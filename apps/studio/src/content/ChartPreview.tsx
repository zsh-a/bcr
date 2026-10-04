import { useEffect, useState } from "react";
import type { ModelResult } from "@bcr/economics-core";
import { viewportFor, type VisualSpec } from "@bcr/visual-renderer/model";

export function ChartPreview({ spec, result }: { spec: VisualSpec; result: ModelResult }) {
  const [image, setImage] = useState(""),
    [error, setError] = useState("");
  const identity = JSON.stringify([spec, result]);
  useEffect(() => {
    let active = true,
      url = "";
    setError("");
    setImage("");
    void import("@bcr/visual-renderer")
      .then(({ renderAt }) => {
        if (!active) return;
        url = URL.createObjectURL(
          new Blob([renderAt({ spec, result })], { type: "image/svg+xml" }),
        );
        setImage(url);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [identity]);
  const size = viewportFor(spec.layout);
  return error ? (
    <span role="alert">{error}</span>
  ) : image ? (
    <img
      className="content-chart-image"
      src={image}
      alt={spec.title}
      width={size.width}
      height={size.height}
      style={{ maxWidth: "100%", height: "auto" }}
    />
  ) : (
    <span role="status">正在生成图表…</span>
  );
}
