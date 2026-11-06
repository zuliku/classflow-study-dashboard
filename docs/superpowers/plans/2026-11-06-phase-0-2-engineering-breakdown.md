# Phase 0–2 Engineering Breakdown & Migration Plan

> 状态：执行拆解（设计已确认，未实现）
> 日期：2026-11-06
> 前置文档：
> - `docs/superpowers/plans/2026-11-06-task-lifecycle-data-truth-contract.md`
> - `docs/superpowers/plans/2026-11-06-today-plan-interaction-spec.md`
> 目标：把 Phase 0（数据真相）、Phase 1（Shell + Today）、Phase 2（Plan）拆成可排期、可验收、可回滚的工程工作包。

---

## 0. 一句话

**先用 additive 数据模型修正任务事实，再把旧 Overview / Timeline / Assignments 渐进迁移到 Today / Plan；全程双 Feature Flag，旧页面可回退，persist version 保持 8。**

---

## 1. 交付策略

### 1.1 三条原则

1. **先事实，后页面。** Phase 0 不追视觉；先把状态、逾期、计划覆盖度、完成事务、Kiro 写边界统一。
2. **纵向切片。** 每个 Phase 都交付一条可用的端到端路径，不做“全页面半成品”。
3. **双 Flag、可回退。** `taskLifecycleV2` 控制数据/命令层，`todayPlanV1` 控制新页面；旧页面在新 Flag 关闭时仍可用。

### 1.2 团队假设

| 角色 | 投入 | 职责 |
|---|---|---|
| FE1（Domain/Store） | 1.0 | types、selectors、store commands、migration、history/reminder |
| FE2（UI/Interaction） | 1.0 | Today/Plan 组件、拖拽、响应式、Kiro 交互 |
| Designer | 0.5 | 视觉/交互验收、空态/文案、设计 QA |
| QA | 0.5 | E2E、visual regression、迁移 fixture、beta 支持 |
| PM/产品 | 0.3 | 范围控制、beta 访谈、指标 |

如果只有 1 名前端：Phase 0–2 约 26–30 周；不建议压缩测试/迁移。若只能投入 1 FE，优先交付 Phase 0 + Today（约 16–18 周）。

### 1.3 总排期

| Phase | 内容 | 估算 | 日历时间（2 FE 并行） |
|---|---|---|---|
| Phase 0 | 数据真相 + 命令层 + 旧 surface 收口 | 40–44 PD | 4–4.5 周 |
| Phase 1 | Shell + Today | 34–40 PD | 4 周 |
| Phase 2 | Plan | 50–58 PD | 5–6 周 |
| 缓冲 | 联调、beta、回归 | 12–16 PD | 1–2 周 |
| **合计** | | **136–158 PD** | **14–16 周** |

建议对外承诺：**15 周**；内部目标 14 周（2 FE + 0.5 QA + 0.5 Designer 并行）。

### 1.4 阶段 Gate

| Gate | 必须通过 |
|---|---|
| G0（Phase 0 结束） | Phase 0 契约验收全绿；旧页面在 Flag 下不回归；迁移 fixture 全绿；Kiro Chat/Plan 只读 |
| G1（Phase 1 结束） | Today 1440/390 E2E 全绿；首屏指标达标；旧 Overview 可回退 |
| G2（Phase 2 结束） | Plan 1920/1440/1024/390 E2E 全绿；拖拽/应用计划性能达标；旧 Timeline/Assignments 可回退 |

---

## 2. 依赖图

```text
P0-01 Types / normalize
   │
   ├──▶ P0-02 Selectors / projections
   │       │
   │       ├──▶ P0-03 Transition commands / undo
   │       │       │
   │       │       ├──▶ P0-04 Task surfaces
   │       │       └──▶ P0-05 Cross-surface truth
   │       │
   │       └──▶ P2-01 TimetableGrid extension
   │               │
   │               └──▶ P2-04 Canvas layers
   │                       │
   │                       └──▶ P2-06 Drag / resize
   │                               │
   │                               └──▶ P2-09 AI proposal
   │
   ├──▶ P0-06 Trust layer (backup / course / analytics)
   ├──▶ P0-07 Kiro write boundary
   └──▶ P0-08 Migration / tests

P1-01 Shell / routes / flags
   │
   └──▶ P1-02 Today shell
           │
           ├──▶ P1-03 Now/Next + Attention
           ├──▶ P1-04 Today tasks
           ├──▶ P1-05 Today timeline
           ├──▶ P1-06 Rail
           └──▶ P1-07 Responsive
                   │
                   └──▶ P1-08 QA / beta

P2-02 Plan shell
   │
   ├──▶ P2-03 Backlog
   ├──▶ P2-05 Inspector
   ├──▶ P2-07 Tasks view
   ├──▶ P2-08 Agenda / mobile
   └──▶ P2-10 QA / perf
```

关键路径：

`P0-01 → P0-02 → P0-03 → P0-04 → P1-02 → P1-04 → P1-05 → G1 → P2-04 → P2-06 → P2-09 → G2`

可并行：

- P0-06 / P0-07 与 P0-04 / P0-05。
- P2-01（TimetableGrid 扩展）在 P0-02 完成后即可开始，不必等 Today。
- P1-06 Rail 与 P1-05 Timeline 可并行。
- P2-07 Tasks view 与 P2-04 Canvas 可并行。
- P2-09 AI proposal 依赖 P0-07 + P2-04/P2-06。

---

## 3. Phase 0 — 数据真相（3.5–4 周）

### 3.1 目标

- 所有任务 surface 使用同一组 selector。
- `status` 只有 `transitionTask` 写入口。
- 完成/提交可 preview / undo / reopen。
- released blocks 全站不计数。
- submitted 全站一致。
- 备份/课程删除/Analytics/Kiro 写边界达到 Phase 0 契约。
- 不 bump persist version；旧构建可回退。

### 3.2 工作包

| ID | 交付 | 主要文件 | 依赖 | 估算 | 验收 |
|---|---|---|---|---|---|
| P0-01 | Types + normalize + `TASK_MODEL_VERSION=2` | `types/index.ts`、`lib/tasks/taskSemantics.ts`、`store/useAppStore.ts`（normalize） | — | 3 PD | 新字段可 hydrate；旧数据不丢；类型通过 |
| P0-02 | Lifecycle / Planning selectors + Today/Plan projections | 新增 `lib/tasks/taskLifecycle.ts`、`taskPlanning.ts`、`taskProjections.ts`；改 `taskViews.ts`、`taskHealth.ts` | P0-01 | 5 PD | 单测覆盖逾期/剩余/分组/去重 |
| P0-03 | `transitionTask` / preview / undo / reopen / batch | `store/useAppStore.ts`、新增 `lib/tasks/taskTransitions.ts`、`lib/planning/studyBlockLifecycle.ts`、`lib/tasks/taskRecurrence.ts` | P0-02 | 7 PD | 42 条契约验收中 A–G 全绿 |
| P0-04 | 旧任务 surface 迁移 | `AssignmentTable`、`AssignmentDrawer`、Hero/Execution/Actions、`AddAssignmentModal`、`QuickAddCard`、`useAssignmentWorkspaceController` | P0-03 | 6 PD | 任务页无旧 status/progress 写入口；完成/恢复可用 |
| P0-05 | 跨 surface 收口 | `UpcomingDDL`、`TimetableQuickGlance`、`MiniCalendar`、`overviewStudyBlockLayers`、`deriveTimelineItems`、`TimelineWorkspace`、`TimelineUnscheduledShelf` | P0-02/03 | 5 PD | submitted/released/overdue 全站一致 |
| P0-06 | Trust layer | `BackupSection`、`RestorePreviewDialog`、`lib/backupRestore`、`dataDependencies`、`CourseDetailDrawer`、`CourseMaterialSection`、Analytics presentation/weekly review/signals/verdict | P0-02 | 5 PD | 备份诚实、删除预览、partial 不泄漏 |
| P0-07 | Kiro 写边界 | `lib/ai/tools/index.ts`、write registry/schemas/prepare/executor/api、`useKiroChat`、`KiroSessionProvider`、`KiroActionCard` | P0-02/03 | 4 PD | Chat/Plan 只读；终态走 preview；busy 不丢 |
| P0-08 | Migration fixtures + Phase 0 tests | `tests/fixtures/*`、`tests/task*`、`tests/reminder*`、`tests/backup*` | P0-01–07 | 5 PD | 单测/集成/迁移全绿 |
| P0-09 | Buffer / 旧页回归 | — | — | 3 PD | 旧页面 Flag OFF 不回归 |

总估算：**40–44 PD**，含 buffer。

### 3.3 实施顺序（避免大爆炸）

**Step 1：只加类型和 selector，不改行为（2–3 天）**

- 加字段、加 normalize、加 `TASK_MODEL_VERSION`。
- 新 selector 与旧 selector 并存；写对比测试，用现有数据验证新旧结果差异。
- 不改任何 UI。

**Step 2：加命令，不删旧 API（4–5 天）**

- 新增 `transitionTask`、`previewTaskTransition`、`undoTaskTransition`、`reopenTask`、`setTaskDoDate`、`updateTaskFields`。
- 旧 `updateAssignmentStatus` / `updateAssignmentProgress` 保留但标 `@deprecated`。
- 先让新命令的 unit/integration 通过。
- Feature flag `taskLifecycleV2` 默认 OFF；测试里 ON。

**Step 3：迁移单点 surface（4–5 天）**

按风险从低到高：

1. `UpcomingDDL`（只读投影，低风险）。
2. `deriveTimelineItems` + `TimelineWorkspace` DDL/unscheduled（只读投影）。
3. `AssignmentTable` 行/视图（写路径）。
4. `AssignmentDrawer` + Hero/Execution/Actions（写路径）。
5. `AddAssignmentModal` / `QuickAddCard`（创建/编辑）。
6. `Overview` 图层（只读）。
7. `Course` 卡片/详情（只读 + 删除预览）。
8. `Analytics`（只读口径）。
9. `Kiro`（写边界）。

每个 surface 单独 PR；每个 PR 带旧/新对比测试。

**Step 4：翻转默认（2–3 天）**

- 内部/beta cohort 打开 `taskLifecycleV2`。
- 旧 API 仍保留一个版本周期；确认无调用后删除。
- 监控 P0 契约验收。

### 3.4 Phase 0 不做

- 不改 Today/Plan 视觉。
- 不删除旧页面。
- 不 bump persist version。
- 不做 GroupTask 桥。
- 不做多学期。
- 不做 StudyBlock 块级执行状态。

---

## 4. Phase 1 — Shell + Today（4 周）

### 4.1 目标

- 新导航 Today / Plan（Plan 可先复用旧 Timeline 作为占位）。
- Today 首屏：Now/Next → Attention → Today tasks → Today timeline。
- Today Rail：Kiro Brief / Capacity / Waiting / Week Glance。
- 桌面/平板/手机布局可用。
- 旧 Overview 可回退。

### 4.2 工作包

| ID | 交付 | 主要文件 | 依赖 | 估算 | 验收 |
|---|---|---|---|---|---|
| P1-01 | Shell / 导航 / 路由 / Flag / 会话记忆 | `app/page.tsx`、`navItems.ts`、`Sidebar`、`BottomNav`、`PageTransition`、新增 `useWorkspaceMemory` / `useWorkspaceContextStore` | P0-04 | 4 PD | Today/Plan 可切换；旧页 Flag OFF 可用 |
| P1-02 | Today 静态骨架 + Toolbar | 新增 `TodayWorkspace`、`TodayToolbar`；复用 `WorkspaceHeader` | P1-01 | 3 PD | 1440/390 布局；无数据不崩 |
| P1-03 | Now/Next + Attention | `NowNextCard`、`AttentionStrip`、`lib/today/projection.ts` | P1-02、P0-05 | 3 PD | 当前/下一节正确；逾期首屏可见 |
| P1-04 | Today 任务组 + 完成/提交 | `TodayTaskGroups`、`TodayTaskRow`、`TaskTransitionPreviewDialog`（共享） | P1-03、P0-03 | 5 PD | 分组/去重；preview/undo；移动端行 |
| P1-05 | Today 时间线 | `TodayTimeline`、`lib/plan/layout.ts` 的时间/重叠部分；复用 `TimetableGrid` 几何 | P1-02、P0-05 | 6 PD | 重叠并排；窗外 chip；空态不遮挡 |
| P1-06 | Rail：Kiro Brief / Capacity / Waiting / Week Glance | `KiroBriefCard`、`CapacityCard`、`WaitingFeedbackCard`、`WeekGlance` | P1-02、P0-02/P0-07 | 5 PD | 本地 brief；容量 unknown≠0；点击深链 |
| P1-07 | 响应式 / 移动端 / 动效 / 可访问性 | Today 组件 + tokens + tests | P1-02–06 | 4 PD | 390/768/1024/1440；axe；reduced motion |
| P1-08 | E2E / visual / beta | `tests/e2e/today-*`、截图基线 | P1-01–07 | 4 PD | G1 全绿 |
| P1-09 | Buffer / 旧 Overview 回归 | — | — | 3 PD | Flag OFF 不回归 |

总估算：**37 PD**。

### 4.3 并行策略

- FE1：P1-01、P1-03、P1-04（数据/完成链路）。
- FE2：P1-02、P1-05、P1-06（布局/时间线/rail）。
- Designer：P1-02 开始做视觉 QA；P1-07 做 390/768 验收。
- QA：P1-03 开始写 Today projection fixture；P1-08 做 E2E。

### 4.4 Today 首屏验收

- 1440×900：首屏可见 Now/Next、Attention、第一组任务前 2 行。
- 390×844：首屏可见 Now/Next + 第一条任务；无横向滚动。
- 无课程但有 blocks：blocks 可见，空态不覆盖。
- 逾期任务 100% 首屏可见。
- submitted 不出现在 Today。

---

## 5. Phase 2 — Plan（5–6 周）

### 5.1 目标

- Plan 三栏：Backlog / Canvas / Inspector。
- 单一垂直时间轴；退役水平 Key Lane。
- 拖拽/缩放/键盘；移动端 Agenda + “安排到…”。
- Plan Tasks 复用旧 Assignments。
- Plan my week / Rescue proposal preview + apply/undo。

### 5.2 工作包

| ID | 交付 | 主要文件 | 依赖 | 估算 | 验收 |
|---|---|---|---|---|---|
| P2-01 | TimetableGrid 扩展 spike + 实现 | `TimetableGrid.tsx`、`lib/timetableInteraction.ts`、新增 `lib/plan/layout.ts` | P0-02 | 6 PD | `variant=plan`、timeRange/hourHeight/extra layers；旧用法不回归 |
| P2-02 | Plan Shell / ViewBar / 布局 | 新增 `PlanWorkspace`、`PlanViewBar`、`WeekPicker`；`app/page.tsx` | P1-01、P2-01 | 4 PD | 1920/1440/1024/390 布局 |
| P2-03 | Backlog | `PlanBacklog`、复用 `studyBlockInteraction` / `ArrangeSheet` | P2-02、P0-02 | 5 PD | 分组/拖动/安排到/空态 |
| P2-04 | Canvas layers / all-day / DDL / capacity | `PlanCanvas`、`PlanAllDayStrip`、`DeadlineLayer`、`PlanCapacity` | P2-01/02 | 6 PD | 单一时间轴；DDL 时刻/all-day；窗口外 chip |
| P2-05 | Inspector | `PlanInspector`、复用 `AssignmentDrawer` / `CourseDetailDrawer` | P2-02、P0-03 | 5 PD | 任务/块/课程/空态；焦点回归 |
| P2-06 | Drag / resize / keyboard | `lib/plan/drag.ts`、`PlanCanvas`、`PlanBacklog`、`PlanInspector` | P2-03/04 | 6 PD | 15min snap；冲突拒绝；键盘替代；60fps |
| P2-07 | Plan Tasks view | 抽 `TaskWorkspaceBody`；`PlanTasksView` | P1-01、P0-04 | 3 PD | 旧 Assignments 功能不丢；无双 Header |
| P2-08 | Agenda / Day / 3-day / 移动端 | `PlanAgenda`、`PlanDayView`、Backlog/Inspector Sheets | P2-02–06 | 5 PD | 390 Agenda；安排到；无 7 天网格 |
| P2-09 | Proposal / Plan my week / Rescue | `PlanProposalPanel`、共享 `StudyPlanProposalCard` / `StudyRebalanceProposalCard` 逻辑 | P2-04/06、P0-07 | 6 PD | ghost + 接受 + Undo；0 写入直到接受 |
| P2-10 | A11y / perf / E2E / visual | 全 Plan + tests | P2-02–09 | 5 PD | G2 全绿 |
| P2-11 | Buffer / beta | — | — | 4 PD | 旧页回归；beta 反馈 |

总估算：**55 PD**。

### 5.3 并行策略

- FE1：P2-02、P2-03、P2-05、P2-07（布局/Backlog/Inspector/Tasks）。
- FE2：P2-01、P2-04、P2-06、P2-09（Canvas/拖拽/AI）。
- Designer：P2-02 视觉基线；P2-04 块密度；P2-08 移动端；P2-09 proposal。
- QA：P2-03 开始写 drag fixture；P2-06 做性能；P2-10 做多断点 E2E。

### 5.4 Plan 验收

- 1920：三列；1440：两列 + Inspector 覆盖；1024：3-day + Backlog Sheet；390：Agenda。
- DDL 不再水平 Key Lane；所有 timed 实体同一垂直轴。
- released 默认隐藏；窗外 chip；空态不遮挡。
- 拖入任务默认时长按 remaining；冲突拒绝；课程重叠确认。
- Plan my week：ghost → apply → Undo；取消 0 写入。
- 移动端“安排到…”可完成排期，不依赖拖拽。

---

## 6. 文件级变更地图

### 6.1 Domain / Store

| 文件 | 动作 | Phase | 说明 |
|---|---|---|---|
| `types/index.ts` | 修改 | P0-01 | Assignment 新字段、StudyBlock provenance、Reminder cancelled、TaskTerminalTransition |
| `lib/tasks/taskSemantics.ts` | 修改 | P0-01 | normalize 新字段；保留旧语义 |
| `lib/tasks/taskLifecycle.ts` | 新增 | P0-02 | 状态/逾期/时间戳 selector |
| `lib/tasks/taskPlanning.ts` | 新增 | P0-02 | active block/remaining/schedulingState |
| `lib/tasks/taskProjections.ts` | 新增 | P0-02 | Today / Plan backlog / deadline feed |
| `lib/tasks/taskTransitions.ts` | 新增 | P0-03 | preview/apply/undo/reopen 纯函数 |
| `lib/tasks/taskViews.ts` | 修改 | P0-02 | 新视图集合、counts、riskOnly |
| `lib/tasks/taskHealth.ts` | 修改 | P0-02 | active blocks；timestamp overdue；closed null |
| `lib/tasks/taskRecurrence.ts` | 修改 | P0-03 | 下一次 occurrence 保留节奏、跳过错过 |
| `lib/planning/studyBlockLifecycle.ts` | 修改 | P0-03 | provenance；release 返回 IDs；legacy 标记 |
| `lib/reminders/*` | 修改 | P0-03 | cancelled 状态、取消/恢复 |
| `lib/history/types.ts` / `assignmentEvents.ts` | 修改 | P0-03 | submitted/doDate/onTime/restored |
| `store/useAppStore.ts` | 修改 | P0-01/03 | 新命令、旧 API 降级、normalize、persist v8 |
| `lib/dataDependencies.ts` | 修改 | P0-06 | 课程删除按 assignmentId 保护学习计划 |
| `lib/backupRestore.ts` / `lib/backup/*` | 修改 | P0-06 | manifest modelVersion 2；restore 选项 |
| `lib/analytics/*` | 修改 | P0-06 | reliability、submitted 计入、标签修正 |

### 6.2 UI

| 文件 | 动作 | Phase | 说明 |
|---|---|---|---|
| `app/page.tsx` | 修改 | P1-01 | 新 tab、路由映射、Plan 滚动例外 |
| `components/layout/navItems.ts` | 修改 | P1-01 | Today/Plan 图标与顺序 |
| `components/layout/Sidebar.tsx` / `BottomNav.tsx` | 修改 | P1-01 | 新导航、移动端 5 项 |
| `components/ui/PageTransition.tsx` | 修改 | P1-01 | 壳层稳定/内容过渡 |
| `components/today/*` | 新增 | P1-02–06 | Today 页面 |
| `components/plan/*` | 新增 | P2-02–09 | Plan 页面 |
| `components/dashboard/AssignmentTable.tsx` | 修改 | P0-04 | 新视图/行/完成语义 |
| `components/drawers/AssignmentDrawer.tsx` | 修改 | P0-04 | 状态 chip、命令、preview/reopen |
| `components/assignment/detail/*` | 修改 | P0-04 | 移除 progress slider/status dropdown |
| `components/modals/AddAssignmentModal.tsx` | 修改 | P0-04 | 移除 status/progress；submissionRequired/doDate |
| `components/assignment/QuickAddCard.tsx` | 修改 | P0-04 | 新默认/字段 |
| `components/dashboard/UpcomingDDL.tsx` | 修改 | P0-05 | overdue + active only |
| `components/dashboard/TimetableQuickGlance.tsx` | 修改 | P0-05 | occurrence resolver + active tasks |
| `components/dashboard/MiniCalendar.tsx` | 修改/退役 | P0-05/P1 | 旧页修复；新页用 WeekGlance/WeekPicker |
| `components/dashboard/overviewStudyBlockLayers.tsx` | 修改 | P0-05 | active only；occurrence resolver |
| `components/timeline/TimelineWorkspace.tsx` | 修改 | P0-05/P2 | 旧页修复；Plan 抽取 |
| `components/timeline/TimelineUnscheduledShelf.tsx` | 修改 | P0-05/P2-03 | 新 projection / PlanBacklog |
| `components/timeline/TimelineKeyLane.tsx` | 退役 | P2-04 | 水平轴移除 |
| `components/course/*` / `CourseDetailDrawer.tsx` | 修改 | P0-06 | 删除预览/资料关联/空态 |
| `components/settings/BackupSection.tsx` / `RestorePreviewDialog.tsx` | 修改 | P0-06 | 诚实备份 + warning |
| `components/analytics/*` | 修改 | P0-06 | reliability/文案 |
| `components/kiro/*` | 修改 | P0-07 | 写边界/队列/Action Card |
| `hooks/useKiroChat.ts` | 修改 | P0-07 | writeAccess + 新工具 |
| `lib/ai/tools/*` | 修改 | P0-07 | 新 schema/registry/executor/prepare |

### 6.3 测试

| 文件 | 动作 | Phase |
|---|---|---|
| `tests/taskLifecycle.test.ts` | 新增 | P0-02 |
| `tests/taskPlanning.test.ts` | 新增 | P0-02 |
| `tests/taskProjections.test.ts` | 新增 | P0-02 |
| `tests/taskTransitions.test.ts` | 新增 | P0-03 |
| `tests/taskReopenUndo.test.ts` | 新增 | P0-03 |
| `tests/taskRecurrenceV2.test.ts` | 新增 | P0-03 |
| `tests/reminderCancellation.test.ts` | 新增 | P0-03 |
| `tests/taskMigration.test.ts` | 新增 | P0-08 |
| `tests/backupManifest.test.ts` | 新增 | P0-06 |
| `tests/kiroTaskWriteBoundary.test.ts` | 新增 | P0-07 |
| `tests/e2e/today-*.spec.ts` | 新增 | P1-08 |
| `tests/e2e/plan-*.spec.ts` | 新增 | P2-10 |
| 现有 timeline/assignment/analytics 测试 | 更新 | P0-05/P2 |

---

## 7. 数据迁移与兼容

### 7.1 版本策略

- **Zustand persist version 保持 8。**
- 新增 `TASK_MODEL_VERSION = 2`，写入 backup manifest / debug；不参与 persist 拒载。
- 原因：
  - Phase 0 字段全部 optional/additive。
  - 旧构建能打开新数据；旧构建会忽略新字段（`normalizeAssignment` 丢弃未知字段），不会崩。
  - 避免 beta 变成单向迁移。
- 只有在未来做破坏性迁移（删除 `progress`、改变 status 枚举）时才 bump persist version。

### 7.2 归一化清单

`normalizeAssignment`：

- `doDate`：`YYYY-MM-DD` 真实日期；非法 → undefined。
- `submissionRequired`：boolean；缺失 → undefined（创建边界再补默认）。
- `submittedAt` / `completedAt`：本地墙钟字符串；非法 → undefined。
- `lastTerminalTransition`：逐字段清洗；非法 → undefined。
- `recurrenceSpawnedAt`：本地墙钟；非法 → undefined。
- `progress`：保留旧清洗，不再驱动状态。

`normalizeHydratedStudyBlock`：

- `releasedAt` / `releasedBy` / `releasedByTaskId` 清洗。
- 旧 released 无 provenance → `releasedBy: "legacy"`，不补 `releasedAt`。

`normalizeReminder`：

- 接受 `status: "cancelled"`。
- 清洗 `cancelledAt` / `cancelledByTaskId` / `cancelledReason`。
- 旧数据不变。

### 7.3 Fixtures

必须覆盖：

1. v7/v8 旧 Assignment：有 `progress`、无 `doDate`、无时间戳。
2. 旧 submitted/completed 任务 + 未来 active blocks。
3. 旧 `planningState="released"` 无 provenance。
4. 旧 reccurrence parent + child。
5. 旧 scheduled/fired/skipped reminders。
6. 脏 `doDate` / `submittedAt` / `lastTerminalTransition`。
7. 旧课程删除级联数据：任务已改课程但 StudyBlock.courseId 仍旧。
8. 旧备份 v1（无 Learning History / Kiro）。
9. 旧 backup 缺 studyBlocks / reminders / focusSessions。
10. 旧 Kiro 数据不受影响。

### 7.4 回滚

| 场景 | 操作 |
|---|---|
| Phase 0 beta 回滚 | `taskLifecycleV2=0`；旧页面/旧 API 继续；新字段保留但被旧代码忽略 |
| Phase 1 beta 回滚 | `todayPlanV1=0`；回旧 Overview；`taskLifecycleV2` 可保持 ON（旧页已迁移） |
| Phase 2 beta 回滚 | `todayPlanV1=0`；回旧 Timeline/Assignments |
| 回滚到旧构建 | persist v8 可直接加载；旧构建下次写入会丢弃新字段（可接受；先导出备份） |
| 数据异常 | 先导出业务备份；关闭 Flag；保留现场 IndexedDB/localStorage 供诊断 |

回滚前检查：

- 是否有用户已创建 `doDate` / `submittedAt` / `lastTerminalTransition`？旧构建会丢这些字段；提示“回滚后新规划字段不会保留”。
- 是否有 cancelled reminders？旧构建会忽略（只处理 scheduled），不会误触发。
- 是否有 `submissionRequired=true`？旧构建会忽略，主操作回到旧语义。

### 7.5 备份

- `ClassFlowBackup.version = 2`，`manifest.modelVersion = 2`。
- Phase 0 仍只备份业务数据 + 资料；manifest 明确 excluded。
- 旧 v1 备份可恢复，但显示 warning。
- Phase 1 再把 Learning History / Kiro 纳入备份；不在本工程 Phase 0–2 的首版范围。

---

## 8. Feature Flag 与灰度

### 8.1 Flags

| Flag | 作用 | 默认 | 依赖 |
|---|---|---|---|
| `taskLifecycleV2` | 新 selector/commands/surface 语义 | OFF（dev ON） | — |
| `todayPlanV1` | Today/Plan 新页面 | OFF | `taskLifecycleV2` 必须 ON |

实现：

- Build-time：`VITE_TASK_LIFECYCLE_V2` / `VITE_TODAY_PLAN_V1`。
- Beta override：`localStorage["classflow:flags"]` JSON。
- 不写入 backup；不进入业务数据。

### 8.2 Flag 矩阵

| taskLifecycleV2 | todayPlanV1 | 页面 | 数据/API |
|---|---|---|---|
| OFF | OFF | 旧 7 tab | 旧 API |
| ON | OFF | 旧 7 tab（已迁移 surface） | 新命令 |
| ON | ON | Today / Plan | 新命令 |
| OFF | ON | **禁止**；自动降级为 OFF/OFF | — |

### 8.3 灰度

1. Internal dev。
2. 5–10 名 beta 学生（2 周）。
3. 10% cohort。
4. 50%。
5. 100%。

Beta 观察：

- 数据异常/丢字段。
- 完成/撤销失败。
- Today 首屏是否真的更快开始。
- Plan 拖拽/周切换性能。
- 移动端安排流程。
- Kiro proposal 接受/撤销。

### 8.4 监控（本地优先）

ClassFlow 是本地优先产品，不默认上传遥测。Beta 采用：

- opt-in 诊断日志（本地导出）。
- Beta 访谈 + 日记。
- 本地事件计数（只在用户同意时导出）：
  - Today 首次动作时间。
  - 任务创建耗时。
  - 任务→时间块耗时。
  - 完成/撤销次数。
  - Plan my week 接受/取消。
  - 页面切换耗时。
- 不上传任务标题/课程名/资料内容。

### 8.5 Kill switch

- `todayPlanV1=0`：立即回旧页面；不丢数据。
- `taskLifecycleV2=0`：回旧 API；需要旧页面可用。
- 如果出现数据损坏：停止写入、提示导出备份、保留 localStorage/IndexedDB 快照。

---

## 9. 测试策略与 CI Gate

### 9.1 测试金字塔

**Unit（最多）**

- lifecycle selectors
- planning/remaining
- projections
- recurrence
- transition preview/apply/undo
- migration normalize
- capacity view
- layout/drag math

**Integration**

- store transaction atomicity
- History events
- reminder cancel/restore
- backup/restore
- Kiro write boundary
- Today/Plan controller

**E2E**

- Today 首屏/完成/时间线/移动端
- Plan 布局/拖拽/周切换/Inspector/Proposal/移动端安排
- 旧页 Flag OFF 回归

**Visual**

- Today 1440/1920/390
- Plan 1920/1440/1024/390
- 逾期/空态/超载/冲突/proposal

**A11y**

- axe：Today/Plan
- 键盘：J/K/Enter/Tab/方向键
- 读屏：Agenda 替代

**Performance**

- drag 60fps
- view switch <100ms
- week switch <180ms
- Today derive <16ms
- Backlog 2,000 tasks no jank

### 9.2 CI Gate

每个 PR：

```sh
npm run typecheck
npx vitest run <affected>
npm run build
```

Phase 0 Gate：

```sh
npm run typecheck
npx vitest run tests/task* tests/reminder* tests/backup* tests/planning*
npm run build
# 迁移 fixture + 旧页 smoke
```

Phase 1 Gate：

```sh
npx playwright test tests/e2e/today-*.spec.ts
# visual baseline + axe
```

Phase 2 Gate：

```sh
npx playwright test tests/e2e/plan-*.spec.ts
# visual baseline + axe + perf
```

全量回归只在 G0/G1/G2 或公共基础设施变更时跑，遵循仓库测试策略。

### 9.3 必测边界

- 今天 09:00 截止、现在 15:00。
- submitted 仍出现在旧页的问题。
- released block 仍被计数的问题。
- 4h 任务 + 1h block。
- 完成时 active focus。
- 完成时 2 个未来 blocks + 1 个 manual reminder。
- 撤销时 child 已修改。
- 重复任务逾期 3 周。
- 课程删除有 2 个小组项目。
- 任务改课程后删除旧课程。
- 备份 v1 恢复。
- Kiro Chat/Plan 尝试写。
- Kiro busy handoff。
- 移动端 390 首屏。
- Plan 1440 Inspector 覆盖不挤压日列。

---

## 10. Definition of Done

### 10.1 Phase 0

- 所有任务 surface 使用 canonical selector。
- `updateAssignmentStatus` / `updateAssignmentProgress` 不再被 UI/Kiro 调用。
- `transitionTask` preview/apply/undo/reopen 全绿。
- submitted 不出现在 Today/Plan/DDL/Reminder/Focus。
- released 不计 scheduled/health/capacity/overview。
- 4h/1h 任务显示剩余。
- 备份 preview 明确 warning；课程删除列出小组项目。
- Analytics partial 不再泄漏精确百分比。
- Kiro Chat/Plan 对业务写只读；terminal 走 preview。
- 旧页 Flag OFF 无回归。
- persist v8 兼容；旧构建可加载。

### 10.2 Phase 1

- Today 1440/1024/768/390 布局通过。
- 首屏 Now/Next + Attention + 第一组任务。
- 逾期 100% 可见；submitted 0 出现。
- 完成/提交 preview + undo + reopen。
- Today timeline 重叠并排、窗外 chip、空态不遮挡。
- Kiro Brief 本地生成；Plan my day 走 proposal。
- Capacity unknown≠0；超载 CTA。
- 今日任务点击打开 Drawer 并返回原位置。
- 旧 Overview 可回退。
- G1 全绿。

### 10.3 Phase 2

- Plan 1920/1440/1024/390 布局通过。
- 单一垂直时间轴；无水平 Key Lane。
- Backlog 拖入/移动/缩放/冲突/Undo。
- Inspector 任务/块/课程/空态；焦点回归。
- Plan Tasks 复用旧任务功能。
- Plan my week proposal ghost + accept + Undo；取消 0 写入。
- 移动端 Agenda + 安排到。
- 拖拽 60fps；视图切换 <100ms；周切换 <180ms。
- 旧 Timeline/Assignments 可回退。
- G2 全绿。

---

## 11. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| TimetableGrid 扩展破坏旧 Overview/Timeline | 中 | 高 | 先 spike；`variant=plan` 隔离；旧用法 snapshot 测试 |
| 拖拽性能 | 中 | 高 | rAF/transform；不 setState per move；性能 fixture |
| 状态保持实现复杂 | 中 | 中 | 先记忆滚动/筛选/展开；不做 keep-alive |
| 移动端功能缺失 | 中 | 高 | Agenda-first；“安排到…”；beta 手机测试 |
| AI proposal 部分写入 | 低 | 高 | preflight + atomic apply + undo；失败不部分写 |
| 迁移丢字段 | 低 | 高 | additive + fixtures；旧构建兼容；回滚导出 |
| 旧页测试漂移 | 高 | 中 | Flag 隔离；旧页 regression；分 PR 迁移 |
| 范围膨胀 | 高 | 高 | 严格按契约非目标；P1 功能不进 MVP |
| 单人前端 | 中 | 高 | 26–30 周；先 Phase 0 + Today（16–18 周） |
| Capacity 数据不足 | 中 | 中 | unknown≠0；不阻塞手动规划 |
| Kiro 配置/网络失败 | 中 | 中 | 手动规划仍可用；错误行内重试 |

---

## 12. 人员与并行

### 12.1 两周 Sprint 示例

**Sprint 1（Phase 0.1–0.2）**

- FE1：P0-01 + P0-02（types/selectors/projections）。
- FE2：P2-01 spike（TimetableGrid timeRange/hourHeight）+ Today 静态骨架预研。
- Designer：Today/Plan 视觉 token 对照；空态/文案。
- QA：迁移 fixture + selector 测试数据。

**Sprint 2（Phase 0.3–0.5）**

- FE1：P0-03（transition/undo/reopen/recurrence）。
- FE2：P0-04（AssignmentTable/Drawer/Modal）。
- QA：P0-03/04 集成测试。
- Designer：完成 preview/reopen 对话框视觉。

**Sprint 3（Phase 0.6–0.8 + Phase 1 启动）**

- FE1：P0-05（跨 surface）。
- FE2：P0-06/P0-07（trust/Kiro）。
- QA：Phase 0 gate。
- 之后进入 Today。

### 12.2 单前端降级方案

如果只有 1 FE：

- 先做 Phase 0 + Today（约 16–18 周），Plan 延后。
- Plan 的 Canvas 扩展先做 spike，不做完整三栏。
- 不建议同时改 Courses/Review/Groups。

---

## 13. Beta 与指标

### 13.1 Beta 计划

- 5–10 名真实学生，2 周。
- 覆盖：有课表/无课表、有 DDL/无 DDL、桌面/手机、Kiro 开启/关闭。
- 每日 5 分钟日记：
  - 今天打开后第一件事是什么？
  - 有没有找不到的任务/计划？
  - 完成/撤销有没有困惑？
  - Plan 拖拽是否卡？
  - 手机是否能完成安排？

### 13.2 指标

- 打开 → 第一次任务动作时间。
- 首屏任务可见率。
- 逾期任务首屏可见率。
- 任务→时间块完成时间。
- 计划覆盖率（remaining=0）。
- 完成/撤销/重开使用率。
- Plan my week 接受/取消/撤销。
- Today/Plan 页面切换耗时。
- 移动端安排完成率。

### 13.3 成功标准

- 首屏任务可见率 ≥95%。
- 逾期首屏可见率 100%。
- 任务→时间块中位时间 <30 秒。
- Plan my week 接受率 ≥50%（beta 样本）。
- 完成/撤销错误率 <1%。
- 无 P0 数据丢失。
- 拖拽 ≥55fps（p95）。

---

## 14. 待决工程问题

1. **TimetableGrid 扩展 vs 新 Canvas**
   - 建议：先 2 天 spike 扩展；如果 `variant=plan` 让组件超过 1400 行或旧用法回归，则抽 `PlanCanvas`，复用几何/拖拽库。
2. **TaskWorkspaceBody 抽取方式**
   - 建议：从 `AssignmentsWorkspace` 抽 body，`PlanTasksView` 复用；不复制列表。
3. **会话记忆实现**
   - 建议：滚动用 module-level ref/节流；筛选/展开用非持久化 Zustand。
4. **Focus actual 图层**
   - P1；Phase 2 先不做，保留 layer 开关占位。
5. **跨周拖拽 / 多选**
   - P1；MVP 用 Week Picker + 单块移动。
6. **备份完整历史/Kiro**
   - Phase 1；Phase 0 只做诚实 manifest + warning。
7. **Plan 三列断点**
   - 已定 ≥1880；如果 beta 笔记本多为 1680×1050，考虑把三列降到 1800 并缩 Inspector 到 320。

---

## 15. 前两周可执行清单

### Week 1

- [ ] 冻结 Phase 0 契约与验收表。
- [ ] 建迁移 fixtures（v7/v8、released、recurrence、reminders、backup v1）。
- [ ] P0-01：types + normalize + `TASK_MODEL_VERSION=2`。
- [ ] P0-02：lifecycle/planning selectors + 单测。
- [ ] P2-01 spike：TimetableGrid `hourHeight/timeRange` 原型（不合并）。
- [ ] Designer：Today/Plan 视觉 token 对照 + 空态文案。

### Week 2

- [ ] P0-03：`transitionTask` preview/apply/undo/reopen + 单测。
- [ ] P0-04：AssignmentTable 行/视图迁移（Feature Flag）。
- [ ] P0-05：UpcomingDDL + Timeline DDL/unscheduled 迁移。
- [ ] P0-06：备份 manifest/恢复 warning + 课程删除预览。
- [ ] P0-07：Kiro writeAccess 原型（Chat/Plan 只读）。
- [ ] QA：Phase 0 集成测试第一版。
- [ ] 周五：G0 预检，决定是否进入 Today。

---

## 16. 交付物清单

Phase 0：

- 代码：types/selectors/commands/migration/surface migration。
- 文档：本文件 + Phase 0 契约 + 迁移说明。
- 测试：单测/集成/迁移 fixture。
- Beta：Flag 配置 + 回滚说明。

Phase 1：

- 代码：Today 页面 + Shell/route/memory。
- 测试：Today E2E/visual/a11y。
- 文档：Today 交互规格（已有）+ 实现备注。

Phase 2：

- 代码：Plan 页面 + TimetableGrid 扩展 + Proposal。
- 测试：Plan E2E/visual/perf/a11y。
- 文档：Plan 交互规格（已有）+ 性能报告。

---

## 17. 结论

这份拆解的核心不是“排期”，而是**把风险放在正确的位置**：

- 数据风险在 Phase 0 解决，不带到 Today/Plan。
- 页面风险在 Phase 1/2 用 Flag + 旧页回退解决。
- AI 风险用 proposal + approval + undo 解决。
- 迁移风险用 additive + persist v8 + fixture 解决。
- 性能风险用 TimetableGrid spike + rAF 拖拽 + 独立 now line 解决。

按 2 FE 并行，**14–15 周**可交付 Today + Plan 的可用版本；如果只能投入 1 FE，建议先交付 Phase 0 + Today，再单独排 Plan。
