# Work 工程

从[当前状态](docs/STATUS.md)接续，使用`bcr-work context ID --task TASK`取得本轮读取范围；工程ID和目标见[work.json](work.json)。

| 需要维护的内容 | 位置 |
| --- | --- |
| 受众、问题与边界 | [创作要求](docs/brief.md) |
| 正式文稿、教学数据与来源 | [content.json](content.json)、[data.json](data.json)、[sources.json](sources.json) |
| 表现、模型与公开素材 | `src/`、`public/` |
| 声音参数与私有制作源 | [voice.json](voice.json)、`media/` |
| 简介与章节 | [平台简介](docs/platform-description.md) |
| 制作路径、派生与验收 | [production.json](production.json)、`.bcr/build/`、`.bcr/reports/` |

先完善文稿、模型和画面，`draft`更新估算时序并预览；已有实测时序时不覆盖它。正式旁白用`audio`生成并对齐，检查实际视听后再导出与`release`。具体命令见`bcr-work --help`，共享环境和缓存沿用工作区规范。

初始画面和文稿是占位，时间轴为草稿。默认不加配乐，`score.flac`为禁用配乐的零音轨；声音阈值按本期验收。原始语音、对齐和参考素材单独私有备份。阅读稿用`bcr-work transcript ID`派生，历史修订归入`docs/history/`，不另维护一份当前正文。
