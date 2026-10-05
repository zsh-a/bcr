# 用 Works 创作动态图形视频

[Works](WORKS.md) 提供预览、参数、批注与产物管理；[Runner](../apps/work-runner/README.md) 执行构建和渲染；普通代码工程持有数据、分镜、主题、动效和素材。Agent 可以在这个目录持续创作，无须修改 BCR 应用。

## 从可运行的工程开始

安装或更新 Runner 后创建新目录，并连接 Works：

```sh
# 新作品从通用 starter 开始
bcr-runner create ~/bcr-projects/my-work --id my-work --title "我的作品"
bcr-runner start --root ~/bcr-projects --origin http://localhost:5199
bcr-runner inspect my-work --json
```

`create` 生成的工程已经包含页面目标、Remotion 目标、参数面板、纯计算模型和
`AGENTS.md`，可以直接交给 Codex 或 Claude Code 继续创作。

starter 的 Remotion 目标还预装了 `@remotion/three`、React Three Fiber 和 Three.js，
可以在同一份 TSX 场景中组合二维排版与按帧驱动的 3D 物件。把 `ThreeCanvas` 放入有明确
宽高的容器，并让旋转、相机和材质参数由 `useCurrentFrame()` 派生，预览和服务端导出就能
保持一致。

打开 Works，配对并选择 Runner 作品的 vertical 目标。工程可以按需增加组件，而不必
迁移成固定的页面或镜头协议。

独立项目中的 `bun install --frozen-lockfile --ignore-scripts`、`bun run typecheck` 可用于代码检查。渲染时 Runner 会在不可变任务目录独立安装相同锁文件，不复用工程 node_modules。

## 作品的代码组织

| 文件                         | 职责                                               |
| ---------------------------- | -------------------------------------------------- |
| brief.md                     | 受众、叙事、艺术方向与验收要求                     |
| work.json                    | 通用目标、画幅、帧率、时长、参数、所需素材         |
| Scene.tsx                    | 组合 React 镜头、转场、声音与统一画面元素          |
| src/scenes/                  | 可以自由修改的 TSX 镜头                            |
| src/components/              | 文字遮罩、帧同步错峰、镜头缩放、路径绘制等可选原语 |
| src/theme.ts / src/motion.ts | 作品自己的字体、色彩、节奏和镜头索引               |
| model.js / data.json         | 计算逻辑与输入假设，与网页目标共用                 |
| public/                      | 可离线使用的字体、图片、声音及许可证               |
| AGENTS.md / CLAUDE.md        | Coding Agent 的工作方式与验收标准                  |

这些是样例的组织约定；平台没有强制的场景 DSL，也不定义行业图表模板。复用代码先在作品内验证，确有多个工程复用需求时再发布独立组件包。

## 先静帧，再运动，最后成片

```sh
# 检查依赖、声明素材与第 0 帧；产物含 diagnostics.json。
bcr-runner validate <work-id> --target vertical --json
# 代表帧：价格、均价、临界点、结论。
bcr-runner capture <work-id> --target vertical --frames 0,30,120 --json
# 15 秒草稿：30 fps 下，起止帧均包含在内。
bcr-runner render <work-id> --target vertical --profile draft --from 0 --to 449 --json
# 原尺寸成片。
bcr-runner render <work-id> --target vertical --profile final --json
```

每个命令返回任务 ID。用 `bcr-runner job JOB_ID --json` 等待成功，然后 `bcr-runner download JOB_ID video.mp4 --output ./video.mp4`。MCP 对应 runner_render / runner_job / runner_output；图片可通过 image:true 直接交给 Agent 检查；诊断 JSON 可通过 text:true 直接读取。浏览器助手的 work_output 也支持 text:true。

在 Works「制作」中打开「导出」，选择视频、关键帧或素材检查，并设置导出质量、帧号或片段范围。草稿默认为一半宽高，成片为原始尺寸；两者保持相同帧号和时长。质量设置只影响导出，交互预览仍使用同一组件。

检查三类结果：代表帧的排版与数据、转场附近的连续画面、实际播放时的节奏与声音。拖动到不同镜头后再返回同一帧，画面应一致。诊断报告只检查素材清单和第 0 帧，不承诺扫描所有字形或镜头。

## 给 Agent 的任务示例

> 在 runner_read 返回的作品目录里，把视频改成编辑式动态图形。先读 brief.md 和 AGENTS.md。保留计算模型与目标 ID，允许自由改写 TSX 分镜。使用本地字体、明确的数字层级、遮罩揭示、错峰动作、曲线绘制和少量音效。先生成三张风格帧和前 15 秒草稿，检查转场与手机可读性；再渲染整片、读取批注并修订。每次修改后重新读取 revision，等待任务成功，再检查实际产物。

所有金额应来自模型，弹簧仅用于装饰和位置。GSAP 通过 @remotion/gsap 的 useGsapTimeline 接入，禁止独立播放或用回调推进业务状态。Remotion 及其扩展包版本保持一致；目前为 4.0.532。

## 扩展到 3D 与特殊效果

先在作品自己的 package.json 中加入依赖并更新 bun.lock，再同时验证 Bun Player 与 Webpack 导出。二者使用同一组件，但不是同一构建器，特殊加载器或 WASM 仍可能需要 Runner 适配。

可通过 `--gl angle` 或 `--gl swangle` 选择服务端图形后端。没有 GPU 的服务器或 CI 推荐使用
`--gl swangle`；有可用 GPU 的部署环境再选择 `--gl angle`。已有三维组件不因此自动获得全部
GPU 特性，仍需要在实际部署环境验证。HTML-in-canvas 等实验能力应进行浏览器能力检测，且
保留普通二维/视频预览路径。参考 [GSAP 适配](https://www.remotion.dev/docs/gsap)、
[Three.js 集成](https://www.remotion.dev/docs/three)与[HTML-in-canvas](https://www.remotion.dev/docs/html-in-canvas)。
