# Work

这是一个独立的 BCR Work 工程，同时包含页面目标和 Remotion 视频目标。

Remotion 目标已经包含 Three.js、React Three Fiber 和 `@remotion/three`。`Scene.tsx`
中的 `CostStage` 是一个可按帧重现的 3D 起始场景；可以替换模型、材质和数据，但要保留
非零画布容器与帧号驱动规则。

```sh
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
```

使用 Runner 预览和导出：

```sh
bcr-runner validate <work-id> --target vertical --json
bcr-runner capture <work-id> --target vertical --frames 0,30,120 --json
bcr-runner render <work-id> --target vertical --profile draft --from 0 --to 449 --json
# 无 GPU 的服务器/CI 使用软件 WebGL；有可用 GPU 时可改成 --gl angle。
bcr-runner render <work-id> --target vertical --profile draft --gl swangle --from 0 --to 449 --json
```

先阅读 `brief.md` 和 `AGENTS.md`，再修改 `model.js`、`data.json` 和 `Scene.tsx`。
