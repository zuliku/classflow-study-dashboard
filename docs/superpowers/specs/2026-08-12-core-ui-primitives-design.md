# ClassFlow Core UI Primitives Design

**Date:** 2026-08-12  
**Status:** Approved for implementation planning  
**Scope:** UI Productization Task 2A  
**Product direction:** Linear 的结构秩序 + Notion Calendar 的低噪声视觉

## 1. Goal

建立 ClassFlow 第一层真正的全局 UI grammar，把目前分散在 Settings、Tasks、Workspace Header 等区域中的常用控件收敛为一组通用 primitives。

本任务只覆盖：

- Button
- IconButton
- Input
- SearchField
- SegmentedControl
- Switch

并采用低风险迁移策略：Settings 现有 `SettingsControls.tsx` 暂时保留，但退化为全局 primitives 的薄 wrapper；只迁移少量高价值业务表面。

## 2. Why This Task Exists

Task 1 已统一 App Shell / Workspace Header，但页面内部仍存在多套重复控件：

- Settings 有 `SettingsButton / SettingsInput / SettingsToggle / SettingsSegmentedControl`；
- Tasks 手写搜索框和 Primary View tabs；
- Workspace Header / Courses / Group / Tasks 各自手写 Primary button；
- 多个页面重复实现 32×32 Icon Button 的 hover/focus/disabled 语义。

这些控件视觉接近，但实现与 API 不一致，是当前“模块各自成熟、产品整体仍像拼接”的主要来源之一。

## 3. Chosen Migration Strategy

采用 **global primitive first + Settings wrapper compatibility**。

```text
Business / Feature UI
        ↓
components/ui/*
        ↓
Semantic Tailwind tokens
```

Settings 暂时：

```text
SettingsControls
        ↓ thin wrapper
components/ui/*
```

不在 Task 2A 删除 Settings wrapper，也不一次迁移全站所有调用点。

## 4. Scope Boundary

### In scope

新增：

```text
components/ui/Button.tsx
components/ui/IconButton.tsx
components/ui/Input.tsx
components/ui/SearchField.tsx
components/ui/SegmentedControl.tsx
components/ui/Switch.tsx
```

首批迁移：

1. `SettingsControls.tsx` → thin wrappers；
2. `WorkspaceSearchButton`；
3. Workspace Primary Actions：Tasks / Courses / Group；
4. Tasks Workspace Search；
5. Tasks Workspace Primary View segmented control；
6. Task 1 Kiro `PageTransition` spacing hotfix。

### Explicit non-goals

本任务不处理：

- DropdownMenu / KiroMenu；
- Popover；
- Dialog；
- Drawer；
- Select（继续使用现有 `UISelect`）；
- Toast；
- Timeline Toolbar 全量迁移；
- Kiro Composer / Rail 控件迁移；
- Course Cards；
- Overview / Analytics Card flattening；
- Group 内部表单控件；
- 全站 Typography overhaul；
- semantic color 大清理。

这些进入后续 2B / 页面级 Productization。

## 5. Button

建议 API：

```ts
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "accent";

export type ButtonSize = "sm" | "md";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}
```

规则：

- 默认 `variant="secondary"`；
- 默认 `size="sm"`；
- `sm` 对齐当前产品主操作高度，约 h-8；
- Primary：charcoal / white；
- Secondary：surface / border；
- Ghost：transparent；
- Danger：现有 danger semantic tokens；
- Accent：pastel mint；
- 统一 `focus-visible`、disabled、transition、`ux-press`；
- 直接透传标准 button attributes；
- 不增加 `testid`、`ariaLabel` 等平行自定义属性。

不要求本轮建立 polymorphic `asChild`、loading spinner、leftIcon/rightIcon API。

## 6. IconButton

建议 API：

```ts
export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "ghost" | "secondary" | "primary" | "danger";
  size?: "sm" | "md";
}
```

规则：

- 只负责正方形 icon control；
- `sm` 对齐 32×32；
- Icon-only consumer 必须提供 `aria-label` 或等价可访问名称；
- 不内置 Tooltip；
- Task 2A 只作为基础能力和 Search mobile consumer，不批量迁 Timeline/Kiro。

## 7. Input

建议：

```ts
export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  mono?: boolean;
}
```

支持现有主要输入类型：

- text
- url
- number
- time
- password

规则：

- 使用标准 input attributes；
- `invalid` 映射 danger border；
- `mono` 只控制字体；
- 统一 h-9 / rounded-lg / border / placeholder / focus / disabled；
- 不内置 label、description、validation message。

## 8. SearchField

SearchField 是 Input 的组合 primitive，不读取业务 Store。

建议 API：

```ts
export interface SearchFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  onClear?: () => void;
}
```

规则：

- 内部固定 `type="search"` 或文本搜索等价语义；
- 左侧 Search icon；
- 输入值存在且 consumer 提供 `onClear` 时可显示清除入口；
- 统一边框、背景、高度、focus；
- 不包含 debounce、filter 逻辑、Command Center 行为。

Task 2A 第一业务消费者是 Tasks Workspace Search。

## 9. SegmentedControl

必须支持 Tasks 带数量的 label，因此 label 使用 `React.ReactNode`。

建议：

```ts
export interface SegmentedOption<T extends string | number> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string | number> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  ariaLabel?: string;
  className?: string;
}
```

语义：

- 外层 `role="group"`；
- 每项 button 使用 `aria-pressed`；
- active 使用浅 surface + subtle shadow；
- inactive 使用 muted text；
- 支持 disabled；
- 保持现有 compact 视觉，不引入动画滑块 indicator。

Task 2A 只迁 Tasks Primary Views；Archive 临时态与 Risk Filter 保持 feature-specific。

## 10. Switch

建议：

```ts
export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}
```

规则：

- `role="switch"`；
- `aria-checked`；
- 复用当前 SettingsToggle 的几何和 motion；
- 支持 disabled；
- 不引入三态值；
- 不内置文字 label UI，只用 label 作为 accessible name。

## 11. Settings Compatibility Layer

`components/settings/SettingsControls.tsx` 暂时保留。

迁移后：

```text
SettingsButton            → Button
SettingsInput             → Input
SettingsToggle            → Switch
SettingsSegmentedControl  → SegmentedControl
SettingsSelect            → existing UISelect（不改）
```

要求：

- Settings 调用方原则上无需批量修改；
- wrapper 继续维持当前 Settings API，避免一次性扩大 diff；
- wrapper 只做参数适配，不重复保留完整 Tailwind 样式；
- 不同时做 Settings 文件级 cleanup。

## 12. Workspace Migration

### 12.1 Workspace Search

`WorkspaceSearchButton` 使用 `Button` / `IconButton` 组合或其中一个 primitive，但行为保持：

```ts
setSearchModalView("palette");
setSearchModalOpen(true);
```

Cmd/Ctrl+K 与 Command Registry 不变。

### 12.2 Workspace Primary Actions

首批迁移：

- Tasks：新增任务；
- Courses：添加课程；
- Group：新建项目。

全部改用全局 `Button variant="primary"`。

不改变点击处理器、文本或业务状态。

### 12.3 Tasks Search

当前手写 Search icon + input 容器替换为 `SearchField`。

保持：

- `searchQuery` state；
- filtering semantics；
- placeholder `搜索任务…`；
- `aria-label="搜索任务"`。

### 12.4 Tasks Primary Views

将 Primary View tabs 替换为 `SegmentedControl`。

保持：

- `PRIMARY_TASK_WORKSPACE_VIEWS` 顺序；
- current value = `assignmentWorkspaceView`；
- `workspaceViewResult.counts[view.id]` count；
- search 不改变 count semantics；
- archive 仍是临时状态 UI；
- riskOnly 仍是独立轻量 filter。

## 13. Task 1 Hotfix

修正 Kiro `PageTransition` class composition。

当前存在：

```tsx
cn(
  "space-y-5",
  activeTab === "kiro" && "flex flex-col flex-1 min-h-0"
)
```

改为互斥：

```tsx
activeTab === "kiro"
  ? "flex flex-col flex-1 min-h-0"
  : "space-y-5"
```

只修 spacing composition，不改 Kiro Workspace / Thread Header / Composer / History Rail。

## 14. Visual Rules

Core primitives 应继承当前 ClassFlow 语言，而不是重新换皮：

- low-noise；
- h-8/h-9 compact controls；
- rounded-lg 为主要 control radius；
- semantic tokens 优先；
- shadow 只在 active segmented / 浮层等有层级意义时使用；
- primary button 可保留 charcoal；
- focus-visible 明确但克制；
- disabled 必须可见且不可交互。

本任务不要求清理所有现有 hex。

## 15. State / Architecture Rules

- primitives 不读取 Zustand；
- primitives 不读取 Kiro Store；
- 不新增 persisted state；
- 不新增 Context；
- 不新增 CustomEvent；
- 不新增依赖；
- 不增加 CVA / Radix / Headless UI 等库；
- 继续使用 `cn()` 和现有 Tailwind tokens。

## 16. Accessibility

必须保持：

- Button 使用真实 button；
- IconButton 必须由 consumer 提供 accessible name；
- SearchField 有可访问 input label；
- SegmentedControl 有 group label，item 有 pressed semantics；
- Switch 使用 `role="switch"` + `aria-checked`；
- disabled 状态同时反映 DOM disabled 与视觉状态；
- focus-visible 不因迁移丢失。

## 17. Testing Strategy — Efficiency First

默认最小验证集：

1. `npm run typecheck` — 必跑；
2. 只跑一个 Tasks targeted E2E，覆盖最关键迁移：
   - Workspace 打开；
   - Primary `新增任务` 仍能打开 Quick Add；
   - SearchField 仍能筛选；
   - Primary View segmented 仍能切换；
3. Settings 不新增/扩展整套 E2E；Settings wrapper 的主要保障来自 typecheck 和现有调用 API 不变；
4. `npm run build` 默认跳过。

只有在以下情况补 build：

- 出现 Client/Server import boundary 风险；
- Next/Tailwind 编译异常；
- typecheck 无法覆盖的模块导入问题；
- Agent 改动了 config/dependency（本任务正常情况下不应发生）。

禁止默认执行：

- `npm test`；
- 全量 Vitest；
- 全量 Playwright；
- responsive/settings 多文件回归联跑；
- visual screenshot regression。

纯 UI primitive 不为了测试而引入 React component test harness；若仓库已有轻量 harness 可复用，也只写少量语义测试。

## 18. Suggested Commit Boundaries

最多两个 implementation commits：

1. `refactor(ui): add core UI primitives`
   - global primitives；
   - Settings thin wrappers；
   - Kiro spacing hotfix。

2. `refactor(ui): migrate core workspace controls`
   - Workspace Search / Primary Actions；
   - Tasks Search / Primary Views；
   - targeted E2E 调整。

如果实现非常集中，也允许一个 commit；不要为了形式硬拆。

## 19. Acceptance Criteria

Task 2A 完成必须满足：

- 六个 global primitives 存在且 feature-neutral；
- SettingsControls 继续可用，但主要样式/行为委托 global primitives；
- `SettingsSelect` 继续使用现有 `UISelect`；
- Workspace Search 行为不变；
- Tasks/Courses/Group Primary action 使用全局 Button；
- Tasks Search 使用 SearchField 且筛选语义不变；
- Tasks Primary Views 使用 SegmentedControl 且 count 语义不变；
- Archive / Risk Filter 未被强行并入 Segmented；
- Kiro `PageTransition` 不再同时带 `space-y-5`；
- 无新 dependency / persisted state / Context / CustomEvent；
- `npm run typecheck` PASS；
- 一个关键 Tasks targeted E2E PASS；
- 没有进行不必要的全量测试；
- Task 2B 范围未提前实现。

## 20. Next Task

Task 2A 完成后 STOP。

下一阶段单独设计：

**UI Productization Task 2B — Overlay & Menu Primitives**

预计覆盖：DropdownMenu / Popover / Dialog / Drawer，并重点把 Timeline 对 `KiroMenu` 的通用复用解耦。
