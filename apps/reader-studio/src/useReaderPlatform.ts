import { useCallback, useEffect, useState, type RefObject } from "react";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: ReadonlyArray<string>;
  readonly userChoice: Promise<{
    readonly outcome: "accepted" | "dismissed";
    readonly platform: string;
  }>;
  prompt: () => Promise<void>;
}

export interface ReaderPwaInstallState {
  readonly canInstall: boolean;
  readonly isInstalled: boolean;
  readonly isIos: boolean;
  readonly install: () => Promise<boolean>;
}

export interface ReaderFullscreenState {
  readonly isFullscreen: boolean;
  readonly supported: boolean;
  readonly toggle: () => Promise<void>;
}

function pendingReaderInstallPrompt(): BeforeInstallPromptEvent | null {
  if (typeof window === "undefined") return null;
  return (
    (window as Window & { __bcrReaderInstallPrompt?: BeforeInstallPromptEvent })
      .__bcrReaderInstallPrompt ?? null
  );
}

export function useReaderPwaInstall(): ReaderPwaInstallState {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() =>
    pendingReaderInstallPrompt(),
  );
  const [isInstalled, setIsInstalled] = useState(() => {
    if (typeof window === "undefined") return false;
    const safariStandalone =
      (window.navigator as Navigator & { readonly standalone?: boolean }).standalone === true;
    return window.matchMedia("(display-mode: standalone)").matches || safariStandalone;
  });
  const isIos =
    typeof navigator !== "undefined" &&
    (/iphone|ipad|ipod/iu.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

  useEffect(() => {
    const syncInstalled = () => {
      const safariStandalone =
        (window.navigator as Navigator & { readonly standalone?: boolean }).standalone === true;
      setIsInstalled(window.matchMedia("(display-mode: standalone)").matches || safariStandalone);
    };
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onReaderInstallPrompt = () => {
      const prompt = pendingReaderInstallPrompt();
      if (prompt !== null) setDeferredPrompt(prompt);
    };
    const onAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      delete (window as Window & { __bcrReaderInstallPrompt?: BeforeInstallPromptEvent })
        .__bcrReaderInstallPrompt;
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("bcr-reader-install-prompt", onReaderInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    syncInstalled();
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("bcr-reader-install-prompt", onReaderInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    const prompt = deferredPrompt;
    if (prompt === null) return false;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") setIsInstalled(true);
      return true;
    } catch {
      return false;
    } finally {
      setDeferredPrompt(null);
      delete (window as Window & { __bcrReaderInstallPrompt?: BeforeInstallPromptEvent })
        .__bcrReaderInstallPrompt;
    }
  }, [deferredPrompt]);

  return {
    canInstall: !isInstalled && deferredPrompt !== null,
    isInstalled,
    isIos,
    install,
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
