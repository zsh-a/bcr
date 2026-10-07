# Work 创作约定

- 先阅读 `docs/brief.md`、`work.json`、`content.json`、`data.json` 与 `sources.json`。
- 内容、数据、来源和画面分开维护；用稳定语义 ID 关联段落、字幕与场景。
- `src/` 放画面与本期模型；`public/` 放可公开的运行素材。动画由 Remotion 帧号驱动。
- 新工程有 main（16:9）、cover（16:9）、cover-4x3（4:3）三个目标。封面按比例重新排版；简介在 `docs/platform-description.md`。
- 通用制作命令为 `bcr-work`，环境、缓存与交付沿用工作区规范。共有制作实现位于 BCR 仓库 `packages/work-engine`，本期不再复制一套工具脚本。
- 修改口播后更新草稿或重新执行 audio；实际语音与强制对齐决定正式时序，不把估算时序用于交付。
- TTS 按完整语义段落生成，字幕仅控制显示；保留自然呼吸，不添加逐字幕停顿或拉伸旁白。
- 参考声音必须已确认可使用。`public/audio/reference.wav` 与 `.bcr/narration/` 为私有制作源，必须保留并从公开包排除。
- `bun run format` 统一格式与导入，`bun run lint` 和 `bun run typecheck` 验证代码。业务验证按本期模型和主张补充。
- 新视频使用 AV1，优先 NVENC；短样片、全片、自动检查与人工听审观看分别记录。
- 交付使用独立暂存目录与 release，保留已有交付的文件身份。
