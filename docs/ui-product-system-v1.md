# ClassFlow UI Product System v1

> 来源：本项目现有实现（Task 1 UI Foundation + Overview Polish）。本文件记录已确立的产品视觉语言，
> 不是设计论文。新增/修改 UI 时优先对齐这里，而不是发明新体系。

## 1. Surface（五级）

1. **Page** — `--background`（#F7F5F5）。页面底色，不承担卡片感。
2. **Surface** — `bg-surface`（#F4F2EF）+ `border-line` + `rounded-xl`（12–14px）+ 极弱 shadow
   （`shadow-subtle` 或更弱）。总览页各业务模块的外壳（Timetable / UpcomingDDL / MiniCalendar /
   StudyLoad / AssignmentTable）。
3. **Row** — 无独立卡片感的信息项：hover 仅 `bg-alabaster/50` + 文字/图标色变化，120–150ms。
   用 divider（`divide-line-soft`）分隔。**Surface 内普通信息项优先使用 Row，不继续套完整 Card。**
4. **Floating Surface** — Popover / Dropdown / 反馈条：`bg-surface` 或 `bg-white` + `border-line-strong`
   + `rounded-xl` + `shadow-card`。presence 用 `ux-inline`。
5. **Selected Surface** — 共享 selection 语义：Sidebar 共享 nav plate、Calendar 共享 selection
   indicator、Segmented 选中项。背景是 indicator 的，不是每个 item 自己的。

核心原则：

> 一个完整功能区域可以是 Surface，但 Surface 内普通信息项优先使用 Row，不继续套完整 Card。

## 2. 圆角语言

| 用途 | 半径 |
| --- | --- |
| input / button / 小控件（含 IconButton、日期格、chevron） | 8px（`rounded-lg`） |
| list row / selector / compact item | 8–10px |
| dashboard surface / workspace section | 12–14px（`rounded-xl`） |
| modal / 大型浮层面板 | 16px（`rounded-2xl`，少数场景保留） |

- Kiro Featured Entry 保持自身品牌几何，不套用此表。
- 避免「所有东西都是 rounded-2xl」。

## 3. Typography

| 层级 | 字号 | 用途 |
| --- | --- | --- |
| Workspace title | 18px（`text-lg`） | WorkspaceHeader 标题 |
| Section title | 14px（`text-sm`） | Surface header 标题（本周课表 / 临近 DDL / 任务清单 / 月份标题） |
| Primary body | 13px（`text-xs` + `text-[13px]`） | 任务标题、日期格、按钮 |
| Secondary | 12px（`text-xs`） | 辅助行、row 副信息、footer |
| Caption | 11px（`text-[11px]`） | context、group header、空状态、辅助说明 |
| metadata | 10px（`text-[10px]`） | 仅极低权重 metadata（时间刻度、agenda 计数、popover 次级行） |

约束：

- 总览页原则上无 9px（`text-[9px]` / `text-[9.5px]` / `text-[8px]`）。
- 不要通过 8/9px 字体把信息硬塞进去。

## 4. Motion

沿用 globals.css 既有 tokens 与工具类，不引入动画 framework（Motion V3）：

- durations：`--motion-snap(90)` / `--motion-fast(140)` / `--motion-base(180)` /
  `--motion-overlay(220)` / `--motion-panel(230)` / `--motion-page(180)` / `--motion-data(200)`；
  exit = enter 的 70–80%：`--motion-exit-fast(110)` / `--motion-exit-base(150)` /
  `--motion-exit-panel(160)`（唯一真值见 `lib/motion.ts`，三方由 `tests/motionContract.test.tsx` 校验）。
- easing：进入 `--ease-standard`（历史视觉不变，新代码可用 `--ease-enter`）/
  品牌 `--ease-emphasized`；**所有退出分支用 `--ease-exit`（加速离场，进出不对称）**；
  大位移 morph 可用 `--ease-spring`（无 bounce 通用档）。
- PageTransition：opacity-only。
- Row hover：background / text / icon color 120–150ms，无 scale / translate / shadow transition。
- 普通 Card：无 hover 上浮 / scale / bounce / 强 shadow transition。
- 直接操作（拖拽/调整）反馈：snap 吸附 + settle opacity 归位。
- 首屏编排：staged fade（`--kiro-stagger-0/1/2/3`）+ skeleton shimmer（`ux-skeleton`），reduced-motion 下静态。
- 图表动画 respect reduced motion（`useEffectiveReducedMotion`），时长 250–350ms 量级。
- 原则：**Animate causality, not decoration.**

## 5. 保留不动的品牌视觉

- Kiro Sidebar Featured Entry：`.kiro-ring` / `.kiro-featured-flow` / conic-gradient /
  `flow-angle-spin` 流动彩边。正常 motion 持续流动；reduced-motion 静态彩边。
- Now indicator、Sidebar shared active plate、DDL drag feedback、panel presence。

## 6. Header Action Contract（顶栏三层槽位）

> 顶栏右侧只允许三层：**L1 状态 → L2 操作（页面次要｜AI｜页面主要）→ 全局**。
> 分组用间距（组内默认 gap，组间 +4px），**禁止发丝分隔线**；ghost 图标 ≤2 个；primary 恰好 0–1 个。

- **L1 状态层**：瞬时、非操作（如专注 chip）。用 `quiet` 安静形态（圆点 + 文字、无边框 pill，
  宽 ≤180px 截断），永远排在操作组左侧；只有存在时才渲染，不占位。
- **L2-AI**：`KiroFlowButton` 流光形态全页保留（与侧栏品牌呼应），位置固定在页面主要操作之前。
- **L2-主要**：形态各页自定但全页须有一致主次（时间表保持图标方块、任务/课程用文字按钮——
  确认结论，不强制统一形态，只统一层级位置）。
- **全局**：搜索（`WorkspaceSearchButton`）永远最后。
- **条件 AI 操作不进顶栏**：如“拆解高亮任务”归任务行内 hover/高亮入口（`AssignmentTable` 行操作簇），
  不在顶栏条件增删按钮（避免行数跳动 + 层级污染）。
- **窄屏折叠顺序**：L1 先隐藏 → AI 只留图标 → 搜索只留图标（各组件既有响应式类即契约实现）。
