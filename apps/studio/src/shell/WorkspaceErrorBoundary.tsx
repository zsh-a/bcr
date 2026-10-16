import { AppUpdateButton, WorkspaceTrigger } from "@bcr/react";
import { Component, type ReactNode } from "react";

/** A missing lazy chunk must not unmount other apps or their update save guards. */
export class WorkspaceErrorBoundary extends Component<
  { title: string; children: ReactNode },
  { error: Error | null }
> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="workspace-load-error" aria-label={`${this.props.title}加载失败`}>
        <WorkspaceTrigger />
        <h1>{this.props.title}暂时无法打开</h1>
        <p role="alert">应用资源暂时无法加载，可能是网络中断或刚刚发布了新版本。</p>
        <p>联网后检查更新即可重试，也可以从左上角切换到其他应用继续工作。</p>
        <AppUpdateButton />
        <details>
          <summary>错误详情</summary>
          <pre>{this.state.error.message}</pre>
        </details>
      </section>
    );
  }
}
