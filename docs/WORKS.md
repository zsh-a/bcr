# Works：通用作品控制面

Works 是 BCR 的通用作品控制面。它不保存源码，也不提供浏览器内代码编辑器；源码、数据、素材、依赖和创作规范属于独立的 Work 工程。Codex、Claude Code 或其他 Agent 在工程目录中修改源码，Runner 负责构建、预览、渲染和产物管理，Works 负责连接、审阅、版本选择和交付。

## 唯一身份

每个作品由以下身份组成：

```text
sourceId + workId + sourceRevision + targetId
```

- `sourceId`：Runner 实例的稳定身份。
- `workId`：工程 `work.json` 中的作品 ID。
- `sourceRevision`：Runner 根据源码快照计算的 SHA-256 revision。
- `targetId`：工程中的一个输出目标，例如 `vertical`、`cover` 或 `page`。

Works 只展示当前连接 Runner 的 Work。切换 Runner 会切换可见列表；作品链接必须重新连接原来的 Runner 才能读取。

## 目录边界

```text
Codex / Claude Code
        │ 修改源码、运行类型检查、读取反馈
        ▼
Work 工程目录
        │ work.json / data / model / scenes / assets
        ▼
Runner
        │ snapshot / validate / preview / capture / render
        ▼
Works
        │ 播放、批注、版本比较、接受、交付
        ▼
固定产物
```

Works 的浏览器页面可以关闭，Runner 任务仍然继续。Works 不执行 Work 源码；只有 Runner 在明确授权的工程根目录中执行构建和渲染。

## 工程契约

最小工程包含一个 `work.json`：

```json
{
  "format": "bcr-project-1",
  "id": "my-work",
  "title": "我的作品",
  "defaultTarget": "vertical",
  "targets": [
    {
      "id": "vertical",
      "runtime": "remotion",
      "entry": "Scene.tsx",
      "width": 1080,
      "height": 1920,
      "fps": 30,
      "durationInFrames": 1800,
      "propsFile": "data.json"
    }
  ]
}
```

`defaultTarget` 只决定制作工作台首次打开的目标；同一工程仍可在目标选择器中切换页面、视频或其他适配器。

建议同时提供：

```text
AGENTS.md       Agent 工程规则和验证命令
brief.md        受众、主题、叙事和验收要求
data.json       参数快照
model.ts        纯计算模型
src/scenes/     场景
src/components/ 共用视觉组件
public/         字体、音频和图片
```

新工程可以直接使用 Runner 的通用 starter：

```bash
bcr-runner create ~/bcr-projects/my-work --id my-work --title "我的作品"
```

它生成一个同时包含 `page` 和 `vertical` 目标的普通代码工程，可以脱离 BCR 仓库
独立使用。

工程可以包含 HTML 和 Remotion 多个目标。它们都是目标适配器，不要求 BCR 内置页面模板。

## Works 页面

Works 只有两种主要状态：

- **审阅**：选择提交稿、播放视频或关键帧、定位反馈、比较版本、确认反馈和固定交付。
- **制作**：选择目标、调节声明参数、启动预览、查看任务和导出产物。

制作页面只显示源码快照、目标元数据和参数面板。源码编辑由 Agent 或用户的代码编辑器完成；参数保存仍然通过 Runner 的 revision CAS 写入工程的 `propsFile`。

页面、图表和视频都通过同一套审阅流程处理。目标先声明自己的审阅表面：HTML 是 `page`，Remotion 是 `timeline`。反馈定位使用带 `kind` 的联合结构：

```json
{ "kind": "page", "page": { "path": "index.html", "viewport": { "width": 1280, "height": 800 } } }
{ "kind": "timeline", "frame": 360, "endFrame": 420, "point": { "x": 0.5, "y": 0.4 } }
{ "kind": "artifact", "output": "job/video.mp4" }
```

这样页面状态不会误读成视频帧，视频也不需要伪造页面字段；固定视口截图仍然通过页面定位中的 `viewId` 关联。Runner 负责目标适配器，Works 只依赖目标表面和统一的审阅定位。

## Runner 操作

CLI、HTTP 和 STDIO MCP 共用同一个操作契约：

```text
runner_catalog
runner_list
runner_read
runner_file
runner_snapshot
runner_versions
runner_checkpoint
runner_diff
runner_restore
runner_parameters
runner_render
runner_jobs
runner_job
runner_output
runner_preview
runner_review_read
runner_review_edit
```

典型流程：

```bash
bcr-runner inspect <work-id> --json
bcr-runner validate <work-id> --target vertical --json
bcr-runner capture <work-id> --target vertical --frames 0,30,120 --json
bcr-runner render <work-id> --target vertical --profile draft --from 0 --to 449 --json
bcr-runner render <work-id> --target vertical --profile final --json
```

长任务立即返回任务 ID。Agent 轮询 `runner_job`，用 `runner_output` 读取 diagnostics 或图片；Works 只展示这些不可变产物。

## Agent 创作流程

1. Agent 调用 `runner_catalog`、`runner_list`、`runner_read`。
2. Agent 读取 `AGENTS.md`、`brief.md`、`work.json` 和模型文件。
3. Agent 修改工程源码，不修改 BCR 仓库。
4. Agent 调用 `runner_validate` 和 `runner_capture`，检查代表帧。
5. Agent 渲染短预览并根据实际画面修正。
6. 用户在 Works 中提交带 `sourceRevision` 的审阅反馈。
7. Agent 调用 `runner_review_read`，修改对应场景，重新渲染，并用 `addresses` 提交新稿。
8. 用户明确接受反馈并固定交付清单。

反馈、源码、产物和交付拥有不同的 revision。渲染成功不会自动接受反馈，也不会自动交付。

## 版本与归档

Runner 保存源码快照、命名检查点和任务产物；Work 工程自身建议使用 Git 保存完整历史。渲染任务锁定源码 revision、目标、帧范围、质量、图形后端、依赖和 Runner 身份。

源码归档通过 Runner 的 `archive` 目标生成，包含工程文件和 `bcr-snapshot.json`，不包含可变的任务队列。交付清单保存产物哈希、任务身份、目标和源码 revision，因此后续修改不会改变已经交付的文件。

## 外部 Agent

代码创作使用 Runner 的直接 STDIO MCP：

```bash
bcr-runner mcp --config ~/.config/bcr/work-runner.json
```

Bridge 只用于连接已经打开的 BCR 浏览器工作区中的资料和知识能力。不要通过 Bridge 创建代码 Work，也不要把 BCR 源码目录作为创作目录。详细说明见[外部 Agent](EXTERNAL-AGENTS.md)和[视频创作](VIDEO-AUTHORING.md)。
