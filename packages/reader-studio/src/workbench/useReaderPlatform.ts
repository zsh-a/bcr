import { useCallback, useEffect, useState, type RefObject } from "react";

import { useAppInstallation } from "@bcr/react";

export interface ReaderFullscreenState {
  readonly isFullscreen: boolean;
  readonly supported: boolean;
  readonly toggle: () => Promise<void>;
}

export function useReaderPwaInstall() {
  const app = useAppInstallation({
    manifestUrl: "/manifest.webmanifest",
    startUrl: "/pwa/reader/",
    scope: "/pwa/reader/",
  });
  return {
    canInstall: app.canPrompt,
    isInstalled: app.standalone || app.installedThisSession,
    install: app.install,
  };
}

/** Keep native fullscreen state in sync, including Esc and browser chrome exits. */
export function useReaderFullscreen(
  targetRef: RefObject<HTMLElement | null>,
  onError?: (message: string) => void,
): ReaderFullscreenState {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const target = targetRef.current;
    const canRequest =
      target !== null &&
      typeof target.requestFullscreen === "function" &&
      document.fullscreenEnabled !== false;
    setSupported(canRequest);

    const syncState = () => {
      setIsFullscreen(document.fullscreenElement === targetRef.current);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        document.querySelector("dialog[open], [popover]:popover-open") !== null
      )
        return;
      if (event.key !== "Escape" || document.fullscreenElement !== targetRef.current) return;
      event.preventDefault();
      if (typeof document.exitFullscreen === "function") {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
    document.addEventListener("fullscreenchange", syncState);
    document.addEventListener("keydown", onKeyDown);
    syncState();
    return () => {
      document.removeEventListener("fullscreenchange", syncState);
      document.removeEventListener("keydown", onKeyDown);
      if (document.fullscreenElement === target && typeof document.exitFullscreen === "function") {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, [targetRef]);

  const toggle = useCallback(async () => {
    if (typeof document === "undefined") return;
    const target = targetRef.current;
    if (target === null || !supported) {
      onError?.("当前浏览器不支持全屏阅读");
      return;
    }
    try {
      if (document.fullscreenElement === target) {
        await document.exitFullscreen();
        return;
      }
      if (document.fullscreenElement !== null) await document.exitFullscreen();
      await target.requestFullscreen();
    } catch {
      onError?.("无法进入全屏阅读，请检查浏览器的全屏权限");
    }
  }, [onError, supported, targetRef]);

  return { isFullscreen, supported, toggle };
}
