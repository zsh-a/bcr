# BCR Works Runner

Runner 是独立的作品执行服务。它拥有一个或多个普通代码工程，负责发现工程、固定源码快照、构建预览、渲染图片/视频、记录任务和保存审阅交付。Works 只是浏览器控制面；Codex、Claude Code 等 Coding Agent 直接通过 Runner MCP 读取和修改工程。

Runner 不依赖 BCR 仓库源码，也不提供浏览器内代码编辑器。工程目录是作品源码、数据、素材、依赖和创作规范的唯一来源。

## 安装与启动

仓库开发时：

```sh
bun run runner init ~/bcr-projects/gym-card
bun run runner start --root ~/bcr-projects --origin http://localhost:5199
bun run runner status
bun run runner token
```

发布包可以安装到任意独立目录，运行时不读取 BCR 的 workspace 或锁文件：

```sh
bun run build:runner
bun install --global ./dist/work-runner/bcr-work-runner-0.2.0.tgz
bcr-runner start --root ~/bcr-projects --origin https://bcr.example.com
```

打开 Works，选择「连接 Runner」，填写服务地址和配对密钥。服务地址与 BCR 页面必须是不同来源；`--origin` 必须精确匹配 Works 的浏览器来源。源码、状态和任务产物都在工程目录及 Runner 状态目录中，浏览器关闭不会取消已经入队的任务。

`start` 适合后台服务，`serve` 适合前台调试。每个状态目录只允许一个 Runner 实例。远程部署时为控制 API 和预览分别配置 HTTPS 代理；Runner 读取的是部署机器上的工程目录，工程应先通过 Git 或其他发布流程同步到该机器。

## 工程契约

每个工程根目录必须有 `work.json`：

```json
{
  "format": "bcr-project-1",
  "id": "gym-card",
  "title": "健身房年卡，去多少次才划算？",
  "defaultTarget": "vertical",
  "targets": [
    {
      "id": "vertical",
      "runtime": "remotion",
      "entry": "Scene.tsx",
      "width": 1080,
      "height": 1920,
      "fps": 30,
      "durationInFrames": 1800,
      "propsFile": "data.json",
      "parameters": [
        { "key": "annualPrice", "label": "年卡价格", "type": "number", "min": 1, "max": 10000 }
      ]
    },
    { "id": "page", "runtime": "html", "entry": "index.html" }
  ]
}
```

工程结构由作者决定，推荐：

```text
brief.md                 受众、叙事、风格和验收标准
AGENTS.md / CLAUDE.md   Coding Agent 的工程规则
work.json                输出目标和可调参数
data.json / model.ts     输入快照和纯计算逻辑
src/scenes/              Remotion 场景
src/components/          可复用视觉组件
public/                  字体、图片、音频和许可证
```

HTML 目标使用已经生成的 HTML/CSS/JS；Remotion 目标使用普通 React 组件。Runner 不要求固定的页面模板或场景 DSL。工程可以声明多个目标，共享模型和素材。

Remotion 依赖应在工程自己的 `package.json` 与 `bun.lock` 中固定版本。Runner 在隔离任务目录中按锁文件安装依赖，不复用可变的工作区 `node_modules`，也不执行安装脚本。首次渲染需要兼容的 Chromium；可用 `BCR_RUNNER_BROWSER` 指定路径。

## CLI 与 MCP

常用 CLI：

```sh
bcr-runner list --json
bcr-runner inspect gym-card --json
bcr-runner validate gym-card --target vertical --json
bcr-runner preview gym-card --target vertical --json
bcr-runner capture gym-card --target vertical --frames 90,660,1050 --json
bcr-runner render gym-card --target vertical --profile draft --from 0 --to 449 --json
bcr-runner render gym-card --target vertical --profile final --json
bcr-runner jobs gym-card --json
bcr-runner job JOB_ID --json
bcr-runner download JOB_ID video.mp4 --output ./video.mp4
bcr-runner archive gym-card --target vertical --json
```

`validate` 会构建并渲染第 0 帧，输出 `diagnostics.json`。`capture` 适合代表帧，`render` 适合短预览或成片。长任务立即返回持久化 job ID，使用 `job` 轮询，失败必须按错误修复后重新提交。

Coding Agent 使用独立 STDIO MCP：

```sh
bcr-runner mcp --config ~/.config/bcr/work-runner.json
```

工具以 `runner_*` 命名，覆盖：

- `runner_catalog`、`runner_list`、`runner_read`、`runner_file`、`runner_snapshot`
- `runner_versions`、`runner_checkpoint`、`runner_diff`、`runner_restore`
- `runner_parameters`、`runner_render`、`runner_jobs`、`runner_job`、`runner_cancel`
- `runner_preview`、`runner_output`
- `runner_review_read`、`runner_review_edit`
- `runner_page_capture`、`runner_page_capture_read`、`runner_page_image`

典型顺序是：读取 catalog 和工程 → 读取 brief/规则 → 修改源码 → validate/capture → 渲染短预览 → 读取反馈 → 修改并提交新审阅稿。源码修改通过文件系统完成，Runner MCP 负责授权读取、快照、执行和审阅操作。

## 审阅、版本与交付

Works 的「制作」页只负责目标选择、参数试调、预览和任务产物；「审阅」页负责提交稿、帧/页面定位反馈、版本比较、确认反馈和固定交付。

审阅记录保存在 Runner 状态目录的 `reviews/<work-id>.json`，与源码 revision 分离。提交稿必须引用同一 source revision、target 和成功任务；新的意见使用 `review_edit` 的 `comment`，Agent 读取 `review_read` 后用 `addresses` 关联已处理反馈。系统不会因为渲染成功而自动接受反馈或定稿。

源码版本由文件字节哈希得到。命名检查点和恢复日志由 Runner 状态目录管理；完整历史仍建议由工程 Git 管理。交付清单保存任务 ID、产物 SHA-256、target 和 source revision，下载交付包后，后续源码变化不会改变已经固定的文件。

HTML 目标可以提交固定页面列表，并通过 `page_capture` 在隔离 Chromium 中生成 PNG、可见元素和警告。页面截图是审阅证据，不是源码编辑器。

## 快照与安全边界

Runner 对工程目录设置明确上限，拒绝符号链接、绝对路径和目录穿越。源码快照排除 `.git`、`node_modules`、`.bcr`、构建输出、环境变量和私钥文件；任务固定的源码 revision 不会被后续编辑改变。

控制 API 使用 Bearer 配对密钥和精确 Origin/Host 校验。预览使用独立来源，不携带控制密钥，并通过 CSP 限制外部连接。Runner 执行的是用户选择的可信代码，不是操作系统级不可信代码沙箱。

## 验证与发布

```sh
bun run typecheck
bun run test:runner
bun run build:runner
bun run test:runner:release
# 已启动 Studio 时执行真实浏览器创作链路
BCR_BROWSER_URL=http://localhost:5199 bun scripts/verify-work-runner.mjs
```

完整的 Works 控制面、Agent 创作流程与 Bridge 边界见 [docs/WORKS.md](../../docs/WORKS.md)、[视频创作](../../docs/VIDEO-AUTHORING.md) 和 [外部 Agent](../../docs/EXTERNAL-AGENTS.md)。
