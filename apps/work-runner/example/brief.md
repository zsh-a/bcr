# 年卡，去多少次才划算？

60 秒竖屏示例。先展示价格，再增加到访次数，最后揭示临界点。
网页和动画共享 data.json 与 model.js。所有价格均为自设假设。

源文件可以由任意 Coding Agent 编辑。先读取 work.json、数据和 reviews.json（若存在）。
用 Runner inspect 获取版本，再 capture 查看关键帧；用 render 的 from/to 生成短预览。
修改后保留目标 ID。已发布产物对应任务中的 source revision，不随源码变化。

使用已安装的 `bcr-runner`，可在任意目录运行 `bcr-runner inspect gym-card --json`。
直接 MCP 使用者先读取 `runner_catalog`，再通过 `runner_read` 返回的 `directory` 找到作品目录。
渲染返回任务 ID，通过 `runner_job` 查询进度，使用 `runner_output(image: true)` 检查 PNG 关键帧。
Remotion 动画由 useCurrentFrame 驱动，禁止使用实时日期和不带种子的随机数决定画面。
