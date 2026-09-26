# 外观主题

全产品共用一套视觉令牌与控件原语，位于 `packages/react/src`：

- `tokens.css`：唯一事实来源。色彩、间距、圆角、字号、布局高度、动效时长与缓动。
- `global.css`：全局基座（body、`:focus-visible`、滚动条、选区、减少动态效果兜底）。
- `theme.css`：Tailwind 桥接（`@theme inline` 把令牌映射为 `bg-bg`、`rounded-md`、`text-sm` 等工具类），并引入上面两层。
- `ui.css` / `ui.tsx`：全产品唯一的控件套件。`Button`、`IconButton`、`Input`、`Textarea`、`Select`、`Dialog`、`Badge`、`Kbd`、`SectionLabel`、`PanelEmpty`、`StatusDot`、`ProgressBar`、`Spinner`、`Skeleton` 及格式化函数。`.ui-*` 类名公开，原生元素可直接复用（如 `.ui-dialog`、`.ui-popover`、`.ui-btn`）。

Tailwind 界面引入 `@bcr/react/theme.css`；手写 CSS 的界面引入 `@bcr/react/tokens.css` + `@bcr/react/global.css`（需要控件类时再引 `ui.css`）。

## 尺度

| 维度 | 取值                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 间距 | `--space-1..8`：4 / 8 / 12 / 16 / 20 / 24 / 32 / 40px                                                                                            |
| 圆角 | `--radius-sm` 8px（控件）/ `--radius-md` 12px（卡片）/ `--radius-lg` 16px（对话框、面板）/ `--radius-full`（胶囊）                               |
| 字号 | `--text-xs` 11px / `--text-sm` 12px / `--text-base` 14px / `--text-lg` 16px / `--text-xl` 20px / `--text-2xl` 26px（含 `--text-*--line-height`） |
| 字体 | `--font-sans`（IBM Plex Sans）/ `--font-mono` / `--font-display`（Newsreader Variable，仅标题与字标）                                            |
| 布局 | `--h-topbar` 56px / `--h-toolbar` 48px / `--h-control` 36px / `--h-control-lg` 44px / `--w-sidebar` 280px / `--content-max` 960px                |
| 动效 | `--duration-fast` 120ms（反馈）/ `--duration-base` 180ms（浮层、菜单）/ `--duration-slow` 260ms（面板、位移）/ `--ease-standard`                 |
| 层级 | 仅 `--shadow-floating` 与 `--shadow-dialog` 两档阴影                                                                                             |

圆角、间距、字号、动效一律使用令牌；允许的字面量只有 1px 发丝线、`100%`/`auto` 与内容几何（画布、PDF、分页排版内部）。

## 交互语言

- hover 只改变颜色/边框/底色，不位移、不缩放、不发光。
- 焦点只有全局一种：`2px solid var(--color-focus)`，`outline-offset: 2px`（`global.css`）；禁止局部覆盖与 `outline: none`。
- 加载只有 `Spinner`、`Skeleton` 与短状态文案三种表达；`StatusDot` 是静态圆点。
- 浮层（对话框、弹出层、菜单、面板）必须有进场与退场过渡，统一使用 `ui.css` 的 `@starting-style` + `allow-discrete` 模式。
- 饰色禁令：装饰性径向辉光、扫描线、网格纹理、微抬升 hover、脉冲发光点一律不使用。

## 响应式

### 语义断点

三档断点是唯一事实来源（`tokens.css` 的 `--bp-*`，em、内容驱动；浏览器默认 16px 根字号下等效 640/720/1100px）。媒体/容器条件无法消费 `var()`，各处一律经 `theme(--bp-*)` 在构建期取值（`@theme inline` 桥接，见 `tokens.css` 文末）。**禁止字面视口断点**：`@media` 条件只能引用 `theme(--bp-*)`，不得写 `max-width: 900px` 之类字面量。

| 断点      | 取值    | 等效（16px 根） | 语义                             |
| --------- | ------- | --------------- | -------------------------------- |
| `--bp-sm` | 40em    | 640px           | 形态级：弹层成 sheet、极窄排版   |
| `--bp-md` | 45em    | 720px           | 布局级：多栏 → 单栏 + 覆盖式抽屉 |
| `--bp-lg` | 68.75em | 1100px          | 列数级：第二列（常驻右栏）出现   |

另有领域形态阈值 `--bp-reader-landscape` 53.75em（860px）：阅读器横屏形态专用，宿主让位顶栏与阅读器内部横屏布局共用同一取值，防止两侧断点失配（横屏下顶栏回来会挤掉阅读视口）。

三态形态：侧栏宽度连续过渡（260ms，跨断点不跳变）→ ≤`--bp-md` 变覆盖式抽屉（位移 + 淡入淡出，压暗层随行，**覆盖正文而非挤开内容**）；右栏 ↔ 标题下折叠段在 `--bp-lg` 交叉淡入淡出（120ms，`allow-discrete`）；/studio 侧列在 ≤`--bp-md` 收进「面板」抽屉。矮窗（height < 500px）对话框一律升为全屏 sheet，顶栏允许换行而非溢出。

### 流体令牌

- 展示级字号连续过渡，不设台阶：`--text-xl` / `--text-2xl` 为 `clamp()`；kb-doc 标题另以 `5cqi` 参与 clamp 中值。
- 布局宽度流体化：`--w-sidebar` clamp(240px, 22vw, 300px) / `--w-rail` clamp(200px, 18vw, 260px) / `--content-max` min(960px, 100%)。
- 浮层高度预算：`--h-overlay-max`（dvh 计量并扣安全区），弹层/对话框最大高度一律取它；矮窗内重定义为全屏高度。
- 安全区一律 `max(var(--space-*), env(safe-area-inset-*))` 兜底，移动端 chrome（标题栏、底部导航、抽屉、浮标）同此。

### 容器查询约定

内部降级随**容器**而非视口：新组件必须容器化（`container: <name> / inline-size` + `@container <name> <阈值>`），禁止用视口媒体查询表达组件内部降级。具名容器阈值是各自容器的局部契约，改动需同步下表与 `scripts/verify-responsive.mjs`：

| 容器         | 元素                                 | 阈值   | 降级                                                    |
| ------------ | ------------------------------------ | ------ | ------------------------------------------------------- |
| `kb-side`    | `.knowledge-sidebar`                 | <220px | 卡片只留标题 + 相对时间（预览与标签隐藏）               |
| `kb-main`    | `.knowledge-main`                    | <640px | 工具条按钮 icon-only、状态文案隐藏、视图模式收进 ⋯ 菜单 |
| `kb-doc`     | `.knowledge-document`                | <560px | 标题字号随容器收窄、meta 行换行                         |
| `kb-rail`    | `.knowledge-context`                 | <180px | 小节计数隐藏、大纲缩进减半                              |
| `dock-panel` | `.studio-dock .dv-content-container` | <420px | 面板按钮 icon-only                                      |
| `ui-body`    | `.ui-dialog-body`                    | <400px | 表单 label 上置堆叠（单选/复选行除外）                  |

icon-only 的实现约定：裸文本随 `font-size: 0` 归零，svg 与显式字号元素不受影响；浮层菜单保持可读。kb-main<640 时「编辑/阅读/源码」仅存在于 ⋯ 菜单，菜单内视图模式必须始终可达。

### WCAG 320 基线

- 1.4.10 Reflow：320×256 等效视口（1280×1024 的 400% 缩放）下知识库、/studio、home 及对话框/抽屉打开态均不得出现双向滚动（`documentElement.scrollWidth ≤ innerWidth + 1`，顶栏同理）；表格/画布等豁免区域必须自含滚动。
- 400% 缩放等效（320px 视口 + 根字号 64px）下核心功能（新建笔记、搜索、视图模式切换）必须可达且文本不溢出。
- 焦点/浮标不遮挡：文档列底部留 ≥64px 避让区（`.knowledge-content` 的 `padding-bottom` + `scroll-padding-block`），粘性条与浮标不压住跳转落点。
- `prefers-reduced-motion: reduce` 下形态过渡直达终端（`global.css` 兜底至 0.01ms，不做退场动画）。

## 主题与领域色

Studio 顶栏提供「跟随系统 / 浅色 / 深色」。默认跟随系统，选择保存在 `bcr/theme`，同源标签页同步；存储不可用时仍可切换但提示不能保存。主题不进入知识库导出或 Git 同步。深色为默认（石墨灰），浅色为柔和灰白；两套色值独立校验对比度，不简单反色。`apps/studio/index.html` 在样式与模块加载前恢复外观，避免首屏闪烁。

领域界面（市场、量化、漫画、文档、数据、DocGen、媒体）与 Studio、知识库、AI 助手使用同一套 chrome 令牌。领域个性不再来自独立色板；仅**数据语义色**保留（涨跌、图表系列），映射到 `--color-success` / `--color-danger` / `--color-info` / `--color-amber`。

例外：**阅读/画布内容主题**是内容而非 chrome——Reader 的阅读主题（默认青绿与 paper / night / sage）以局部变量限定在阅读根元素上（`[data-read-theme="paper|night|sage"]`，默认主题不带标记），漫画页画布底色同理限定在页画布元素上，不影响周边界面。

## 自定义背景

顶栏主题选择旁的图片按钮打开「工作区背景」面板（原生 Popover，`.ui-popover` 样式）。支持本地 JPG、PNG、WebP（最大 10 MB、4000 万像素），缩放到最长边 1920px 重新编码，持久化 Data URL 不超过 150 万字符，存于 `localStorage` 的 `bcr/background`，同源标签页同步。不请求远程 URL、不上传、不进入知识库同步或导出；原始文件不保留，临时 Blob URL 及时释放。

背景用于主页与知识库底层，遮罩 40%–90% 可调，松开滑块或键盘调节完成时保存。「恢复默认背景」只删除背景偏好。

## 验证项目

- `apps/studio/tests/theme.test.ts`：偏好状态、存储异常，以及两套主题文字／状态色与四级背景遮罩的对比度。
- `apps/studio/tests/background.test.ts` 与 `scripts/verify-background.mjs`：图片校验、压缩、保存恢复、异常保护、遮罩与移动端布局。
- `scripts/verify-theme.mjs`：真实 Chromium 中验证系统跟随、刷新恢复、跨标签页、保存失败、知识库与助手、手机与横屏。
- `scripts/verify-shell-architecture.mjs`：领域懒加载不覆盖宿主主题。
- `scripts/verify-responsive.mjs`：响应式 7 组断言——320px reflow（含对话框/抽屉打开态）、400% 缩放等效、连续拉伸三态切换、容器降级（kb-side/kb-rail/kb-main/dock-panel/ui-body，含 ⋯ 内视图模式可达）、矮窗全屏 sheet 与安全区 max() 兜底、reduced-motion 直达终端、「继续对话」浮标避让（桌面内容列与移动端导航/FAB）。
