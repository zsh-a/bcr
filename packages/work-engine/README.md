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
| `audio/scripts/` | 采样点拼接、音频验收、私有备份与模型转换 |
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

标准音频工程统一通过 audio.cpp 原生 `/v1/tasks/run` 完成 TTS 和强制对齐。未使用标准驱动的历史原型继续执行各期脚本。采样点拼接、响度校准与验收仍由 FFmpeg 和共享 Python 工具执行，标准链路不再加载 Python TTS 或对齐模型。新模板默认禁用配乐。原始语音、强制对齐与历史交付不是可清理缓存。

## audio.cpp 原生服务

先准备 audio.cpp 原生 Safetensors/GGUF 模型并启动 `audiocpp_server`。使用本机服务时，参考声音路径必须与服务共享文件系统；声音与情绪参考继续作为私有制作源保存。服务建议按需加载，并设置 `max_loaded_models: 1` 以限制显存驻留。IndexTTS 2.5 使用 `index_tts2` 家族，转换后的 `config.yaml` 必须声明 `version: "2.5"`。

统一连接配置为 `~/.config/bcr/audio-cpp.json`，也可通过 `AUDIO_CPP_PROFILE` 指定。它记录 `endpoint`、`runtimeRevision`、`configurationRevision`、`alignmentModel` 和 `models`；每个模型的 `revision` 应来自实际权重及配置的内容哈希。`AUDIO_CPP_ENDPOINT` 可覆盖连接地址。服务二进制、加载配置或模型包改变后同步更新身份，避免复用旧生成结果。

Work 的 `voice.json` 指定 `backend: "audio.cpp"` 和服务中的模型 ID。已配置的模型可按需切换，例如 `Qwen3-TTS-12Hz-1.7B-Base`、`IndexTTS-2.5` 或 `Fish-S2-Pro`。新工程默认 Qwen Base 声音克隆和固定种子；旧标准工程未声明 backend 时使用统一服务配置，不再读取其历史 Gradio 地址。

```json
{
  "backend": "audio.cpp",
  "endpoint": "http://127.0.0.1:8089",
  "model": "IndexTTS-2.5",
  "generation": {
    "emotionReference": ".bcr/voice/emotion-question.wav",
    "options": { "seed": 42, "emotion_alpha": 0.35, "duration_scale": 1.1 },
    "paragraphs": {
      "opening": { "options": { "emotion_alpha": 0.5 } }
    }
  },
  "alignment": { "model": "Qwen3-ForcedAligner-0.6B" }
}
```

保留原有 `referenceTranscript`、`language`、母带与质量配置。`generation.paragraphs` 可按语义 ID 覆盖情绪音频和生成参数；Fish 可用 `text` 填写含表达标签的完整段落，正文及字幕仍来自 `content.json`。选择新模型时同时核对它支持的参数，不沿用其他模型的专属选项。

缓存身份包括实际正文、带标签的生成文本、参考声音与情绪参考哈希、模型身份、原生运行版本和生成设置。原始 WAV 与 `.generation.json` 一起保存；对齐会验证完整文本覆盖，把原生采样点换成既有秒级时间戳格式。更换对齐版本时，先保留历史记录，再原子写入新对齐。音频来源改变后仍需重新拼接与验收，不能沿用旧时序。

Fish 官方检查点的原生转换可使用 `audio/scripts/prepare-fish-audiocpp.py --source CHECKPOINT --output NATIVE_DIR`，保持原始精度并折叠 codec 的 weight normalization。先运行 `bcr-work env --models`，再使用 `audio/.venv-models/bin/python` 执行转换。Index 使用 audio.cpp 自带的 `convert_index_tts2_5.py --native-dir` 转换工具；服务运行时直接由原生二进制推理。

Python 使用同一份 `audio/uv.lock`，按用途安装到独立环境：

| 命令 | 环境 | 用途 |
| --- | --- | --- |
| `bcr-work env` | `audio/.venv` | NumPy、SoundFile，拼接、母带与音频验收 |
| `bcr-work env --legacy` | `audio/.venv-legacy` | 仍使用 Python 对齐的旧作品 |
| `bcr-work env --models` | `audio/.venv-models` | Torch、Safetensors，离线模型转换 |

标准 audio.cpp 流程只同步日常环境。旧驱动自动选择 legacy 环境；早期作品的 `.bcr/audio-env` 链接指向该环境。锁定依赖中的重模型包不等于日常环境已安装或加载它们。

## 数据与兼容

BCR 根 `bun.lock` 是 JS 工具的唯一依赖锁，Python 使用 `audio/uv.lock`。各期保留自己的特殊依赖锁。`bcr-work --root DIR`、当前工作区和 Runner 配置决定作品根目录，工具不再根据安装位置推断工程路径。旧工作区 `.tools` 可以作为兼容链接，指向此包；新模板使用 `bcr-work` 和本期的 Biome，不依赖该链接。

共享缓存和制作索引沿用既有 XDG 位置，保证音频、交付记录及运行锁连续。Runner 原有状态目录、sourceId、任务、版本和审阅不重建。迁移基线属于作品工作区，保存在 `.bcr/migrations/`，不放入工具源码。

频道角色和动作在独立的 `yige-youshu-studio` 仓库维护；通用标量轨道、插值和加权混合在 BCR 的 `packages/animation-core`。消费 Work 可通过 `file:vendor/名称-版本.tgz` 固定小型运行时包，源码快照会保存归档。引擎检查路径、拒绝目录依赖和符号链接，将归档哈希纳入依赖及画面身份，并复制到冻结安装环境；`overrides` 中的本地归档也遵循同一规则。包归档是制作输入，渲染缓存仍按统一预算回收。

Runner 直接执行校验过的源码快照。依赖环境按锁文件复用，Rspack 构建和 PNG 帧按目标输入身份复用；缓存预算覆盖 CLI 与 Runner。预览仅保存小型播放器文件，从不可变快照按白名单读取素材；不依赖可回收的构建缓存。


## 制作计划、快照与存储

公开入口为包根导出与 bcr-work CLI。Work 只保留内容、表现、声明和业务检查，不导入 src 或 node_modules 内部路径。工作区链接 .tools 可作为 SDK 包入口；新模板的标准流程只需要 CLI。

- prepare 编译 production.runtime 指定的 cues、字幕和视觉事件；audio 完成后自动运行，预览/导出前检查依赖。
- scenes.json 显式声明镜头入口、动作依赖、共享组件和交接。render 自动使用共享 FFV1/RGB 镜头缓存，最终合成全局进度、连续旁白并统一编码 AV1。缩放预览沿用整帧渲染路径。
- plan 展示各音频阶段、时序与验收新鲜度、镜头依赖和缓存。完整审计与计算依赖身份分开，独立命令、音轨或无关引擎维护代码不使正文镜头缓存失效。
- qa 使用不可变源码快照启动独立预览，身份接口绑定实际所验版本。报告按输入与运行 ID 保存；freeze 和 release 拒绝过期报告。
- source snapshot policy 对 Runner 使用同一声明：私有 media 与实验原始资料不进源码快照，已声明的构建时间轴和编译证明随快照保存，外部快照也必须通过已有输入和输出的身份验证。
- Work 与实验目标由 readProjectDefinition 共用加载；Runner 从已经捕获的文件集合解析，CLI 从工作目录解析，目标清单保持一致。
- 参考声音通过 voice.referenceFile 配置；production.audio.directory 放原始录音、生成记录、对齐与制作源，不纳入缓存预算。新计划使用相对素材路径；旧配置保留兼容。
- backup 根据 storage 收集制作源、报告、实验和交付，使用内容对象去重并实际恢复验证。与音频、验收和 release 操作串行，restore 只写新目录。

工作区 storageId 可固定原有索引身份，后续目录变化不再改变 CLI 缓存与管理索引。旧历史的源定位保留原记录，Runner 的连接目录仍按其显式绑定规则管理。

## Player 捕获与阅读稿

Work 在 `production.targets.ID.renderer` 配置 `player`，同一 `render` 命令改用不可变 Player 预览逐帧捕获。它继续使用共享输入身份、AV1 编码、媒体验证、租约和预算缓存，不在 Work 内维护逐帧目录。未配置时沿用既有帧或镜头渲染；Player 目标必须提供独立母带。

业务 QA 从包根导入 `connectReviewPage`、`seekReviewFrame`，使用共享 qa 提供的 `BCR_QA_URL`、`BCR_QA_INPUT`、`BCR_QA_OUTPUT`。语言设置会影响 SVG 字形，预览、QA 与捕获保留同一 zh-CN 文档环境。`transcript PROJECT` 从正式 content.json 生成 `.bcr/build/text/narration.md`，避免维护第二份正文。
