# BCR 共享制作引擎

`@bcr/work-engine` 是 CLI 与 Runner 共用的制作后端。实现位于 BCR 仓库，作品源码留在独立工作区。`src/cli.ts` 负责同步命令分派，`src/execute.ts` 适配 Runner 的不可变快照和持久任务。实现按职责组织：

| 路径 | 职责 |
| --- | --- |
| `src/cli/` | 参数、帮助、工程诊断与状态展示 |
| `src/project.ts` | Work/制作/工作区配置、目标与素材策略 |
| `src/lib/` | 文件身份、安全路径、原子 JSON 写入与子进程 |
| `src/state/` | SQLite、可恢复资源租约、缓存索引 |
| `src/init.ts`、`templates/video/` | 标准工程创建、失败回滚与可编辑模板 |
| `src/audio.ts`、`src/audio/` | 阶段依赖、标准口播、草稿时序、母带 |
| `audio/scripts/` | 共用强制对齐、采样点拼接与音频验收 |
| `src/video/` | 打包、浏览器、Player、捕获、AV1 与媒体记录 |
| `src/release.ts` | 逐文件验证的交付与 current 切换 |
| `src/maintenance/` | 缓存预算、旧 Runner 整理、历史基线 |

`core.ts`、`render.ts`、`maintenance.ts` 只保留统一导出，方便命令与检查引用。浏览器 Player 在 `src/video/player.tsx` 中检查类型，生成入口只导入组件和序列化参数，不再维护一整行嵌入式程序。

```sh
# 在 BCR 仓库根目录
bun run format:work
bun run check:work
bun run test:runner:engine
```

Biome 2.5.15 与 Ruff 0.16.10 均锁定版本。采用两空格 TS/JSON、四空格 Python、100 字符行宽，自动整理导入；控制流使用花括号，每条声明只有一个变量。JSON 读取默认返回 unknown，业务模块声明配置与报告类型，避免 any 向后续逻辑传播。Remotion 的尺寸字段仍兼容 HTML 目标，进入媒体链路后按目标参数验证。

`bun run check` 执行 Biome/Ruff、TypeScript、管理工具行为测试和 Python 音频链路测试。音频测试使用明确标记的合成波形，不调用 TTS 或对齐模型，不作为真实口播的听感或强制对齐质量证据。工具修改后还应捕获真实画面或导出短片，检查文件、缓存与私有素材策略。

新的标准工程采用共享音频实现；已有作品仍执行各期的音频脚本，保持本期模型、声线、配乐与阈值。新模板默认禁用配乐，不自行生成或引入其他作品的音乐。原始语音、强制对齐与历史交付不是可清理缓存。

## 数据与兼容

BCR 根 `bun.lock` 是 JS 工具的唯一依赖锁，Python 使用 `audio/uv.lock`。各期保留自己的特殊依赖锁。`bcr-work --root DIR`、当前工作区和 Runner 配置决定作品根目录，工具不再根据安装位置推断工程路径。旧工作区 `.tools` 可以作为兼容链接，指向此包；新模板使用 `bcr-work` 和本期的 Biome，不依赖该链接。

共享缓存和制作索引沿用既有 XDG 位置，保证音频、交付记录及运行锁连续。Runner 原有状态目录、sourceId、任务、版本和审阅不重建。迁移基线属于作品工作区，保存在 `.bcr/migrations/`，不放入工具源码。

频道角色和动作在独立的 `yige-youshu-studio` 仓库维护；通用标量轨道、插值和加权混合在 BCR 的 `packages/animation-core`。消费 Work 可通过 `file:vendor/名称-版本.tgz` 固定小型运行时包，源码快照会保存归档。引擎检查路径、拒绝目录依赖和符号链接，将归档哈希纳入依赖及画面身份，并复制到冻结安装环境；`overrides` 中的本地归档也遵循同一规则。包归档是制作输入，渲染缓存仍按统一预算回收。

Runner 直接执行校验过的源码快照。依赖环境按锁文件复用，Rspack 构建和 PNG 帧按目标输入身份复用；缓存预算覆盖 CLI 与 Runner。预览仅保存小型播放器文件，从不可变快照按白名单读取素材；不依赖可回收的构建缓存。
