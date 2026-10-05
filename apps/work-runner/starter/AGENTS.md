# Work authoring

这是一个独立的 Work 工程。源码、数据、素材和创作规则都在这里；不要修改 BCR 仓库源码。

- 先阅读 `brief.md`、`work.json`、`data.json` 和 `model.js`。
- 保留稳定的 Work ID 和 target ID；页面与视频可以共享模型和数据。
- 先修改源码，再执行 `bcr-runner validate` 和 `bcr-runner capture`，检查关键帧后再导出短预览。
- 所有动画由 Remotion 帧号驱动；不要使用墙上时钟、未固定的随机数或独立播放循环。
- 3D 场景使用 `@remotion/three` 的 `ThreeCanvas` 和 React Three Fiber；动画值从 `useCurrentFrame()` 或其派生参数计算，不使用 `useFrame()` 自主推进时间。
- 3D 画布必须放在有明确宽高的非零容器中（通常是 `position: relative; width: 100%; height: 100%`），否则服务端渲染无法创建 WebGL 上下文。
- 在无 GPU 的 CI 或服务器上，用 `--gl swangle` 验证和导出；有可用 GPU 的部署环境再选择 `--gl angle`。
- 字体、图片和音频放在 `public/`，并记录来源和许可证；渲染不能依赖 CDN。
- Runner 任务返回 job ID，必须轮询到成功并实际检查产物，不能把提交任务当作渲染成功。
- 最终交付前保存 Git 提交，并用 Runner archive 固定源码快照和产物身份。
