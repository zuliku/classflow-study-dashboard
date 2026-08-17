# Kiro UI Spec — ClassFlow 自然语言工作区

> Kiro 是 **ClassFlow 的自然语言工作区**，不是「ClassFlow 里的聊天机器人」。
> 本文件是后续 AI Tasks（Provider / Agent Runtime / Context / Sidecar / Files）的 **UI contract**。
> 产品与竞品研究已定稿，本文件不重复研究内容，只记录已确定的设计决策。

## 1. 定位与边界

- Kiro 是一级 Workspace（`NavTab` 成员），不是 Modal / Drawer / Floating Window。
- Kiro 未来能力：理解课程、任务、课表、DDL、小组项目、课程资料；按上下文回答；直接执行 ClassFlow 操作。
- Task 0 只做 UI Shell / placeholder / mock。**禁止**伪造成功结果（如「Kiro 已修改任务」）。
- 没有独立 AI 配色：Kiro 使用 ClassFlow 现有 Design System，与其余 Workspace 完全一致。
- 没有显式 Ask / Plan / Act Mode；没有 Floating AI Bubble。UI 只有一个 Kiro。

## 2. 导航

### Desktop Sidebar（≥1280px）

```
总览 / 我的课表 / 任务与 DDL / 课程资料
              Kiro          ← 轻微间距（mt-2）形成层次，无独立 Section Header
学习统计 / 小组协作
──────────────
设置（Global Action）
```

- Active 状态与其他 Workspace 一致：`bg-pastel-mint` + charcoal + 左侧指示条。
- Kiro 图标集中在 `components/layout/navItems.ts` 的 `KIRO_ICON`（当前为 Lucide `Sparkles`），
  正式 Logo 落地后只替换一处，所有入口自动生效。

### Tablet Icon Rail（768–1279px）

- 单色 Icon + hover/focus tooltip（文本「Kiro」），无特殊 AI tooltip 设计。

### Mobile Bottom Nav（<768px）

```
总览 / 课表 / 任务 / Kiro / 更多
```

- `BOTTOM_NAV_MAIN`：overview / timetable / assignments / kiro。
- `BOTTOM_NAV_MORE`：courses / analytics / group / settings。
- `MORE_TAB_IDS`：courses / analytics / group（settings 是 action，不高亮）。

### Header

- Mobile Header 自动显示当前页名「Kiro」（由 `WORKSPACE_NAV_ITEMS` 驱动）。
- Desktop / Tablet Header 不重写：greeting / Cmd+K 搜索 / 日期与周控件全部保留。

### Command Center

- 只有「前往 Kiro」导航命令（由 `NAV_GROUPS` 自动生成）。
- 本阶段无「交给 Kiro」handoff 命令。

## 3. Workspace 结构

```
components/kiro/
  KiroWorkspace.tsx      布局编排（Header + Empty/Conversation + Composer + History）
  KiroHeader.tsx         Kiro mark + 名称 + 新对话 / 历史（+ KiroMark 导出）
  KiroEmptyState.tsx     主要完成状态 + 本地确定性 suggestions
  KiroConversation.tsx   max-w-820px 居中文档流，内部滚动
  KiroMessage.tsx        KiroMessage（文档流，非气泡）+ KiroUserMessage（soft bubble）
  KiroComposer.tsx       textarea / + / @ / 模型占位 / 发送
  KiroContextBar.tsx     自动 + 手动 Context chips（collapsed / expanded）
  KiroContextPicker.tsx  @ 选择器（读 Store 实体名称，纯 UI）
  KiroHistoryPanel.tsx   Workspace 内 panel（Desktop 右侧 280px / Mobile 底部 sheet）
  KiroActivityTrace.tsx  Agent 活动轨迹视觉组件（mock props）
  KiroActionCard.tsx     Action Result 语义卡片（ddl / schedule / create 变体）
```

### Workspace Header

- 左侧：Kiro mark + 「Kiro」+ 低权重标签「AI Workspace」（仅 sm+）。
- 右侧：新对话 / 历史（icon + 短文本，tooltip）。
- 不显示 Provider / API Key / token / temperature 等技术信息。

### Empty State

- 标题：`今天想先处理什么？`；辅助文本最多一行。
- Suggestions 由本地确定性判断切换（courses / assignments / schedules 是否为空）：
  - 有数据：安排今天的任务 / 查看最近 DDL / 分析本周学习负担 / 制定复习计划。
  - 无数据：上传资料开始学习 / 帮我规划学习 / 添加学习任务 / 了解 Kiro 能做什么。
- 点击 suggestion = 发送一条本地 preview message（Task 0 行为）。

### Conversation

- `max-width: 820px` 居中；不要写死成纯 Text Bubble List。
- 未来必须能承载：长回答、cards、tool traces、files、context chips。

### Message

- KiroMessage：Kiro mark + 正常文档流 + 结构化内容区（children），不做左右对话气泡。
- KiroUserMessage：右对齐轻量 soft bubble（`bg-alabaster` + `border-line`）。

### Composer

- rounded-2xl / surface / line-strong 边框 / 克制 shadow；不用 ChatGPT 纯黑白复制。
- multiline textarea，auto grow，最大约 156px；Enter 发送、Shift+Enter 换行；empty 时 Send disabled。
- `+` 附件菜单：上传文件 / 选择课程资料 / 添加图片（只做菜单 UI，不读取文件）。
- `@` Context Picker：分类预留 课程 / 任务 / 课表时间范围 / 小组项目 / 课程资料；从 Store 读实体名称。
- Model selector：显示「选择模型」，点击为静态占位「AI 服务将在后续阶段配置」；不伪装已连接。
- 底部一行免责声明：当前为界面预览，未接入 AI 服务。
- 移动端：+ / @ / 发送触控目标 ≥ 44px（`w-11 h-11 md:w-9 md:h-9`）。

### Context UX（自动 + 手动）

- 自动 Context：当前选中实体（`selectedAssignmentId` / `selectedCourseId` → 当前任务 / 当前课程）。
- 手动 Context：`@` 选择加入，chip 可移除。
- Collapsed：`◎ 使用 N 项 ClassFlow 上下文`；Expanded：chips 行。
- 策略：Small Base Context + Agent 按需 Read Tools。本组件只展示，不构造 Prompt。

### History

- 不进 Global Sidebar（避免 Sidebar in Sidebar）。
- Desktop：右侧 280px 次级 panel（shadow-card + border-l）；Mobile：底部 sheet。
- mock：Recent / 标题 / 时间；支持 New Chat / select / rename / delete 占位。
- Task 0 不持久化；Esc / 遮罩关闭。

### Activity Trace / Action Card

- `KiroActivityTrace`：collapsed（`✓ 完成 N 项操作` / `● Kiro 正在处理 · n / N`）与 expanded（逐项状态）。
  禁止 JSON / tool args / 内部工具名 / token 细节。Task 0 仅 mock props。
- `KiroActionCard`：ddl / schedule / create 三种 variant 的语义卡片 API；Task 0 组件化，不在默认流中展示。

## 4. 响应式与未来 Sidecar

- Workspace 高度：`h-[calc(100dvh-130px)] md:h-[calc(100dvh-96px)]`，Conversation 内部滚动，Composer 常驻底部（移动端自动位于 BottomNav 上方，键盘弹出时 100dvh 收缩可用）。
- 未来 Sidecar（不在本 Task）：
  - ≥1536px：docked right sidecar ≈ 400px，主页 reflow；
  - 1280–1535px：right overlay sidecar（避免把 Timetable 压窄）；
  - 768–1279px：overlay side sheet；
  - <768px：full-screen Kiro。
- Conversation / Composer 组件不依赖固定页面宽度，可直接复用。

## 5. 视觉与 Motion

- 严格使用现有 token：surface / line / line-strong / pastel-mint / sandrift / satin-grey / charcoal / alabaster。
- 禁止：`--ai-purple`、渐变 AI 边框、glow、glassmorphism、大面积彩色背景。
- Motion：复用 `--motion-fast/base/panel/page` + `--ease-standard/emphasized`；
  History panel 用 panel motion，Context picker / Composer menu 用 inline motion，页面用现有 PageTransition。
- Agent 状态只做克制 status dot / opacity，不做 bounce / 彩虹旋转 / 过度 pulsing。
- 必须支持 Reduced Motion（现有 `prefers-reduced-motion` 与 `html[data-motion]` 全局兜底）。

## 6. Content Density

- Kiro 响应 density：History row / Context picker row / Activity trace row（compact 时减少纵向 padding）。
- 不缩小：Composer、Send 按钮触控目标、移动端控件。

## 7. Accessibility

- 键盘：Tab 顺序清晰、可见 focus（沿用全局 focus-visible 环）、Esc 关闭 History / Picker / 菜单。
- Enter 发送 / Shift+Enter 换行；textarea 有 aria-label；菜单使用 role="menu"；Send disabled 语义。
- 移动端触控目标 ≥ 44px；safe-area（BottomNav 已有 env 处理）。
- Kiro 导航与 Sidebar / BottomNav 现有 a11y 行为一致（aria-current / aria-label / tooltip role）。

## 8. 品牌

- UI 内固定使用「Kiro」；如需完整外部标签：「Kiro · ClassFlow」。
- 不出现「AWS Kiro」或任何对外部 Kiro 产品的视觉引用。
- Kiro 是 ClassFlow 的一部分，不是嵌入的第三方 Widget。

## 9. 明确留到下一个 Task

- Provider / API 配置（未来进 Settings）。
- Agent Runtime / Tool Calling / 真实对话。
- 聊天持久化。
- Command Center「交给 Kiro」handoff。
- Entity 页面 Ask Kiro（Sidecar 正式实现）。
- 附件真实上传 / 文件解析。
