# 开发指南

[文档](README.md) → 开发

## 环境

| 工具      | 要求                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| Bun       | 使用根 [package.json](../package.json) 的 `packageManager` 版本                                                     |
| Rust      | 安装 `wasm32-unknown-unknown` 目标；Agent 子模块使用自己的 [toolchain](../crates/agent-runtime/rust-toolchain.toml) |
| wasm-pack | 构建 Rust/WASM；CI 的安装版本见 [ci.yml](../.github/workflows/ci.yml)                                               |
| Node.js   | 运行 `scripts/*.mjs` 浏览器检查，使用支持仓库脚本的现代 Node 环境                                                   |
| 浏览器    | 推荐 Chromium；本地持久化依赖安全上下文、OPFS 与 Web Locks                                                          |

Vite+ 随仓库安装，不需要全局安装 `vp`。下文用 `bunx vp` 调用本地工具。

## 首次启动

```sh
git clone --recurse-submodules https://github.com/zsh-a/bcr.git
cd bcr
bun install
rustup target add wasm32-unknown-unknown
(cd crates/agent-runtime && rustup target add wasm32-unknown-unknown)
bun run build:wasm
bun run dev
```

已有 checkout 缺少 Agent 源码时，先执行 `git submodule update --init --recursive`。`build:wasm` 依次构建 kernels、Quant 和 Agent；生成目录不入库。

Studio 地址为 **http://localhost:5199**。`bun run dev`与`bun run studio` 指向同一入口；Reader、Documents、Data 由 Studio 加载，没有各自的开发服务器。

同一主机尽量固定域名和端口，避免切换到另一份浏览器存储。手机通过普通局域网 HTTP 地址访问时，不应预期具有与 HTTPS 或本机 localhost 相同的持久化能力；调试时使用具备安全上下文的地址。

## 常用命令

| 命令                                                       | 用途                              |
| ---------------------------------------------------------- | --------------------------------- |
| `bun run dev`                                              | 完整工作区                        |
| `bun run media` / `quant` / `markets` / `manga` / `docgen` | 对应应用的独立开发入口            |
| `bun run demo`                                             | 最小 Runtime 示例                 |
| `bun run build:wasm`                                       | 重建全部 WASM                     |
| `bun run build:wasm:quant` / `build:wasm:agent`            | 只重建对应内核                    |
| `bun run check`                                            | 格式、Lint、TypeScript 与依赖边界 |
| `bun run typecheck`                                        | 仅 TypeScript                     |
| `bun run test`                                             | TypeScript 单元测试               |
| `bun run build:cloudflare`                                 | WASM 与 Studio 生产构建           |

完整命令以 [package.json](../package.json) 为准，开发端口由各应用的 `vite.config.ts` 指定。

## 验证

安装浏览器后，可运行自动管理服务器的回归套件：

```sh
bunx playwright install chromium
bun run test:ci
bun run test:browser
bun run test:browser --group=reader
bun run test:browser:full
```

套件按 `workspace`、`quant`、`reader` 分组，流程清单与分组规则在 [browser-suites.mjs](../scripts/lib/browser-suites.mjs)。使用 `bun run test:browser --list` 查看选中的检查。

自动套件需要空闲端口，不复用已经运行的开发服务器。默认 Studio 端口从 5199 起，Media 为 5180；可用 `BCR_VERIFY_STUDIO_PORT` 和 `BCR_VERIFY_MEDIA_PORT` 改为另一组空闲端口。

已有开发服务器时，直接运行对应检查：

```sh
BASE_URL=http://127.0.0.1:5199 bun run test:browser:diagram
BASE_URL=http://127.0.0.1:5199 node scripts/verify-reader-pdf-experience.mjs
BASE_URL=http://127.0.0.1:5199 node scripts/verify-mobile-knowledge-reader.mjs
```

截图、日志和耗时记录位于 `scripts/shots/`。浏览器模拟可覆盖布局和交互，不能替代真实手机的键盘、安全区和性能验证。

Rust 与研究检查独立运行：

```sh
cargo test --manifest-path crates/kernels/Cargo.toml
bun run test:rust:quant
bun run research:trend:test
```

PWA 检查使用生产产物，并自行启动静态服务器：

```sh
bun run build:cloudflare
bun run test:pwa
bun run test:pwa:knowledge
bun run test:pwa:apps
```

CI 在 push/PR 时执行核心验证，手动触发 `full=true` 时增加完整浏览器套件、独立应用构建和原生集成检查。具体范围以 [workflow](../.github/workflows/ci.yml) 为准。

## 修改代码时

- 领域应用通过公开包入口互相引用；Runtime 分层由根 [vite.config.ts](../vite.config.ts) 的 Lint 规则约束。
- 共享控件、令牌和响应式行为遵循[工作区交互约定](WORKSPACE-UI.md)，领域页面只管理自身内容与状态。
- 新增任务、保存队列或编辑草稿时，接入 [Runtime 生命周期](RUNTIME-ARCHITECTURE.md)与[更新前保存](APP-UPDATES.md#领域接入)。
- 模型接口按需配置；本地同源代理必须[显式启用](local-agent-gateway.md)。

构建产物缺失、缓存或持久化问题见[部署排查](DEPLOYMENT.md#常见问题)和[更新与恢复](APP-UPDATES.md)。
