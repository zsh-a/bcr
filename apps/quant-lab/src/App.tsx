import { RuntimeProvider, Spinner, usePublishRunningCount, useRuntimeSession } from "@bcr/react";
import { useState } from "react";
import { QuantWorkbench } from "./jsg/Workbench";
import { createRuntimeServices } from "./runtime";
import "./styles.css";

export function App() {
  const { services, error } = useRuntimeSession(createRuntimeServices);
  if (error !== null) {
    return (
      <div className="ql-boot-error" role="alert">
        量化研究启动失败 · {error}
      </div>
    );
  }
  if (services === null) {
    return (
      <div className="ql-boot" role="status">
        <Spinner />
        正在打开量化研究…
      </div>
    );
  }
  return (
    <RuntimeProvider services={services}>
      <ResearchWorkbench />
    </RuntimeProvider>
  );
}

function ResearchWorkbench() {
  const [busy, setBusy] = useState(false);
  usePublishRunningCount("quant", busy ? 1 : 0);
  return (
    <div className="quant-lab ql-research-shell" data-workbench="quant">
      <section className="ql-research-view" aria-label="量化策略研究">
        <QuantWorkbench onBusy={setBusy} />
      </section>
    </div>
  );
}
