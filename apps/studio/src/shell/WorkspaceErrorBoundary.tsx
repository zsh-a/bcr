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
      <section className="p-6" aria-label={`${this.props.title}加载失败`}>
        <WorkspaceTrigger />
        <h1>{this.props.title}暂时无法打开</h1>
        <p role="alert">{this.state.error.message}</p>
        <p>请检查网络和应用更新。其他已打开的工作区仍可继续使用。</p>
        <AppUpdateButton />
      </section>
    );
  }
}
