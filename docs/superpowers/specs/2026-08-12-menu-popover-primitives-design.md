# ClassFlow Menu & Popover Primitives Design

**Date:** 2026-08-12  
**Status:** Approved for implementation planning  
**Scope:** UI Productization Task 2B1  
**Product direction:** Linear 的结构秩序 + Notion Calendar 的低噪声视觉

## 1. Goal

建立 ClassFlow 的轻量浮层 UI grammar，把目前分散在 Timeline 与 Kiro 中的 menu / popover surface、placement、dismiss 与 menu item 视觉收敛到全局 `components/ui`。

本任务采用 **controlled-first**：业务组件继续拥有 `open` state 与业务互斥逻辑；全局 primitive 只负责 dismiss、relative anchor、panel surface/placement 和 menu semantics。

首批迁移范围严格限定为：

- Timeline：Filter / Quick Create / More；
- Kiro：`KiroMenu.tsx` 退化为 compatibility layer，现有 Kiro 调用点不批量迁移。

Tasks More / Context Menu、Dialog、Drawer 均不进入本任务。

## 2. Why This Task Exists

`components/kiro/KiroMenu.tsx` 当前已经实现通用能力：Esc、outside click、bottom/top/right placement、MenuPanel、MenuItem、Divider，但这些能力错误地归属于 Kiro 命名空间。

Timeline 又同时存在三种实现：

1. Filter：手写 popover shell；
2. Quick Create：手写 menu shell + `KiroMenuItem`；
3. More：直接使用 `KiroMenuPanel / Item / Divider`。

因此当前问题不是缺少功能，而是同一交互语法存在三套 ownership。

## 3. Chosen Architecture

采用两层结构：

```text
Feature state / business handlers
        ↓
Popover (controlled dismiss + relative anchor)
        ↓
PopoverPanel (surface + placement)
        ↓
DropdownMenuPanel / Item / Divider (command menu semantics)
```

Kiro compatibility：

```text
KiroMenuPanel / Item / Divider
        ↓ thin wrapper
Global DropdownMenu primitives
```

不建立新的 global menu store，不新增 Context，不新增 portal positioning engine。

## 4. Scope Boundary

### In scope

新增：

```text
components/ui/Popover.tsx
components/ui/DropdownMenu.tsx
```

修改：

```text
components/kiro/KiroMenu.tsx
components/timeline/TimelineWorkspace.tsx
tests/e2e/timeline-v2-visual.spec.ts
```

在现有 `timeline-v2-visual.spec.ts` 中增加一个独立非截图菜单行为 case；不要新建大测试文件。

### Explicit non-goals

本任务不处理：

- Dialog / Drawer / Modal shell；
- `lib/overlayStack.ts`；
- GroupModal；
- ConfirmDialog；
- SettingsModal；
- AssignmentDrawer / CourseDetailDrawer；
- Tasks More menu；
- Assignment Context Menu；
- Kiro Thread Row 的手写 row menu；
- Kiro Message / SessionActions / ThreadRail 全量直接迁到 global imports；
- portal / collision detection / Floating UI engine；
- focus trap；
- roving tabindex / arrow-key menu navigation；
- Radix / Headless UI / Floating UI 等新依赖。

Dialog/Drawer 单独进入 Task 2B2。

## 5. Controlled-first Popover

### 5.1 `Popover`

API：

```ts
export interface PopoverProps extends React.HTMLAttributes<HTMLDivElement> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}
```

职责：

- render 一个 `relative` anchor root；
- open 时监听 `Escape`；
- open 时监听 `pointerdown`，点击 root 外部调用 `onOpenChange(false)`；
- cleanup listeners；
- 透传 className / data / aria 等 div attributes。

不负责：

- 自己维护 open state；
- trigger toggle；
- 多 Popover 互斥；
- Portal；
- collision / viewport flipping；
- focus trap。

Timeline 保留 `filterOpen / quickOpen / moreOpen`，以及打开一个浮层时关闭另外两个的现有业务逻辑。

### 5.2 `PopoverPanel`

Placement：

```ts
export type PopoverPlacement =
  | "bottom-end"
  | "bottom-start"
  | "top-end"
  | "right-end";
```

API：

```ts
export interface PopoverPanelProps
  extends React.HTMLAttributes<HTMLDivElement> {
  placement?: PopoverPlacement;
}
```

基础视觉：

```text
absolute z-40
bg-surface
border border-line-strong
rounded-2xl
shadow-card
ux-inline
max-h-[min(420px,60vh)]
overflow-y-auto
```

placement：

```text
bottom-end   → right-0 top-full mt-1.5
bottom-start → left-0 top-full mt-1.5
top-end      → right-0 bottom-full mb-1.5
right-end    → left-full right-auto bottom-0 ml-2
```

Panel 不默认声明 `role="menu"`，因为筛选控制、Share Sheet 等内容不是命令菜单。

## 6. Dropdown Menu

`components/ui/DropdownMenu.tsx` 建立在 `PopoverPanel` 上，只用于命令型菜单。

### 6.1 `DropdownMenuPanel`

API：

```ts
export interface DropdownMenuPanelProps
  extends React.HTMLAttributes<HTMLDivElement> {
  placement?: PopoverPlacement;
}
```

默认：

```text
role="menu"
min-w-[190px]
max-w-[300px]
text-xs
p-1
```

允许 `aria-label` 和 `className` 覆盖宽度/spacing，例如 Quick Create `w-52`、Kiro Share `w-[290px] p-3`。

### 6.2 `DropdownMenuItem`

API：

```ts
export interface DropdownMenuItemProps {
  icon?: React.ComponentType<{ className?: string }>;
  label: React.ReactNode;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  danger?: boolean;
  disabled?: boolean;
  className?: string;
}
```

语义：

- real button；
- `type="button"`；
- `role="menuitem"`；
- native disabled；
- normal / danger visual；
- icon 可选；
- label 支持 ReactNode，兼容未来 shortcut/meta 文本，但本轮不新增复杂 layout API。

基础视觉继续沿用当前 KiroMenu 的成熟语言：

```text
w-full flex items-center gap-2.5
px-2.5 py-2
rounded-xl
text-left font-semibold
normal: text-satin-grey hover:bg-alabaster hover:text-charcoal
danger: text-danger hover:bg-danger-bg
disabled: opacity-40 cursor-not-allowed
```

### 6.3 `DropdownMenuDivider`

```text
my-1 h-px bg-line-soft
role="separator"
```

## 7. Timeline Migration

Timeline 继续保留 Local Toolbar 和当前业务状态。

### 7.1 Toolbar triggers

Filter / Create / More trigger 改用 Task 2A 已建立的 `IconButton`：

```text
Filter → variant="ghost"
Create → variant="primary"
More   → variant="ghost"
```

保持：

- `aria-label`；
- `aria-expanded`；
- title；
- single `+`；
- Ask Kiro 位置；
- open mutual exclusion。

上一周/下一周/今天不属于本次 menu migration，不为了扩大 primitive 使用率而修改。

### 7.2 Filter = Control Popover, not Menu

Filter 内含连续 checkbox，因此使用 `PopoverPanel`，而不是 `DropdownMenuPanel`：

```tsx
<Popover open={filterOpen} onOpenChange={setFilterOpen}>
  <IconButton ... />
  {filterOpen && (
    <PopoverPanel
      placement="bottom-end"
      role="group"
      aria-label="时间表筛选"
      className="w-44 p-1.5 space-y-0.5"
    >
      ...existing FilterToggle content...
    </PopoverPanel>
  )}
</Popover>
```

Filter 内部 checkbox / `FilterToggle` 保持 feature-local，不强行变成 `DropdownMenuItem`。

### 7.3 Quick Create

迁移到 `Popover + DropdownMenuPanel`，菜单项使用 global `DropdownMenuItem`：

- 新建课程；
- 学习计划；
- 新建任务；
- 考试 / 日程。

所有 handler 完全保持，包括动态 import `openAssignmentEditor`。

### 7.4 More

由 `KiroMenu*` 改为 `Popover + DropdownMenuPanel / Item / Divider`：

- 导入课表；
- 全屏查看；
- divider；
- 时间表设置。

不改变 settings deep link。

## 8. Kiro Compatibility Layer

`components/kiro/KiroMenu.tsx` 暂时保留文件与 exports，避免大范围 Kiro diff。

必须继续提供：

```text
useKiroPopover
KiroMenuPanel
KiroMenuItem
KiroMenuDivider
```

其中：

- `KiroMenuPanel` → thin wrapper around `DropdownMenuPanel`；
- `KiroMenuItem` → thin wrapper around `DropdownMenuItem`；
- `KiroMenuDivider` → `DropdownMenuDivider`；
- placement API 保持 `bottom-end | top-end | right-end`；
- Kiro 当前 width / custom children / danger / disabled 兼容。

`useKiroPopover` 本轮保留现有公开 API 和行为，避免改写 SessionActions / KiroMessage / ThreadRail 的 state ownership。它可以继续作为 legacy compatibility state helper；不要因为“彻底抽象”而强迫 Kiro 消费者改成 global `Popover`。

本轮 Kiro compatibility hook 与 global Popover 不叠加使用，避免双 dismiss listener。

## 9. Dismiss & Event Semantics

Global `Popover`：

- Esc → `onOpenChange(false)`；
- outside pointerdown → `onOpenChange(false)`；
- inside click不自动关闭；具体 command handler 继续由 feature 主动 `setXOpen(false)`；
- trigger 点击由 consumer 自己 toggle；
- unmount / open=false 时 listener 清理。

这与 Timeline 当前 handler 模式一致，也不会改变 Filter checkbox 连续操作体验。

Kiro compatibility hook 继续保持当前自己的 dismiss 行为；本轮不让 Kiro 同时套 global Popover。

## 10. Accessibility

必须保持：

- trigger 是真实 button；
- trigger 有 `aria-label` + `aria-expanded`；
- Quick Create / More panel 为 `role="menu"`；
- command item 为 `role="menuitem"`；
- divider 为 `role="separator"`；
- Filter panel 为 `role="group"`，保留真实 checkbox；
- disabled item 使用 native disabled；
- Esc 可以关闭 Timeline 当前打开的浮层。

本轮不新增 ArrowUp/ArrowDown roving focus；这是独立 accessibility enhancement，不与结构迁移捆绑。

## 11. Visual Rules

继续使用现有 ClassFlow token：

- `bg-surface`；
- `border-line-strong`；
- `rounded-2xl` panel；
- `shadow-card` 仅用于真正 floating surface；
- `rounded-xl` menu item；
- muted text → hover charcoal；
- danger semantic tokens；
- `ux-inline` motion。

本轮不是 redesign，迁移前后视觉应基本一致，只消除同类浮层的 class 漂移。

## 12. Testing Strategy — Efficiency First

默认最小验证：

1. `npm run typecheck`；
2. 只跑一个 Timeline E2E 文件：`tests/e2e/timeline-v2-visual.spec.ts`；
3. 在该文件增加一个菜单行为 case，覆盖：
   - Filter 打开；
   - Create 打开时 Filter 关闭；
   - More 打开时 Create 关闭；
   - Esc 关闭当前 More；
   - outside click 关闭 Filter 或 More；
   - Create 的“学习计划”仍可打开现有安排 sheet（只验证一个业务 item，避免逐项测试）。
4. `npm run build` 默认跳过。

不默认运行：

- `npm test`；
- 全量 Playwright；
- `timetable-drag.spec.ts`；
- Kiro E2E；
- Settings / Tasks E2E；
- screenshot regression。

只有 targeted Timeline case 暴露具体业务回归，才补对应单文件测试。

## 13. State / Architecture Rules

- 不新增 dependency；
- 不新增 persisted state；
- 不新增 Zustand slice；
- 不新增 Context；
- 不新增 CustomEvent；
- 不修改 `overlayStack`；
- 不把三组 Timeline open state 合并成新 store；
- 不用 Portal 改变当前 clipping/stacking 行为；
- primitives 不读业务 Store。

## 14. Acceptance Criteria

Task 2B1 完成必须满足：

- `Popover.tsx` 与 `DropdownMenu.tsx` 是 feature-neutral global primitives；
- Popover 为 controlled-first；
- Timeline Filter 使用 control Popover，Create / More 使用 command menu primitives；
- Timeline FilterToggle 行为不变；
- Timeline `+` 仍只有一份；
- 三个浮层保持互斥；
- Esc / outside click dismiss 有效；
- Quick Create handlers 不变；
- More handlers 与 settings deep link 不变；
- `KiroMenu.tsx` 继续兼容现有 Kiro imports，但 Panel/Item/Divider 委托 global primitives；
- Kiro consumers 不进行批量 import migration；
- Tasks menu/context menu 未修改；
- Dialog/Drawer/overlayStack 未修改；
- `npm run typecheck` PASS；
- `tests/e2e/timeline-v2-visual.spec.ts` PASS；
- build 按 policy PASS 或 skipped；
- Task 2B2 未开始。

## 15. Next Task

Task 2B1 完成后 STOP。

下一阶段：

**UI Productization Task 2B2 — Dialog & Drawer Primitives**

重点统一 Portal / backdrop / Presence / Esc-topmost / focus restore / header-body-footer shell。