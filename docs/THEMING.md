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
