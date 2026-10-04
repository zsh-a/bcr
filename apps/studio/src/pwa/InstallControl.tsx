import { AppOfflinePanel, Button, Dialog, useAppInstallation } from "@bcr/react";
import { Download } from "lucide-react";
import { useState } from "react";
import { pwaAtPath, type PwaApp } from "./apps";
import "./install.css";

export function PwaInstallDialog({
  app,
  open,
  onClose,
  onBackup,
}: {
  app: PwaApp;
  open: boolean;
  onClose: () => void;
  onBackup?: () => Promise<void>;
}) {
  const installation = useAppInstallation(app);
  const dedicated = pwaAtPath(location.pathname)?.key === app.key;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${app.shortName} · 安装与离线`}
      placement="sheet"
      className="pwa-install-dialog"
    >
      <div className="pwa-install-identity">
        <img src={`/icons/${app.icon}-icon-192.png`} width="56" height="56" alt="" />
        <div>
          <strong>{app.name}</strong>
          <p>从手机桌面直接打开，继续上次的工作。</p>
        </div>
      </div>
      {installation.standalone || installation.installedThisSession ? (
        <p role="status">
          {installation.standalone ? "正在独立应用中使用。" : "安装已完成，可从桌面图标打开。"}
        </p>
      ) : (
        <>
          {!dedicated || installation.canPrompt ? (
            <Button variant="primary" onClick={() => void installation.install()}>
              <Download size={16} />
              {dedicated ? `安装${app.shortName}` : `前往${app.shortName}安装页`}
            </Button>
          ) : null}
          {dedicated && (
            <details className="bcr-install-help" open={!installation.canPrompt}>
              <summary>通过 Chrome 菜单安装</summary>
              <p>在 Android Chrome 菜单选择“添加到主屏幕”或“安装应用”，确认名称为“{app.name}”。</p>
              <p>未看到安装选项？请用 Chrome 打开此页；已安装时可从桌面图标打开。</p>
            </details>
          )}
        </>
      )}
      <AppOfflinePanel
        backup={
          onBackup
            ? {
                label: "导出笔记备份",
                run: onBackup,
                successMessage: "已发起备份下载，请在下载列表中确认并保管 ZIP 文件。",
              }
            : undefined
        }
      />
    </Dialog>
  );
}

export function InstallControl({ app }: { app: PwaApp }) {
  const [open, setOpen] = useState(false);
  const installation = useAppInstallation(app);
  if (installation.standalone || installation.installedThisSession) return null;
  return (
    <>
      <Button variant="ghost" className="pwa-install" onClick={() => setOpen(true)}>
        <Download size={16} />
        安装{app.shortName}
      </Button>
      {open && <PwaInstallDialog app={app} open onClose={() => setOpen(false)} />}
    </>
  );
}
