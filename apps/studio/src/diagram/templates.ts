export const flowTemplate = {
  nodes: [
    { id: "start", label: "开始", type: "ellipse" },
    { id: "input", label: "收集信息" },
    { id: "decision", label: "满足条件？", type: "diamond" },
    { id: "action", label: "执行并记录" },
    { id: "review", label: "补充信息" },
  ],
  edges: [
    { id: "e1", source: "start", target: "input" },
    { id: "e2", source: "input", target: "decision" },
    { id: "e3", source: "decision", target: "action", label: "是" },
    { id: "e4", source: "decision", target: "review", label: "否" },
    { id: "e5", source: "review", target: "input" },
  ],
  direction: "RIGHT",
};
export const architectureTemplate = {
  nodes: [
    { id: "browser", label: "浏览器\n交互与展示" },
    { id: "worker", label: "Worker\n计算与处理" },
    { id: "storage", label: "本地存储\n文件与索引" },
    { id: "data", label: "数据源\n查询与获取" },
  ],
  edges: [
    { id: "request", source: "browser", target: "worker", label: "任务" },
    { id: "persist", source: "worker", target: "storage", label: "读写" },
    { id: "fetch", source: "data", target: "worker", label: "数据" },
  ],
  direction: "RIGHT",
};
export const mermaidExample =
  "flowchart LR\n  browser[浏览器] --> worker[Worker]\n  worker --> storage[本地存储]\n  data[数据源] --> worker";
