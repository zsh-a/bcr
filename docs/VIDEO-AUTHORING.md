# 用 Works 创作视频

[Works](WORKS.md) 负责连接、预览、批注、版本和交付；[Runner](../apps/work-runner/README.md) 负责持久任务；[`work-engine`](../packages/work-engine/README.md) 统一提供制作能力。作品源码、分镜、数据、素材和创作要求保存在独立 Work 工程中。

## 创建与组织

```sh
bcr-work --root ~/bcr-projects init my-work --title '我的作品'
bcr-work doctor my-work
bcr-work preview my-work
bcr-runner start --root ~/bcr-projects --origin http://localhost:5199
```

新模板包括 `main`、`cover`、`cover-4x3` 三个目标。内容在 `content.json`，数据与出处在 `data.json`、`sources.json`，画面在 `src/`，创作简报与平台简介在 `docs/`，字体和图片在 `public/`。`work.json` 描述目标，`production.json` 描述制作策略，`voice.json` 描述本期声线与验收参数。模板带独立依赖锁、Biome 和 TypeScript；不预装无关的三维库，也不复制旧作品。

## 草稿到成片

1. 阅读工程 `AGENTS.md` 和 `docs/brief.md`，完成论证、口播、数据与出处。
2. `bcr-work draft ID` 更新估算时序，再用预览和 `capture` 检查文字、数据与手机可读性。
3. 准备本期已授权参考声音及其文本，运行 `bcr-work audio ID`。共享流水线按语义段落生成旁白、强制对齐、采样点拼接与连续母带；原始声音和对齐保留在 `.bcr/narration/`。
4. 运行 `bcr-work check ID`，导出真实短段并听审、观看，再导出全片。初始草稿与过期时间轴不能正式导出。
5. 在 Works 中审阅固定源码版本和产物；把已验收成片、报告、封面、简介与出处放入独立目录，用 `bcr-work release` 创建制作交付。

```sh
bcr-work capture ID --target cover
bcr-work render ID --from 0 --to 59
bcr-work render ID
bcr-work release ID --from-dir ./delivery
```

Works 导出与上述命令使用同一引擎。视频统一 AV1 NVENC 与 AAC/48kHz；`bcr-runner render` 返回任务 ID，必须等到成功并读取真实产物。CPU 回退需明确编码器和原因。自动检查不代替全长听审、观看或平台转码验收。

## 通用目标与扩展

已有 HTML、Three.js、参数面板和自定义 React 组件继续按 `work.json` 工作。三维、GSAP 等依赖仅在作品需要时加入 `package.json`，保持 Remotion 扩展版本一致，再更新独立 `bun.lock`。所有动画由帧号驱动，使用固定随机种子；三维容器具有明确宽高，WebGL 后端在实际环境中验收。

参数试调通过 MessagePort 更新播放器，写回源码后会产生新的 `sourceRevision`。审阅始终绑定 `sourceId + workId + sourceRevision + targetId`。构建器和浏览器能力仍需要实际验证，不能以一个模板截图代替本期业务验收。

参考声音按素材策略排除，源码归档仍可能包含私有制作源文件，不能当作公开预览包。历史成片和审阅记录保留原编码与身份。
