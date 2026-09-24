# 知识库分记录存储与增量搜索投影

本阶段完成应用层分记录持久化、运行时原子批量 KV 写入，以及全局搜索的增量投影更新。独立回收站尚未实施。

## 职责与格式

- `KnowledgeStore` 继续负责保存队列、草稿保护、审批计划、三方合并与历史；领域状态仍为 `KnowledgeState` 版本 1/2。
- `KnowledgePersistence` 负责本地格式解码、迁移、分记录差异写入与损坏检测，不改变 GitHub / ZIP / Agent 的内容格式。
- `RuntimeMetadata.batch` 是可选的原子逻辑写入能力。SQLite 实现用同步 SQL 事务写入或删除多条 KV，再通过既有持久化队列等待一次快照落盘。

新布局以 `workspace/knowledge.v1` 保存 `bcr-knowledge-records` 版本 3 清单，其中有提交标识、领域状态版本、记录 ID 列表和同步控制信息。正文不再内嵌在清单里。记录位于 `workspace/knowledge.records/` 下：

| 前缀                                     | 内容                 |
| ---------------------------------------- | -------------------- |
| `notes/`、`collections/`                 | 当前笔记与集合       |
| `history/`                               | 按修订 ID 保存的历史 |
| `conflicts/`                             | 当前冲突快照         |
| `base/notes/`、`base/collections/`       | 同步基线             |
| `pending/notes/`、`pending/collections/` | 待确认同步内容       |

一次修改只将与上次成功读取/提交不同的记录交给批量写入；不再引用的记录与清单在同一事务删除/更新，避免不断累积孤立版本。历史仍沿用全库 100 条上限，不是回收站。测试覆盖单篇修改只写当前笔记、新历史与清单，不重写其他笔记。

## 迁移与失败恢复

打开旧格式时只读取，不迁移。支持 `batch` 的运行时在首次实际写入时，将原始聚合状态保存为 `workspace/knowledge.before-records.v1`，再写分记录内容和版本 3 清单；备份和迁移属于同一批次。已有迁移备份不会覆盖。全新空库没有旧聚合数据时，不生成这个备份。

不支持 `batch` 的旧适配器继续使用原有聚合格式；若读取到已迁移数据则拒绝加载，不能降级覆盖。旧客户端无法解码版本 3 清单，因此不会静默忽略新记录布局继续写入。所有设备宜使用新版客户端，但 Git 同步传输格式并未因此升级。

记录缺失、身份不一致、无效清单、非法 JSON、超出容量或读取期间提交标识变化，都会停止加载，不以空库代替、不自动删除或修复数据。已知过期的 Store 在写入前也会被拒绝。

SQL 语句失败时整批回滚。SQL 成功后，若底层快照落盘回执失败，结果视为**不确定**：内存数据库可能已包含整批变更，但应用 Store 不先发布成功，下次操作通过保存屏障重读、合并或重新预览。不能为了回滚某个领域而撤销其他领域在此期间的新写入。底层快照的原子性仍依赖 BinaryStore 的既有实现。

应用仍由运行时的项目租约保证单写入者，同一运行时只有一个工作区 Store。清单比较用于检测已知过期状态，不是跨进程 compare-and-swap；自定义适配器需要提供同等的单写入者约束。

迁移备份只在当前浏览器存储中，没有独立恢复按钮；清理网站数据也会删除它。建议升级前通过「导出知识库」保存外部 ZIP。Git 和 ZIP 不包含本机迁移快照、搜索投影或修订历史。

## 增量搜索

知识库插件拥有一个 `createKnowledgePublisher` 实例。首次加载或显式重建时，从正文完整替换知识库来源，清除过期持久化投影；之后按笔记正文、标题、标签、更新时间、路径及集合名称计算变化。

`SearchIndex.patchSource` 一次更新受影响的分块、删除失效分块，只发送一次观察者通知，不允许删除或覆盖其他来源的文档。未变化的文档保留索引对象和标准化文本缓存。全文缩短、删除笔记、集合改名及移动路径均有回归测试。

搜索索引仍是可丢弃、可重建的派生数据，不拥有正文；重启后持久化投影在知识库重新发布前仍标记为未验证。不支持增量接口的搜索适配器回退为完整替换。

## 明确边界

- **底层仍导出完整 SQLite 数据库快照**，并非 OPFS 原位页写入，不能据此宣称磁盘写放大已经解决。
- Store 仍在内存持有完整领域状态，保存仍做全量验证、记录序列化和比较；没有惰性读取正文或增量 schema 校验。
- 仍保留 32 MiB 本机知识库容量保护；Git/ZIP 的传输限制不变。迁移备份会额外占用本地空间。
- 增量能力针对**全局搜索投影更新**，查询仍使用已有关键词评分逻辑，不是 SQLite FTS、倒排检索或向量检索。侧栏与 Agent 的领域检索仍使用原有共享排序。
- 尚未提供独立回收站、回收站保留期、后台压缩或恢复点管理 UI。

## 验证

```sh
bun run test apps/studio/tests/knowledge-persistence.test.ts apps/studio/tests/knowledge-search-publisher.test.ts
bun run test packages/storage-sqlite/tests/sqlite.test.ts packages/core/tests/search.test.ts
BASE_URL=http://127.0.0.1:5199 node scripts/verify-knowledge.mjs
BASE_URL=http://127.0.0.1:5199 node scripts/verify-knowledge-paths.mjs
BASE_URL=http://127.0.0.1:5199 node scripts/verify-knowledge-restore.mjs
BASE_URL=http://127.0.0.1:5199 node scripts/verify-global-search.mjs
```

下一步：独立回收站，明确删除、恢复、路径冲突与 Git 同步语义，再推进属性和附件。
