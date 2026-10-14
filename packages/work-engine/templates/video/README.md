# Work 工程

此工程由 `bcr-work init` 创建。工程 ID 见 `work.json`；下文的 `ID` 替换为该值。

1. 阅读 `docs/brief.md`，在 `content.json` 写口播段落与字幕，在 `data.json`、`sources.json` 维护数据和出处。
2. `bcr-work draft ID` 更新估算时序，`bcr-work preview ID` 查看草稿。修改画面在 `src/`，字体和图片在 `public/`。
3. 将已确认可使用的参考声音放入 `media/voice/reference.wav`，在 `voice.json` 填写 `referenceTranscript`。TTS 与强制对齐使用 audio.cpp 原生服务；本机连接及模型身份在 `~/.config/bcr/audio-cpp.json` 配置，可用 `AUDIO_CPP_PROFILE` 或 `AUDIO_CPP_ENDPOINT` 覆盖。
4. `bcr-work audio ID` 按完整语义段落生成旁白，再做强制对齐、采样点拼接、连续母带和验收。共用工作区音频环境，无需为每期复制脚本、模型或 Python 环境。
5. `bcr-work check ID`，然后导出代表性短段并听审、观看，再导出全片。默认 GPU AV1；封面使用 `capture --target cover` 与 `capture --target cover-4x3`。
6. 将验收后的成片、报告、封面和简介放入独立暂存目录，使用 `bcr-work release ID --from-dir DIR`。

```sh
bun run typecheck
bun run lint
bun run format
bun run preview
bun run audio:build
bun run check
```

初始时间轴明确标记 `draft`，无配音也能预览和捕获画面。草稿检查只确认结构、类型与代码规范，不代表音频验收；正式导出会拒绝草稿。配音完成后时长由实测音轨更新。已有实测时间轴时 `draft` 会拒绝覆盖；明确回到草稿使用 `draft --force`，原始声音文件仍保留。

`voice.json` 中的响度、字幕阅读和停顿阈值是可调整的初始制作参数，须按本期内容验收。默认不添加背景音乐；`score.flac` 是明确禁用配乐的零音轨。原始语音与对齐在 `media/narration/generated/`，个人参考声音属于私有素材，统一打包和预览会排除。备份工程时单独保留这些制作源文件。

工具与缓存规范见工作区 `../README.md`。这里不复制其他作品的台词、Logo、参考声音或发布记录。

日常 Python 环境仅含采样点处理与验收依赖。旧作品 Python 对齐使用 `bcr-work env --legacy` 的独立环境；模型转换使用 `bcr-work env --models`，不影响日常制作环境。

派生时序统一位于 .bcr/build/runtime，动作声明在 cues.json；音频完成后与预览/导出前由共享引擎检查和编译。通过 plan 查看阶段，配置验收脚本后使用 qa / freeze；私有制作源通过 backup 保存，恢复只写新目录。
