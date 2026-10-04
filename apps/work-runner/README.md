# Works Runner

Works 的本地执行适配器。普通目录是源码的唯一存储；浏览器通过 HTTP 配对、查看和操作。HTML 和 Remotion 是同一作品的输出目标，Agent 可以用 CLI、直接 MCP 或本地编辑器接续创作。

## 安装与启动

Runner 是独立服务，安装后不依赖 BCR 源码目录。Works Web、CLI、STDIO MCP 共用一个后台任务队列。目前支持 Linux/macOS；便携包针对构建机器的系统和架构生成。发布包尚未上传 npm 或公共下载服务。

发布物包含：`package/` 为包含锁文件的独立安装目录，`bcr-work-runner-0.2.0.tgz` 为 npm 包，`bcr-runner-<platform>-<arch>.tar.gz` 为可选便携包。内部 work-core 已编译进程序；发布物没有 workspace/catalog 依赖，也不读取 BCR 仓库锁文件。

推荐最终用户解压便携包到独立版本目录，例如：

```sh
mkdir -p ~/.local/share/bcr-runner/0.2.0
tar -xzf bcr-runner-linux-x64.tar.gz -C ~/.local/share/bcr-runner/0.2.0
export PATH="$HOME/.local/share/bcr-runner/0.2.0/bin:$PATH"
bcr-runner init ~/bcr-projects/gym-card
bcr-runner start --root ~/bcr-projects --origin http://localhost:5199
bcr-runner status
bcr-runner token
```

已有 Bun 的开发者也可以 `bun install --global /absolute/path/bcr-work-runner-0.2.0.tgz`。要严格使用随包提供的传递依赖锁文件，将 `package/` 复制到仓库外，在其中运行 `bun install --frozen-lockfile --production --ignore-scripts`，再用 `bun /path/to/package/dist/cli.js`；便携包已按锁文件安装依赖。

打开 BCR `/works` →「连接本地工程」，输入 `start` 返回的地址和 `token` 输出的配对密钥。`--origin` 必须与浏览器地址完全一致。默认控制端口 `5210`，预览端口独立分配。密钥只保留在当前浏览器会话。

`start` 后台运行并等待服务就绪；相同配置再次启动会复用服务。`serve` 在前台运行，适合系统服务和容器。`stop` 通过鉴权接口关闭所连接服务，不根据过期 PID 杀进程。`status` 返回连接状态、版本与进程身份；`doctor` 检查安装、worker、运行平台和连接；`doctor --install-browser` 显式准备浏览器。`init <新目录>` 复制内置样例，不覆盖已有目录。

首次图片/视频渲染由 Remotion 下载匹配的 Chrome Headless Shell。它存于 `$XDG_CACHE_HOME/bcr/remotion-4.0.532/`（默认 `~/.cache/bcr/`），跨任务复用。可通过 `BCR_RUNNER_BROWSER=/absolute/path/to/chrome` 指定兼容浏览器。Linux 仍需要 Chrome 系统库；下面的 Docker 镜像提供这些依赖。正式作品应将字体文件放进 `public/` 并等待加载后渲染。

`--root` 可以是单个工程或多个工程的父目录，只发现直属子目录。服务启动时固定授权目录。所有命令支持 `--config /path/to/connection.json`，默认 `$XDG_CONFIG_HOME/bcr/work-runner.json`（`~/.config/bcr/`），权限 0600；每个配置和状态目录只能运行一个服务。日志保存于状态目录 `runner.log`。使用不同配置和端口可以启动多个独立实例。

升级时安装新的版本目录，先 `stop`，再使用新程序 `start`；连接配置保留工程目录和启动设置。作品、批注、快照、产物均在安装目录之外。新版本启动后可用 `version`、`catalog` 验证版本和构建身份。重启不会自动续跑旧任务。

## Docker 与远程部署

Docker 的构建上下文是独立发布目录，可以复制到另一台机器：

```sh
cd /path/to/package
BCR_WORKS_DIR=/absolute/path/to/projects docker compose up -d --build
docker compose exec runner bun /opt/bcr-runner/dist/cli.js token
```

镜像内已包含 Bun、固定依赖、Chrome 系统库和 CJK 字体，使用非 root 用户；首次渲染下载浏览器。`/works` 挂载作品，`/data` 持久化状态、配置和缓存。宿主目录应允许容器内 `bun` 用户（UID 1000）读写。此模式运行用户选择的可信代码；子进程管理不是不可信代码沙箱。

Compose 默认仅将控制端口 5210、预览端口 5211 映射到宿主 loopback。服务器通过反向代理分别提供两个来源：

- `BCR_WEB_ORIGIN=https://bcr.example.com`：Works Web 来源。
- `BCR_RUNNER_URL=https://runner.example.com`：控制 API，代理至 5210。
- `BCR_PREVIEW_URL=https://preview.example.com`：作品预览，代理至 5211。

三个 origin 必须不同；代理应保留公开 Host。Runner 不信任转发头来扩大来源权限。原生服务等价选项为 `--host 0.0.0.0 --port 5210 --preview-port 5211 --api-url ... --preview-url ... --origin ...`。非 loopback 监听必须显式配置公开地址。控制 API 需要 Bearer；预览 URL 包含不可预测的任务 ID，拿到地址即可读取对应预览，不能把它当作私密素材的账号鉴权。

远程 Runner 读取服务器上的作品目录，需要事先复制工程或同步固定 Git 版本；尚未实现工程上传、自动隧道和多租户托管。线上 HTTPS Web 连接本机 Runner 涉及浏览器本地网络访问权限，不能仅依赖 CORS；需按目标浏览器验证。服务器 HTTPS 反向代理可避免公网网页访问 loopback 的部署路径。

## 工程契约

```json
{
  "format": "bcr-project-1",
  "id": "my-work",
  "title": "我的作品",
  "targets": [
    { "id": "page", "runtime": "html", "entry": "index.html" },
    {
      "id": "vertical",
      "runtime": "remotion",
      "entry": "Scene.tsx",
      "width": 1080,
      "height": 1920,
      "fps": 30,
      "durationInFrames": 1800,
      "propsFile": "data.json",
      "parameters": [{ "key": "price", "label": "价格", "type": "number", "min": 1, "max": 10000 }]
    }
  ]
}
```

Remotion 入口导出普通 React 组件（默认导出，或通过 `exportName` 指定命名导出），接收 `propsFile` 中的 JSON 对象。Runner 根据同一份目标元数据生成 Player 和 Composition，因此工程无需维护第二份画幅、帧率与时长配置。已有 Remotion 工程可以将其中一个组件作为目标；不直接发现已有 `registerRoot` 中的 compositions，也不支持 `calculateMetadata` 改写目标配置。

没有 `package.json` 时使用 Runner 的固定 React 依赖与 Remotion **4.0.532**，具体版本通过 `bcr-runner version` 查看。需要其他库时添加独立 `package.json` 和 `bun.lock`，其中 `remotion`、`@remotion/player` 都固定为 `4.0.532`，同时声明 React/React DOM。Runner 在任务目录执行 `bun install --frozen-lockfile --ignore-scripts`；不复用工作目录的可变 `node_modules`，不运行安装脚本。不支持 workspace/file/link 路径依赖。标准 Remotion 用法见[动画文档](https://www.remotion.dev/docs/animating-properties)、[Player](https://www.remotion.dev/docs/player)、[渲染接口](https://www.remotion.dev/docs/renderer)与[许可条款](https://www.remotion.dev/docs/license/pricing)。

普通 HTML 目标直接提供已生成的 HTML/CSS/JS，支持相对 ESM 与同源数据 fetch；没有隐式 npm build 命令。任意框架可先在工程中生成这些文件。两种目标都不限制组件风格或业务模型；`example/` 只是独立样例。

## CLI / Agent

```sh
bcr-runner list --json
bcr-runner inspect gym-card --json
bcr-runner preview gym-card --target vertical --json
bcr-runner capture gym-card --target vertical --frames 0,360,1500 --json
bcr-runner render gym-card --target vertical --from 300 --to 389 --scale 0.5 --json
bcr-runner render gym-card --target vertical --json
bcr-runner jobs gym-card --json
bcr-runner job JOB_ID --json
bcr-runner download JOB_ID video.mp4 --output ./video.mp4
bcr-runner cancel JOB_ID --json
bcr-runner reviews gym-card --json
bcr-runner archive gym-card --target vertical --json
```

长任务立即返回 `job.id`，通过 `job` 轮询。`from` / `to` 是包含两端的绝对帧号，短预览仍保持原动画时间轴。`validate` 会构建并实际渲染第 0 帧，以检查代码、依赖及资源；它不是完整 TypeScript 类型检查，工程仍可配置自己的 `tsc`。

`bcr-runner rpc OPERATION --input request.json` 可调用同一 HTTP 契约中的 `parameters`、`reviews`、`review`、`snapshot` 等操作。CLI 默认使用最近一次启动的 Runner 配置（`~/.config/bcr/work-runner.json`，权限 0600）；也可通过 `--url`、`--token` 显式连接。

## 直接 MCP

STDIO MCP 直接连接已启动的 Runner，不依赖 BCR 页面：

```sh
bcr-runner mcp
# 指定其他服务的配对配置
bcr-runner mcp --config /path/to/connection.json
```

在 Agent 的 MCP 设置中使用已安装程序的绝对路径作为 `command`，`args` 为 `["mcp", "--config", "/path/to/connection.json"]`。MCP 只连接已有服务，不创建另一套任务队列；先运行 `start`。标准输出只写 MCP 消息，诊断写入标准错误。连接失败会明确退出。

独立工具使用 `runner_*` 前缀，避免与浏览器 `work_*` 混淆：

- `runner_catalog` 返回协议、程序版本、engine、授权根目录、操作和运行时。
- `runner_list` / `runner_read` / `runner_file` / `runner_snapshot` 检查工程和源码快照。
- `runner_parameters` / `runner_reviews` / `runner_review` 处理参数和批注。
- `runner_render` / `runner_jobs` / `runner_job` / `runner_cancel` 操作持久化任务。
- `runner_preview` 返回已完成预览任务的独立 URL；直接 MCP 不控制 Works 页面中的播放状态。
- `runner_output` 返回产物元数据和需 Bearer 的下载地址；`image: true` 直接返回不超过 4 MiB 的 PNG 图像，供 Agent 检查。

任务与修改使用 revision 和 requestId，重试应保留原值。MCP、CLI、Works HTTP 操作由相同 service/schema 校验。直接 MCP 不受浏览器草稿保护影响，参数保存仍会检查源码 revision；浏览器中的旧草稿保存时会报冲突。它仅访问授权文件目录，不直接访问浏览器知识库。

Runner CLI/HTTP/直接 MCP 均不依赖浏览器；已接受的任务不会因客户端断线而取消。

浏览器助手使用 `work_*` 操作在 Works 中配对的 Runner，可控制页面中的播放器并将产物导入工作区。那条路径需要浏览器在线；`work_catalog` 提供具体工具契约。

## 快照、批注与任务

源码快照以路径、文件字节哈希和大小生成 revision。渲染前固定源码；后续编辑不会改变已接受任务。`renderKey` 同时包含源码 revision、目标、帧范围、输出比例和 Runner/依赖/平台身份；该身份用于追溯，每个新的 requestId 都实际执行，不做隐式跨任务缓存命中。

批注保存在工程根目录的 `reviews.json`，包含 `id`、`sourceRevision`、`target`、可选 `frame` / `sceneId`、`comment` 和 `status`。批注文件不进入渲染 revision；更新批注需要它自己的 revision。使用旧数据的批注和预览会在 UI 中标记。参数更新对源码 revision 做乐观检查，同窗口未保存参数草稿会阻止 Agent 参数写入；外部编辑器仍可独立修改文件。

任务记录、源码快照和产物保存在 `~/.local/share/bcr/work-runner/<root-hash>/`，也可用 `--state` 指定工程目录之外的位置。一个状态目录只能有一个 CLI Runner。队列串行执行，最多 20 个待执行任务；每个任务是可取消的子进程，30 分钟超时。Runner 重启把未完成任务标为 `interrupted`，不会悄悄恢复或把部分 MP4 当作成功。相同 requestId 与参数重试返回原任务。

每个工程最多 2000 文件、单文件 64 MiB、总量 256 MiB。恢复归档时忽略根目录的 `bcr-snapshot.json`，保持源码 revision；`.bcr-player.tsx`、`.bcr-render.tsx`、`bcr-preview.js` 是 Runner 保留文件名。快照排除 `.git`、`node_modules`、`.bcr`、`dist`、`out`、`reviews.json`、`.env*`、私钥文件和临时文件；入口不能引用被排除文件，HTML 构建产物请放在 `site/` 等目录。符号链接、绝对路径与目录穿越被拒绝。状态和任务产物暂不自动清理，避免删除被批注、导出或 Agent 引用的版本。

`archive` 输出 `source.tar.gz`，包含源码及 `bcr-snapshot.json` 清单，可解压到新的工程目录后连接 Runner。归档不包含 node_modules、任务历史或 reviews.json；批注文件独立保存在原工程，应随 Git 或其他备份一起保存。恢复后可按相同锁定依赖重新生成；系统字体、未固定的外部资源和平台编码器差异仍会影响字节级一致性。

## 边界与验证

控制 API 只接受配对 Bearer 密钥和明确配置的浏览器 Origin/Host，不能通过 API 改变授权根目录。预览使用独立端口和来源，不携带控制密钥；iframe 与主 UI、控制 API 均不同源。预览 CSP 仅允许本地与内嵌资源，阻止外部连接、嵌套 frame 和任意宿主命令。私有 MessagePort 只接受播放、定位、检查操作，反馈仍是作品自身输出。

本地工程是用户选择的可信代码，Runner 不是操作系统沙箱；不应作为任意不可信代码托管平台。

## 开发与发布

仓库维护者构建发布物（Bun 1.3.14+）：

```sh
bun run build:runner
# 额外生成包含 Bun 和依赖的便携包，无需用户安装 Node/Bun
bun run build:runner --portable
```

构建输出在 `dist/work-runner/`。仓库内调试使用 `bun run runner`，与安装后的 `bcr-runner` 是同一个 CLI。`serve` 适合前台调试，`start` 适合后台使用。

```sh
bun run test:runner
bun run build:runner
bun run test:runner:release
# 可选：验证无需系统 Bun 的便携包
bun run build:runner --portable
bun run test:runner:release --portable
# 已有开发服务时，指明同一 origin；该测试真实导出 PNG 和 MP4。
BCR_BROWSER_URL=http://localhost:5199 bun scripts/verify-work-runner.mjs
# 独立锁文件安装、完整 60 秒编码和归档恢复（较慢）
bun apps/work-runner/tests/dependencies.mjs
```
