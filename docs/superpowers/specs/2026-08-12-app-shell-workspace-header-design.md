# ClassFlow App Shell & Workspace Header Design

**Date:** 2026-08-12  
**Status:** Approved for implementation planning  
**Scope:** UI Productization Task 1  
**Product direction:** Linear 的结构秩序 + Notion Calendar 的低噪声视觉

## 1. Goal

将 ClassFlow 当前“全局问候 Header + 各页面自行构造 Page Header/Banner”的结构，收敛为统一、稳定、低噪声的 Workspace Shell。

本任务只解决：

> ClassFlow 每个 Workspace 的顶部由谁负责、展示什么、页面主操作放在哪里。

不改变核心业务结构，不重画页面主体，不做全站 Design System 重构。

## 2. Current Problem

当前 `components/layout/Header.tsx` 在桌面/平板主要展示：

- 问候语；
- 用户名；
- 全局搜索；
- 当前周日期范围。

真正的 Workspace 名称只在移动端 Header 出现。

与此同时：

- Courses 在 `app/page.tsx` 内建立独立 Header Card；
- Analytics 在 `app/page.tsx` 内建立独立 Banner Card；
- Tasks 的 `AssignmentTable mode="workspace"` 同时承担页面标题、主创建动作、筛选、搜索、View Tabs 与任务列表；
- Timeline 自己拥有完整 Header Controls；
- Group 自己拥有 Header Banner；
- Kiro 自己拥有 Thread Header。

结果是：切换 Workspace 时，页面顶部的信息层级、Surface、Primary Action 位置持续变化，削弱产品统一感。

## 3. Product Principle

新的 Shell 遵循：

> Sidebar 决定“我在哪里”；Workspace Header 说明“当前在做什么”；Workspace Body 只负责业务内容。

视觉方向：

- 结构秩序参考 Linear；
- 视觉克制参考 Notion Calendar；
- 保留 ClassFlow 暖灰、低饱和、学习场景气质；
- 不照搬具体品牌视觉；
- Header 不做 Card；
- Shadow 不用于表达普通页面层级。

## 4. Chosen Architecture

采用 **Integrated Workspace Header primitive + workspace-owned composition**。

```text
ClassFlow App Shell
│
├── Sidebar / Icon Rail / Bottom Nav
│
└── Workspace
    ├── Workspace Header
    │   ├── Identity
    │   │   ├── Title
    │   │   └── Context / Meta
    │   └── Actions
    │       ├── Context Actions
    │       ├── Primary Action
    │       └── Global Search
    │
    └── Workspace Body
```

关键实现约束：

- `WorkspaceHeader` 是统一 primitive；
- **不建立中央 Header registry / Context slot store**；
- 每个 Workspace 的 owner 负责把自己的 Context/Action 传给 `WorkspaceHeader`；
- `app/page.tsx` 中直接定义的 Workspace（Overview / Courses / Analytics / Kiro）由 `app/page.tsx` 组合 Header；
- Timeline / Group 因为 Header action 依赖组件内临时状态，由各自组件直接组合 Header；
- Tasks 新增一个轻量 `AssignmentsWorkspace` wrapper，负责 Workspace Header 与 Quick Add open state；`AssignmentTable` 继续负责表格/筛选本身。

不采用：

1. “保留现有 Global Header + 再增加 Page Header”——会形成两层甚至三层 Chrome；
2. “所有页面通过 Context/Registry 动态注册 Header Slot”——当前收益不足，会引入不必要的生命周期与状态同步复杂度；
3. “为了 Header action 新增 Zustand persisted/transient registry 或 CustomEvent”——Task 1 不为视觉迁移制造新的跨组件控制通道。

## 5. Workspace Header Contract

新增通用 `WorkspaceHeader`，建议接口：

```ts
interface WorkspaceHeaderProps {
  title: React.ReactNode;
  context?: React.ReactNode;
  primaryAction?: React.ReactNode;
  actions?: React.ReactNode;
  hideSearch?: boolean;
  sticky?: boolean;
  className?: string;
}
```

约束：

- 不增加 `variant="tasks" | "courses" | ...`；
- 页面业务 Context 由页面自身计算后传入；
- Layout Layer 不依赖所有业务 Domain；
- `navItems.ts` 继续只负责导航 id/label/icon/section；
- 不建立巨大 Workspace 配置 Registry；
- `className` 只用于布局对齐（例如 Kiro full-bleed），不承担 feature variant。

## 6. Workspace Search

全局搜索继续是全局动作，并继续打开现有 Command Center。

建议拆出：

```text
components/layout/WorkspaceSearchButton.tsx
```

行为不变：

- 打开 palette；
- Cmd/Ctrl+K 行为不变；
- Command Registry 不改。

视觉变化：

- Desktop：文本 + 快捷键提示；
- Tablet：文本或紧凑入口；
- Mobile：图标入口；
- 去除持续性 `shadow-subtle`；
- 保持低噪声 Secondary/Ghost 层级。

## 7. Header Visual Rules

建议视觉规则：

```text
Desktop height      56–64px
Tablet height       ~56px
Mobile height       52–56px
Title               16–18px / semibold
Context             11–12px / muted
Primary action      h-8
Icon action         32×32
Bottom divider      1px
Persistent shadow   none
```

Header 属于页面结构，而不是内容 Card。

Sticky：

```text
Workspace Header → sticky top-0
```

使用不透明背景 + subtle bottom border，不引入强 Glass/Blur。

## 8. Global Greeting

现有“早上好/下午好/晚上好，用户名”不再作为所有 Workspace 的主标题。

规则：

```text
Greeting ≠ App Header Title
```

Greeting 仅允许作为 Overview 的轻量 Context 或 Overview Body 内容。

推荐 Overview Header：

```text
总览
第 N 周 · M月D日–M月D日
```

问候语不是 Task 1 必须保留的信息；若保留，应降级为 Overview-only secondary copy。

## 9. Date Context Ownership

当前周日期范围不再被视为 Global Header 信息。

改为按 Workspace 分配：

- Overview：`第 N 周 · 日期范围`；
- Timeline：`第 N 周 · 日期范围`；
- Tasks：不默认显示完整周日期；
- Courses：`N 门课程 · X 学分`；
- Analytics：`本学期 · 第 N 周`；
- Group：`N 个项目`；
- Kiro：不显示学期日期。

这样不再需要“Timeline 特殊隐藏 Global Date Pill”的例外。

## 10. Workspace Mapping

| Workspace | Title | Context | Header Primary Action | Local/Secondary Controls |
|---|---|---|---|---|
| Overview | 总览 | 第 N 周 · 日期范围 | 无 | Global Search |
| Timeline | 时间表 | 第 N 周 · 日期范围 | 无 | 周切换、今天、Filter、`+` Quick Create、Ask Kiro、More |
| Tasks | 任务与 DDL | `N 项未完成` | 新增任务 | Ask Kiro / contextual breakdown 可进 Header actions；View/Search/Filter/More 留 Workspace 内部 |
| Courses | 课程资料 | N 门课程 · X 学分 | 添加课程 | 本任务不新增 Sort/View |
| Analytics | 学习统计 | 本学期 · 第 N 周 | 无 | 后续 Productization 再设计范围/指标控制 |
| Group | 小组协作 | N 个项目 | 新建项目 | Ask Kiro 作为 Header secondary；项目内部动作留内容区 |
| Kiro | Kiro | 无 | 无 | Thread Header 继续显示对话标题/Share/More |

### Timeline special rule

Timeline 的 `+` **不迁移到 Workspace Header**。

原因：它与 `quickOpen / filterOpen / moreOpen` 等 Timeline-local popover 状态紧密耦合。它继续是 Local Control Bar 内唯一 filled/primary create control，但全站 Header primary slot 对 Timeline 为空。

这样避免同一个 `+` 在 Header 与 Timeline Toolbar 中重复。

## 11. Button Hierarchy

Task 1 固定 Workspace 顶层操作语法：

```text
Header Primary
→ 每个 Workspace 最多 1 个

Secondary / Ghost
→ 当前页面高频辅助操作

Local Primary
→ 允许极少数高度上下文化的局部 Workspace（Timeline）保留 1 个

Overflow
→ 低频操作

Command Center
→ 全局效率入口
```

Header Primary 映射：

- Tasks：新增任务；
- Courses：添加课程；
- Group：新建项目；
- Timeline：无（Quick Create 留 Local Toolbar）；
- Overview：无；
- Analytics：无；
- Kiro：无。

以下低频操作不提升为 Header Primary：

- 导入课表；
- 设置；
- 归档；
- 全屏；
- 低频批量操作。

## 12. Page Migration Rules

### 12.1 Overview

- 使用统一 `WorkspaceHeader`；
- Header context 显示当前学期周/日期；
- First Run Getting Started 与 Dashboard 内容不在本任务中重设计；
- 不做 Card flattening。

### 12.2 Timeline

Timeline 保持“双层语义”：

```text
Workspace Header
时间表 · 第 N 周 / 日期

Timeline Local Control Bar
‹ › 今天 | Filter | + | Ask Kiro | ···

Timeline Body
```

要求：

- `TimelineWorkspace` 直接组合 `WorkspaceHeader`，因此不需要把 local action 状态提升到 Store/parent；
- 从原内部 Header Controls 移除重复的“第 N 周 + 日期”身份信息；
- 周导航按钮与今天继续保留在 local control bar；
- Filter / Quick Create / Ask Kiro / More 行为不变；
- 不改 Key Lane、TimetableGrid、StudyBlock、Unscheduled Shelf 视觉/业务；
- 不重做 Timeline outer surface，除非为消除 Header duplication/高度冲突所需的最小布局调整；
- Timeline 当前依赖 viewport 高度计算，迁移后必须重新验证 1440/1024 下不出现双滚动或底部被截断。

### 12.3 Tasks

新增：

```text
components/assignment/AssignmentsWorkspace.tsx
```

职责：

- 组合 `WorkspaceHeader`；
- 计算 `N 项未完成`；
- 提供 Header Primary “新增任务”；
- 提供现有 Ask Kiro / 高亮任务 breakdown contextual action；
- 持有 Workspace Quick Add 的 open/close state；
- 渲染 `AssignmentTable mode="workspace"`。

`AssignmentTable` 增加最小 controlled props，例如：

```ts
interface AssignmentTableProps {
  mode?: "compact" | "workspace";
  workspaceQuickAddOpen?: boolean;
  onWorkspaceQuickAddOpenChange?: (open: boolean) => void;
}
```

Workspace 模式：

- 不再渲染“任务与 DDL”页面标题；
- 不再渲染 workspace Primary “新增任务”；
- QuickAddCard 仍然在 AssignmentTable 内部渲染，从而继续使用内部 `courseFilter` 作为 `defaultCourseId`；
- QuickAdd open state 使用 wrapper 传入的 controlled state；
- Filters / Search / View Tabs / Risk / More / Selection / Peek / Context Menu / List 保持原逻辑。

Compact 模式：

- **保持当前 `任务清单` 标题、count、逾期提示、compact 新增按钮与分页行为不变**；
- Overview 的 `AssignmentTable mode="compact"` 不依赖 `AssignmentsWorkspace`。

不新增 Quick Add CustomEvent，不把 Quick Add 状态写入 Zustand。

### 12.4 Courses

删除当前顶部课程 Banner Card：

```text
本学期课程
点击课程卡片查看资料
添加课程
```

改为统一 Header：

```text
课程资料
N 门课程 · X 学分                 + 添加课程
```

Task 1 不改 Course Card 本身，不处理“查看资料”重复 affordance；该项留后续 Courses Productization。

### 12.5 Analytics

删除当前顶部 Analytics Banner Card。

改为统一 Header：

```text
学习统计
本学期 · 第 N 周
```

Task 1 不改：

- Metric cards；
- Pie/Bar 图；
- StudyLoadChart；
- chart tooltip；
- 空状态视觉。

### 12.6 Group

`GroupCollaborationView` 直接组合统一 `WorkspaceHeader`，因为 `openCreateProject` 与 project form state 属于组件本地临时状态。

目标：

```text
小组协作
N 个项目                   Ask Kiro   + 新建项目
```

要求：

- 删除当前 Group Header Banner Card；
- Primary 直接调用现有 `openCreateProject`；
- Ask Kiro 保持现有 `activeProject` 条件与 handoff 行为；
- 不把 `projectForm` / form fields 提升到 Zustand；
- 不增加 Global UI Event；
- 本任务不迁移 GroupModal/Input/Button primitives。

### 12.7 Kiro

Kiro 是明确例外，保留两级 Header：

```text
Workspace Header
Kiro

Thread Header
当前对话标题                       Share / More
```

要求：

- `app/page.tsx` 在 Kiro Workspace 外层组合 `WorkspaceHeader title="Kiro"`；
- 不把 `KiroHeader` 的 Thread title 改成“Kiro”；
- Kiro Workspace Header 允许用 `className` 对齐 full-bleed body gutter；
- Kiro full-bleed body/padding 语义必须保持；
- History rail、Composer、Sidecar、conversation scroll 高度不能因多一层 WorkspaceHeader 退化；
- `PageTransition` 的 Kiro flex/min-height 语义需重新验证，避免新增 `space-y-*` 把 Header 与 Conversation 撑出视口。

## 13. Responsive Rules

现有导航响应式结构不改：

```text
>=1280      full Sidebar
768–1279   Icon Rail
<768        Bottom Nav
```

Workspace Header：

### Desktop

```text
Title + Context                          Actions + Primary + Search
```

### Tablet

- Title 始终可见；
- Context 可裁剪；
- Primary 保持可达；
- Search 可变紧凑。

### Mobile

- Title 始终显示；
- Primary 仅在真正重要的 Workspace 显示为紧凑按钮/图标；
- Search 始终可达；
- Context 可隐藏或第二行截断；
- 不把桌面所有 Secondary Controls 塞进 Header。

## 14. Suggested File Boundaries

新增：

```text
components/layout/WorkspaceHeader.tsx
components/layout/WorkspaceSearchButton.tsx
components/assignment/AssignmentsWorkspace.tsx
```

修改：

```text
components/layout/Header.tsx
app/page.tsx
components/timeline/TimelineWorkspace.tsx
components/dashboard/AssignmentTable.tsx
components/group/GroupCollaborationView.tsx
```

`Header.tsx`：

- 最终应删除或停止使用；
- 不保留两个等价 Header abstraction；
- 如果删除文件会造成不必要的大范围 import churn，可在同一 Task 内先变成薄兼容 wrapper，但验收前应确认没有双 Header。

## 15. App Shell Composition Rule

`app/page.tsx` 不再无条件渲染旧 `<Header />`。

Workspace Header 由当前 Workspace owner 渲染：

```text
Overview   → app/page.tsx
Courses    → app/page.tsx
Analytics  → app/page.tsx
Kiro       → app/page.tsx
Tasks      → AssignmentsWorkspace
Timeline   → TimelineWorkspace
Group      → GroupCollaborationView
```

这不是“每个页面重新造 Header”：所有 owner 都只能使用同一个 `WorkspaceHeader` primitive。

这样既保持统一视觉，又不需要新增 Header slot registry，也避免把 Timeline/Group 的本地 ephemeral action state 提升到 Store。

## 16. Data / State Rules

- 不新增 Zustand persisted state；
- 不新增 Workspace Header registry store；
- 不新增 Context Provider 仅用于 Header slot；
- 不新增仅为 Header 服务的 CustomEvent；
- 不改变 `activeTab` / startup / navigation 语义；
- 不改变 Command Center 行为；
- 不改变 Modal/Drawer opening APIs；
- 页面 Context 从已有 Store/derived data 读取；
- Tasks Quick Add 仅使用 React local controlled state。

## 17. Accessibility

必须保持：

- Global Search 有可访问名称；
- Icon-only mobile actions 有 `aria-label`；
- Primary Action 是真实 button；
- Sticky Header 不遮挡 keyboard focus target；
- 不移除现有 `focus-visible` 全局语义；
- 页面标题保持单一清晰的 `h1/h2` 语义层级，避免 Header 与内部 Banner 同时出现同名标题。

## 18. Testing Strategy

保持精简，不做全站视觉截图回归。

### Unit / Component-level

若项目当前没有轻量 React component unit harness，不为了本任务新引入测试栈。

优先验证纯/可稳定断言的行为：

- Workspace title mapping；
- Search 打开 Command Center；
- Tasks Quick Add controlled state 不影响 compact mode；
- Courses/Group Primary action 继续调用原入口；
- Timeline 周切换/Today/Filter/Create 行为未改变。

### Existing E2E / Targeted E2E

只跑与 Shell/Navigation 直接相关的现有测试。先通过文件名/grep 确认真实存在，再选择最小集合。优先：

- responsive；
- command-center；
- first-run；
- timeline；
- assignment workspace；
- Kiro workspace/layout（若已有）；
- settings entry 仅在旧 Header 删除影响入口时运行。

不要跑全量 Playwright，除非 targeted regression 暴露跨 Shell 问题。

### Required verification

- `npm run typecheck`；
- focused tests；
- `npm run build`；
- Desktop 1440 / Tablet 1024 / Mobile 390 手工 smoke。

## 19. Acceptance Criteria

Task 1 完成必须同时满足：

1. Desktop/Tablet 不再以 greeting 作为所有页面主标题；
2. 所有 Workspace 使用同一个 `WorkspaceHeader` primitive；
3. Global Search 在所有 Workspace 中保持稳定位置与可达性；
4. Courses 顶部 Banner Card 删除；
5. Analytics 顶部 Banner Card 删除；
6. Group 顶部 Banner Card 删除；
7. Tasks 页面标题与 workspace Primary Create 不再由 `AssignmentTable` 自己承担；
8. Tasks Quick Add V2 仍为 inline card，且课程筛选 prefill 语义不变；
9. Overview compact AssignmentTable 的标题、count、逾期提示、compact create 与分页行为不变；
10. Timeline 不再重复显示页面身份/周信息，`+` 只保留一份且仍在 local toolbar；
11. Timeline 周切换/Today/Filter/Create/Ask Kiro/More 行为不变；
12. Group Header Primary 直接复用原 `openCreateProject`，不新增 Store/event；
13. Kiro 保持 Workspace Header + Thread Header 两级语义；
14. Kiro History rail / Composer / Sidecar / scroll 高度无明显回归；
15. Sidebar / Icon Rail / Bottom Nav IA 不改变；
16. Command Center 行为不改变；
17. 不引入新的 persisted state / Header registry / Header CustomEvent；
18. 不进行全站 Button/Modal/Card/Typography 重构；
19. typecheck、focused tests、build 通过；
20. 1440 / 1024 / 390 三档布局无明显 overflow、双滚动或 header collision。

## 20. Explicit Non-goals

本任务明确不做：

- 全站 Button primitive migration；
- `SettingsButton → Button`；
- `KiroMenu → DropdownMenu`；
- GroupModal 迁移；
- Modal / Drawer / Popover 统一；
- Tasks ViewBar 重设计；
- Course Card 重设计；
- “查看资料” affordance 修复；
- Overview Card flattening；
- Analytics chart redesign；
- Kiro Composer / Thread Rail redesign；
- Typography 全站 scale 重构；
- magic hex 全量清理；
- 新动画系统；
- 新导航结构；
- 业务数据模型变更。

## 21. Follow-up Productization Tasks

Task 1 完成后，建议顺序：

```text
Task 2  Global UI Primitives
Task 3  Tasks Workspace Productization
Task 4  Courses Productization
Task 5  Overview / Analytics Surface Reduction
Task 6  Group UI Grammar Migration
Task 7  Kiro / Settings Consistency Pass
Task 8  Final UI Consistency Audit
```

Task 1 的职责只有建立所有后续页面都能遵循的稳定 App Shell。