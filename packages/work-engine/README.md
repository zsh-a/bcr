# BCR 共享制作引擎

`@bcr/work-engine` 是独立的命令行视频制作工具。实现位于 BCR 仓库，作品源码留在独立工作区。`src/cli.ts` 负责同步命令分派，画面检查采用关键帧截图、代表短片和最终成片；自动QA与Player导出按需使用内部浏览器会话。实现按职责组织：

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
| `src/maintenance/` | 缓存预算、索引与历史基线 |

`core.ts`、`render.ts`、`maintenance.ts` 只保留统一导出，供命令与检查引用。浏览器 Player 在 `src/video/player.tsx` 中检查类型，生成入口只导入组件和序列化参数，不再维护一整行嵌入式程序。

```sh
# 在 BCR 仓库根目录
bun run format:work
bun run check:work
bun run build:work
bun run test:work:release
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
| `bcr-work env --models` | `audio/.venv-models` | Torch、Safetensors，离线模型转换 |

所有作品的生成与对齐统一使用 audio.cpp，只同步日常环境。`audio.driver=scripted` 为含多版本与定制配乐的工程保留拼接、配乐、母带及验收脚本，`voiceover.ts` 仅向共享 `generateNarration` 提供本期段落与节目顺序。已确认的原始录音通过 `voice.generation.recordedSource` 校验并直接复用，改稿只生成受影响段落。`env` 返回实际 Python 路径，不在作品内创建环境链接。锁定依赖中的重模型包不等于日常环境已安装或加载它们。

## 环境与存储

BCR 根 `bun.lock` 锁定引擎开发依赖，独立发行包保存运行依赖锁，Python 使用 `audio/uv.lock`。Works 管理脚本和各期特殊依赖分别保留自己的锁文件。`bcr-work --root DIR`或当前目录中的工作区清单决定工程根目录，工具不再根据安装位置推断工程路径。Studio 的 `mise run setup` 安装固定引擎、CLI 与 `@bcr/work-engine` SDK；业务脚本按包名导入公开接口。新模板使用 `bcr-work` 和本期的 Biome。

共享缓存和制作索引沿用既有 XDG 位置，保证音频、交付记录及运行锁连续。历史迁移证据归档到本机独立 evidence 目录并纳入加密备份，不参与当前制作检查。

频道角色和动作在独立的 `yige-youshu-studio` 仓库维护；通用标量轨道、插值和加权混合在 BCR 的 `packages/animation-core`。消费 Work 可通过 `file:vendor/名称-版本.tgz` 固定小型运行时包，源码快照会保存归档。引擎检查路径、拒绝目录依赖和符号链接，将归档哈希纳入依赖及画面身份，并复制到冻结安装环境；`overrides` 中的本地归档也遵循同一规则。包归档是制作输入，渲染缓存仍按统一预算回收。

命令行捕获与导出使用校验过的源码快照。依赖环境按锁文件复用，Rspack构建及帧缓存共享输入身份、租约和预算；产物保存实际输入与媒体校验记录。


## 制作计划、快照与存储

公开入口为包根导出与 bcr-work CLI。Work 只保留内容、表现、声明和业务检查，不导入 src 或 node_modules 内部路径。业务脚本从 `@bcr/work-engine` 导入公开SDK；标准制作流程使用CLI。

Agent 接续从 `bcr-work context PROJECT --task resume` 开始；明确任务后传 `review|write|model|audio|visual|cover|chapters|deliver`，可加 `--target ID`。命令输出紧凑 JSON，包含当前阶段、时序来源、限长 STATUS 摘要和带大小/选择范围的读取清单；只读本地元数据，不启动音频服务、浏览器或制作任务。先读 required 中与修改相关的字段，再按问题查询 onDemand，避免整份创作历史与数据重复进入上下文。配置与目标关键字段已经在交接中，修改配置时才需重新读原文件。

STATUS 摘要优先保留当前、下一步、恢复入口和尾部；`text` 中明确标记缺口，`fragments` 给出源行号、源字符区间及摘要中的字符区间，`includedCharacters/omittedCharacters/truncated` 如实说明覆盖范围。状态与 required 文件附 SHA256，供接续核对输入。封面交接直接包含限长 `copy.title/subtitle`；`--segment ID` 仅返回 `content.paragraphs[].id` 对应的完整语义段，找不到或超出上限明确报错，不截断段落。回归审稿的 `readingRequirement` 仍要求通读，局部片段不能替代完整论证核查。`actions` 提供可直接执行的 argv 数组与 cwd；仅为建议，不会自动执行，草稿章节有明确 blocker。

`review PROJECT --kind script|pilot|visual|listening --status passed|needs-work --note TEXT --evidence REL --reviewer NAME` 只登记已经发生的检查。检查人必填，`--reviewer-type` 默认为 agent；人工听审需明确声明 human，记录始终标注来源由调用者声明、未独立核实，不执行或冒充人工观看听审。`--scope sample|full` 区分抽样与全片，script 默认 full，其他默认 sample，pilot 只能 sample。证据必须是项目内真实文件，记录保存当前目标 input.key、相关输入身份、证据 SHA256、说明和时间，写入 `.bcr/reviews/` 的唯一文件且不可覆盖。context/plan 分别汇总各类检查的 missing/fresh/stale/needs-work；script 依据文稿、brief、来源和模型等创作输入判断，后续 TTS 或时序变化不使它过期；音画类依据所审目标或音频相关输入及证据判断。fresh 只表示登记仍匹配当前输入，抽样不代表全片，人工声明不等于独立核验；现有技术 QA、freeze/release 门槛与发布授权保持独立。

`context --task model` 额外输出有界数据摘要，保留小型 parameters/exact/simulation/checks；记录数组仅列 recordCount、omittedRecords 与序列化字节数，深层对象、长字符串、编码载荷和超限字段均显式标记省略。摘要不是原数据的替代品，核查具体值仍应按 JSON 路径查询或运行本期模型检查。`docs/STATUS.md` 保存当前范围、待办与验收边界；完整分镜和人工连续听审观看仍决定作品是否完成。

- prepare 编译 production.runtime 指定的 cues、字幕和视觉事件；audio 完成后自动运行，预览/导出前检查依赖。
- scenes.json 显式声明镜头入口、动作依赖、共享组件和交接。render 自动使用共享 FFV1/RGB 镜头缓存，最终合成全局进度、连续旁白并统一编码 AV1。缩放预览沿用整帧渲染路径。
- plan 按 `--target` 展示依赖、stage、timing.mode（draft/measured/missing）、阻塞项与技术新鲜度；fresh 只指依赖身份，不证明成片镜头已实现或人工验收完成。无音轨且不引用派生时序的单帧目标不要求主片配音/prepare，打包、预览、快照与导出使用同一依赖判定；main 保留正式声音与时序要求。完整审计与计算依赖身份分开，独立命令、音轨或无关引擎维护代码不使正文镜头缓存失效。
- qa 使用不可变源码快照启动独立预览，身份接口绑定实际所验版本。报告按输入与运行 ID 保存；freeze 和 release 拒绝过期报告。
- source snapshot policy 统一使用制作声明：私有 media 与实验原始资料不进源码快照，已声明的构建时间轴和编译证明随快照保存，外部快照也必须通过已有输入和输出的身份验证。
- Work与实验目标由readProjectDefinition统一加载。
- 参考声音通过 voice.referenceFile 配置；production.audio.directory 放原始录音、生成记录、对齐与制作源，不纳入缓存预算。计划使用相对素材路径。
- backup 根据 storage 收集制作源、报告、实验和交付，使用内容对象去重并实际恢复验证。与音频、验收和 release 操作串行，restore 只写新目录。

工作区storageId固定索引身份，目录变化后仍可定位缓存和制作记录。

## Player 捕获与阅读稿

Work 在 `production.targets.ID.renderer` 配置 `player`，同一 `render` 命令改用不可变 Player 预览逐帧捕获。它继续使用共享输入身份、AV1 编码、媒体验证、租约和预算缓存，不在 Work 内维护逐帧目录。未配置时沿用既有帧或镜头渲染；Player 目标必须提供独立母带。

业务 QA 从包根导入 `connectReviewPage`、`seekReviewFrame`，使用共享 qa 提供的 `BCR_QA_URL`、`BCR_QA_INPUT`、`BCR_QA_OUTPUT`。语言设置会影响 SVG 字形，预览、QA 与捕获保留同一 zh-CN 文档环境。`transcript PROJECT` 从正式 content.json 生成 `.bcr/build/text/narration.md`，避免维护第二份正文。

## 独立发行

`bun run build:work`将单一`bcr-work`入口、SDK、模板、Python工具和锁打包到`dist/work-engine/package`。`release.json.files`记录完整载荷SHA-256，build绑定文件表。CLI与SDK直接共用包内同一份固定源码，由锁定的Bun运行。Studio通过`mise run engine:pin`安装并固定版本；`mise run setup`恢复CLI和公开SDK。

业务QA从SDK导入`connectReviewPage`和`seekReviewFrame`，通过`BCR_QA_URL/BCR_QA_INPUT/BCR_QA_OUTPUT`取得输入绑定的临时浏览器与输出目录；任务完成后自动关闭。人工检查直接查看实际PNG与MP4。
