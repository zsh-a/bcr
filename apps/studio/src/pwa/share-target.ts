import { parseSharedContent, saveSharedContent, type ShareApp } from "@bcr/react/share-inbox";

/** POST is handled locally, including offline; file bytes never reach the server. */
export async function receiveShare(
  request: Request,
  app: ShareApp,
  startUrl: string,
): Promise<Response> {
  const redirect = new URL(startUrl, request.url);
  try {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > 129 * 1024 * 1024) throw new Error("本次分享超过 128 MiB，请分批导入");
    const content = parseSharedContent(app, await request.formData());
    await saveSharedContent(content);
    redirect.searchParams.set("share", content.id);
  } catch (reason) {
    const message =
      reason instanceof DOMException && reason.name === "QuotaExceededError"
        ? "本机空间不足，请释放空间后重新分享"
        : reason instanceof Error
          ? reason.message
          : "无法保存分享内容，请重试";
    redirect.searchParams.set("shareError", message.slice(0, 200));
  }
  return Response.redirect(redirect.href, 303);
}
