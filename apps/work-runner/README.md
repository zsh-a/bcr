# BCR Work Runner

Runner 提供 HTTP、CLI 与 MCP 的持久任务、不可变源码快照、版本、页面/视频审阅和交付能力。实际制作统一使用 [`@bcr/work-engine`](../../packages/work-engine/README.md)；Works 是浏览器控制面。作品源码保存在独立工作区，例如 `~/bcr-projects`。

## 本机使用

```sh
# 在 BCR 仓库安装 JS 工具；音频环境由 uv 单独锁定
bun install --frozen-lockfile --ignore-scripts
bun run work --root ~/bcr-projects doctor
bun run work --root ~/bcr-projects init my-work --title '我的作品'
bun run runner start --root ~/bcr-projects --origin http://localhost:5199
bun run runner list --json
```

安装后的命令分别为 `bcr-work` 和 `bcr-runner`。前者提供同步制作、音频、缓存维护和发布；后者提供服务生命周期、持久任务及审阅接口。两者共用制作代码、依赖缓存、素材策略和 AV1 编码器。`bcr-runner create DIR` 是同一标准 video 模板的兼容创建入口；不再复制经济学演示、Three.js 场景或另一套制作脚本。

`bcr-work --root DIR` 显式选取工作区；默认从当前目录向上找 `workspace.json`，然后读取本机 Runner 配置中的授权目录。`workspace.json` 保存工程角色与缓存预算，作品自己的 `work.json` 保存稳定 ID 和通用目标，`production.json` 保存音频与素材策略。Python 制作环境在 `packages/work-engine/audio`。

## 构建、预览与导出

```sh
bcr-runner preview my-work --target main
bcr-runner validate my-work --target main
bcr-runner capture my-work --target main --frames 0,30
bcr-runner render my-work --target main --from 0 --to 59
bcr-runner job JOB_ID --json
bcr-runner download JOB_ID video.mp4 --output ./video.mp4
```

每个任务固定 `sourceId + workId + sourceRevision + targetId`，以 `requestId` 实现重试。任务读取已校验的源码快照；不会再创建逐任务的 `project` 或 `bundle` 副本。依赖环境按独立 `package.json`、`bun.lock` 复用冻结安装，禁止工程外本地依赖。Rspack 构建和 PNG 帧按输入身份共享，修改编码质量可复用帧。CLI 与 Runner 使用同一个 SQLite 缓存索引和工作区预算，默认 8 GiB。

视频默认 AV1 NVENC、CQ20、AAC/48kHz。`--profile draft` 使用一半尺寸和 CQ26，`final` 使用原尺寸；`--scale`、`--cq` 可以覆盖。编码器不可用时任务失败，不静默改成另一种格式；明确回退用 `--encoder libaom-av1 --cpu-reason '实际原因'`。Chromium WebGL 与视频编码分别选择；三维目标可使用 `--gl angle`，普通软件图形使用 `--gl swangle`。正式视频拒绝标准音频工程的草稿或过期实测时间轴。

带连续母带的作品直接混入母带；通用 Remotion 作品仍支持组件中的音轨，由同一引擎拼接音频后编码 AV1。HTML、三维作品、参数面板、MessagePort 定位、审阅和版本功能继续支持，特殊依赖留在作品自己的锁文件中。

预览站点只保存播放器等小文件，通过白名单读取不可变快照的素材；排除 `production.json` 中的私有声音，也不复制整套 `public`。即使构建缓存被回收，已经成功的预览仍可读取固定素材。旧预览仍保持路径，私有素材请求同样按当前快照策略过滤。

## 历史、交付与维护

源码快照、原始旁白、对齐、任务输出、审阅、版本和成片属于持久数据。缓存回收只处理共享依赖、构建和帧；旧任务的 `project`、`bundle` 可用 `bcr-work gc --legacy-scratch --apply` 清理，保留记录、输出与预览。既有 `sourceId` 与状态目录继续沿用，旧 H.264 文件不转码或覆盖。

`bcr-work release` 对已验收的全片 AV1 和配套文件逐文件校验，再原子切换发布版本；Works 的定稿交付固定审阅选中的不可变产物。两种交付保留各自所需的制作和审阅证据，共用同一制作引擎，不合并或改写历史记录。

## 验证与分发

```sh
bun run check:work
bun run test:runner:engine       # Player、命名导出、音轨、AV1、缓存及归档的实际验收
bun run test:browser:runner      # 实际引擎验收与浏览器/MCP 审阅闭环
bun run build:runner
bun run test:runner:release      # 独立安装与统一模板验证
```

没有 NVIDIA 的显式验收环境可设置 `BCR_ENGINE_TEST_CPU=1`；该测试会记录真实 CPU 回退原因。独立包同时包含 `bcr-work`、`bcr-runner`、共享引擎资源及锁；Docker 使用生成包作为构建上下文。真实音频制作还需要 uv、锁定 Python/CUDA 环境及本机 TTS 服务，不在容器镜像中复制参考声音或模型。
