export const BACKGROUND_KEY = "bcr/background";
export const BACKGROUND_LIMIT = 1_500_000;
export interface Background {
  image: string;
  name: string;
  shade: number;
}
export function decodeBackground(raw: string | null): Background | null {
  if (raw === null) return null;
  if (raw.length > BACKGROUND_LIMIT + 1000) throw new Error("背景设置超过容量限制");
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== "object" ||
    !("image" in value) ||
    !("name" in value) ||
    !("shade" in value) ||
    typeof value.image !== "string" ||
    value.image.length > BACKGROUND_LIMIT ||
    !/^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/u.test(value.image) ||
    typeof value.name !== "string" ||
    value.name.length > 200 ||
    typeof value.shade !== "number" ||
    !Number.isFinite(value.shade) ||
    value.shade < 40 ||
    value.shade > 90
  )
    throw new Error("背景设置无效，请重新选择图片或恢复默认");
  return { image: value.image, name: value.name, shade: value.shade };
}

export function createBackgroundStore(options: {
  read: () => string | null;
  write: (value: string | null) => void;
  apply: (value: Background | null) => void;
}) {
  let snapshot: { value: Background | null; error: string } = { value: null, error: "" };
  const listeners = new Set<() => void>();
  function publish(value: Background | null, error = "") {
    snapshot = { value, error };
    options.apply(value);
    for (const listener of listeners) listener();
  }
  function reload() {
    try {
      publish(decodeBackground(options.read()));
    } catch {
      publish(snapshot.value, "无法恢复背景，请重新选择图片或恢复默认。");
    }
  }
  reload();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reload,
    save: (value: Background | null) => {
      try {
        const raw = value ? JSON.stringify(value) : null;
        const validated = decodeBackground(raw);
        options.write(raw);
        publish(validated);
        return true;
      } catch {
        publish(snapshot.value, "背景未保存，原设置已保留。请检查浏览器存储空间与权限。");
        return false;
      }
    },
  };
}

/** Normalize local raster images; never persist a remote URL or the original file. */
export async function prepareBackground(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("请选择 JPG、PNG 或 WebP 图片");
  if (file.size > 10 * 1024 * 1024) throw new Error("图片不能超过 10 MB");
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte);
  const jpeg = header[0] === 255 && header[1] === 216 && header[2] === 255;
  const webp =
    String.fromCharCode(...header.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...header.slice(8, 12)) === "WEBP";
  if (!png && !jpeg && !webp) throw new Error("无法读取这张图片：文件内容不是 JPG、PNG 或 WebP");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error("无法读取这张图片，请选择其他图片");
    }
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 40_000_000
    )
      throw new Error("图片尺寸过大，请使用不超过 4000 万像素的图片");
    const scale = Math.min(1, 1920 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("此浏览器无法处理背景图片");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/webp", 0.8);
    if (data.length > BACKGROUND_LIMIT) throw new Error("压缩后的图片仍然过大，请选择更小的图片");
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}
