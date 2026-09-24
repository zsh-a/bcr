# 外观主题

Studio 顶栏提供「跟随系统 / 浅色 / 深色」。默认跟随系统，选择保存在当前浏览器的 `bcr/theme` 中；同源标签页同步偏好。存储不可用时仍可切换，但会提示不能保存。主题不进入知识库导出或 Git 同步。

## 设计与职责

- `packages/react/src/theme.css`：共享中性色阶、青绿色强调色与语义变量。深色采用石墨灰，浅色采用柔和灰白；两套色值分别校验，不简单反色。
- `apps/studio/index.html`：在样式与模块加载前恢复外观，减少首屏主题闪烁；不依赖 React 或工作区启动。
- `apps/studio/src/theme/store.ts`：偏好校验、系统主题解析、持久化失败反馈。
- `apps/studio/src/theme/browser.ts`：DOM 应用、系统变化与跨标签页事件；热更新时清理监听。
- `ThemePicker.tsx`：原生选择菜单，键盘可操作，手机端保留 44px 触控区域。

主按钮使用 `primary / on-primary` 配对，不借用页面背景作为文字色。焦点、选中、成功、警告、危险状态使用独立语义变量；遮罩与浮层阴影按主题变化。普通文字及需要阅读的辅助文字以至少 4.5:1 为校验目标，禁用控件不作为正文使用。

## 应用范围

本轮统一 Studio 导航、知识库、AI 助手与使用共享变量的界面（含 Media Studio）。市场、量化、漫画、文档、数据及 DocGen 等自带领域色板的界面仍保留专属设计；深色领域显式声明 `color-scheme: dark`，防止全局浅色使原生控件与领域背景混搭。Reader 阅读主题继续由阅读设置管理。后续迁移领域主题时应同时检查图表、预览画布和状态色，不通过全局反色覆盖。

## 自定义背景

顶栏主题选择旁的图片按钮打开「工作区背景」面板。支持本地 JPG、PNG、WebP（最大 10 MB、4000 万像素），选择后自动保存；不请求远程图片 URL，不上传、不进入知识库同步或导出。

图片检查文件头后在浏览器中缩放到最长边 1920px 并重新编码，持久化图像 Data URL 不超过 150 万字符。设置独立存储在 `localStorage` 的 `bcr/background`，刷新和离线可用，同源标签页同步。原始文件不保存，临时 Blob URL 在处理结束后释放。存储满或权限被拒绝时会明确提示，保留原背景；清理网站数据会移除这项偏好。

背景用于主页与知识库底层，遮罩可在 40%–90% 间调整，松开滑块或完成键盘调节时保存，避免拖动期间反复写入图片。正文、助手、导航和弹窗保留主题底色；领域专属预览画布不叠加背景。「恢复默认背景」仅删除背景偏好，不修改原始图片、笔记或主题选择。

设置面板采用原生 Popover，支持 Escape 和点击外部关闭；支持 [CSS 锚点定位](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/position-anchor) 的浏览器贴近入口展示，窄屏约束在视口内。

## 验证项目

- `apps/studio/tests/theme.test.ts`：偏好状态、存储异常，以及两套主题文字／状态色与四级背景的对比度。
- `scripts/verify-theme.mjs`：真实 Chromium 中验证系统跟随、刷新恢复、跨标签页、保存失败、知识库与助手、手机和横屏；已加入浏览器 CI。
- `scripts/verify-shell-architecture.mjs`：领域懒加载不覆盖宿主主题。
- `apps/studio/tests/background.test.ts` 与 `scripts/verify-background.mjs`：图片与设置校验、压缩、保存与恢复、异常保护、遮罩和移动端布局。
