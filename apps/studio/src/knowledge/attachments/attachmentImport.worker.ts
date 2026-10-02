import { hashReadableStream } from "@bcr/core";

const scope = self as unknown as {
  onmessage:
    | ((event: MessageEvent<{ file: File; image: boolean; digest: boolean }>) => void)
    | null;
  postMessage: (message: unknown) => void;
};
scope.onmessage = (event) => {
  void (async () => {
    const { file, image, digest } = event.data;
    const result: { hash?: string; width?: number; height?: number; thumbnail?: Blob } = {};
    if (digest) result.hash = await hashReadableStream(file.stream());
    if (image && typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(file);
        result.width = bitmap.width;
        result.height = bitmap.height;
        if (
          typeof OffscreenCanvas !== "undefined" &&
          (bitmap.width > 1600 || file.size > 2 * 1024 * 1024)
        ) {
          const scale = Math.min(1, 1440 / bitmap.width, 1440 / bitmap.height);
          const canvas = new OffscreenCanvas(
            Math.max(1, Math.round(bitmap.width * scale)),
            Math.max(1, Math.round(bitmap.height * scale)),
          );
          canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          result.thumbnail = await canvas.convertToBlob({ type: "image/webp", quality: 0.86 });
        }
        bitmap.close();
      } catch {
        /* Retain undecodable images as ordinary attachments. */
      }
    }
    scope.postMessage(result);
  })().catch((reason) =>
    scope.postMessage({ error: reason instanceof Error ? reason.message : String(reason) }),
  );
};
