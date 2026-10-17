# Work 创作约定

- 接续先运行 `bcr-work context 工程ID --task resume`；明确任务后使用 `write|review|model|audio|visual|cover|chapters|deliver` 和需要的 `--target` 获取限长交接。按 `reads.required` 的选择范围读取，`onDemand` 只在当前问题需要时查询；不要默认读取完整历史、原始数据或共享引擎源码。
- `docs/STATUS.md` 保存当前范围、已验收证据、未完成项和下一步；讨论转入制作时先更新这份精简交接。历史过程留在独立记录，不重复写入当前入口。
- `model` 交接保留小型参数、理论值、模拟汇总与检查结果，原始数组只列数量与显式省略标记；具体记录由程序按路径查询。模型、结构或类型检查通过不代表正式镜头已实现，仍以本期状态和分镜为准。
- 内容、数据、来源和画面分开维护；用稳定语义 ID 关联段落、字幕与场景。
- `src/` 放画面与本期模型；`public/` 放可公开的运行素材。动画由 Remotion 帧号驱动。
- 新工程有 main（16:9）、cover（16:9）、cover-4x3（4:3）三个目标。封面按比例重新排版；简介在 `docs/platform-description.md`。
- 通用制作命令为 `bcr-work`，环境、缓存与交付沿用工作区规范。共有制作实现位于 BCR 仓库 `packages/work-engine`，本期不再复制一套工具脚本。
- 修改口播后更新草稿或重新执行 audio；实际语音与强制对齐决定正式时序，不把估算时序用于交付。
- TTS 按完整语义段落生成，字幕仅控制显示；保留自然呼吸，不添加逐字幕停顿或拉伸旁白。
- 参考声音必须已确认可使用。`media/voice/` 与 `media/narration/` 为私有制作源，必须保留并从公开包排除。
- `bun run format` 统一格式与导入，`bun run lint` 和 `bun run typecheck` 验证代码。业务验证按本期模型和主张补充。
- 新视频使用 AV1，优先 NVENC；短样片、全片、自动检查与人工听审观看分别记录。
- 交付使用独立暂存目录与 release，保留已有交付的文件身份。

派生时序统一位于 .bcr/build/runtime，动作声明在 cues.json；音频完成后与相关预览/导出前由共享引擎检查和编译。通过 `plan --target ID` 查看该目标的阶段、草稿/实测时序、阻塞项与技术依赖；静态封面不要求无关配音。配置验收脚本后使用 qa / freeze；私有制作源通过 backup 保存，恢复只写新目录。
