# Task Lifecycle & Data Truth Contract v1

> 状态：Phase 0 设计契约（方向已确认，未实现）
> 日期：2026-11-06
> 适用范围：Today / Plan / Tasks / Courses / Review / Kiro 的任务事实层
> 关联文档：`docs/task-v2-contract.md`、`docs/learning-analytics-v2.md`、`docs/learning-history-v1.md`、`docs/ui-product-system-v1.md`、`docs/motion-system-v6.md`

---

## 0. 契约一句话

**先让“任务是什么、什么时候算逾期、什么时候算完成、计划了多少、还剩多少”只有一个答案，再让 Today / Plan 去呈现它。**

这份契约不是 UI 稿，也不是实现代码。它定义 Phase 0 必须收口的 Domain 语义、事务边界、派生 selector、迁移策略和验收标准。Today / Plan 的高保真交互规格必须建立在这份契约之上。

### 0.1 十条不可违反的规则

1. **生命周期只有一个写入口**：`status` 只能由 `transitionTask()` 改变；`progress`、子任务、批量操作、Kiro 都不能直接写 `status`。
2. **`submitted` / `completed` 都是 planning terminal**：不再进入 Today、Plan、Upcoming DDL、Timeline DDL、MiniCalendar DDL；不再允许新增 StudyBlock、Reminder、Focus。
3. **逾期只按截止时刻判断**：只有 `todo` / `doing` 会逾期；`submitted` / `completed` 永不逾期。
4. **released StudyBlock 不是计划**：不占容量、不计 `scheduledMinutes`、不参与 Health、不出现在 Overview 学习块图层、不进入 Plan 活跃层。
5. **“已安排”按剩余工作量判断**：`scheduledMinutes` 只统计 active blocks；`remainingMinutes` 决定 unscheduled / partial / full。
6. **完成/提交是一次可预览、原子、可恢复的事务**：先 `preview`，再 `apply`，再 `undo` / `reopen`；不能是状态下拉框的副作用。
7. **重复任务每个 occurrence 最多生成一次下一次**：在第一次 terminal 动作时生成；幂等；撤销时只在 child 未被修改时删除。
8. **`doDate` 与 `ddl` 分离**：`doDate` 是“我打算哪天做”，`ddl` 是“最晚什么时候交”；Today 两者都认。
9. **所有 surface 使用同一组 selector**：禁止各页面自己比较 `status !== "completed"`、自己算逾期、自己统计 blocks。
10. **AI 与 UI 走同一套命令**：Kiro 不能绕过 `transitionTask` / `setTaskDoDate` / `toggleSubtask`；Chat / Plan 模式对业务数据只读，写操作必须提案 + 用户批准。

补充一条认识论规则：**Unknown ≠ Zero**。没有估时、没有可靠 DDL、没有完成时间、没有历史覆盖时，显示“未知 / 已记录 / —”，不要伪造 0、100% 或“已完成”。

---

## 1. 现状：四个“真相源”在互相打架

### 1.1 代码证据

| 问题 | 当前实现 | 后果 |
|---|---|---|
| 三套完成度写入口 | `updateAssignmentStatus`、`updateAssignmentProgress`、`toggleSubtask` 都会改 `status`（`store/useAppStore.ts:2033-2233`） | 已完成但进度 0%；重新打开但进度 100%；勾一个子任务把已完成任务重新打开 |
| `submitted` 半归档 | 任务工作区把 submitted 当 archive（`lib/tasks/taskViews.ts:71-72`），但 UpcomingDDL 只排除 completed（`components/dashboard/UpcomingDDL.tsx:46-52`），Timeline 也只排除 completed（`lib/timeline/deriveTimelineItems.ts:41-45`） | 已提交任务仍出现在临近 DDL、时间轴、日历点；不同页面给出不同答案 |
| 逾期两套口径 | 列表按日历日差（`components/dashboard/AssignmentTable.tsx:528-533`）；Health 按截止时刻（`lib/tasks/taskHealth.ts:87-91`） | 今天 09:00 截止、现在 15:00 的任务，列表不标逾期，详情说逾期 |
| released 仍被计数 | `buildTaskWorkspaceMetaWithIndex` 统计全部 blocks（`lib/tasks/taskViews.ts:110-135`）；Health 统计全部 blocks（`lib/tasks/taskHealth.ts:104-111`）；Overview 图层不过滤（`components/dashboard/overviewStudyBlockLayers.tsx:63-70`） | 任务提交后重新打开，页面说“已计划”，但 Drawer/Timeline 说计划已释放 |
| “已安排”= 任意一个 block | `deriveUnscheduledAssignments` 只要有 active block 就排除（`lib/timeline/deriveTimelineItems.ts:124-134`） | 4 小时任务拖 1 小时就从待安排消失，剩余 3 小时没有任何提示 |
| 完成事务不可逆 | 进入 submitted/completed 会清 scheduled reminders、释放未来 StudyBlocks、生成重复子项（`store/useAppStore.ts:2045-2073`），重新打开不恢复 | 误点完成 = 永久丢提醒/计划；重复子项已生成 |
| 重复任务从旧 DDL 推进 | `buildNextRecurringAssignment` 从原 DDL 加一个周期（`lib/tasks/taskRecurrence.ts:67-94`） | 逾期很久后完成，生成的下一次仍然已经过期 |
| Kiro 可绕过生命周期 | `KIRO_WRITE_TOOLS` 始终在 base tool set（`lib/ai/tools/index.ts:174-176`）；`set_assignment_status/progress` 直接调 store（`lib/ai/tools/write/prepare.ts:209-245`） | “仅规划”仍能写业务数据；三套状态写入口被 AI 放大 |
| 备份不完整且恢复清历史 | `BackupSection` 只导出业务数据 + 资料（`components/settings/BackupSection.tsx:54-70`）；`restoreAppData` 先 `resetLearningHistoryForDomainReset()`（`store/useAppStore.ts:1317-1320`） | “完整备份”名不副实；恢复后洞察历史消失且预览没有提示 |
| 删除课程静默级联小组项目 | `collectCourseDeleteCascade` 收集 groupProjects（`lib/dataDependencies.ts:150`），确认文案只说排课/任务/资料（`components/drawers/CourseDetailDrawer.tsx:235-244`） | 用户清理课程时，小组项目、成员、任务一起消失，无法撤销 |

### 1.2 为什么必须 Phase 0 先做

Today 的首屏要回答“现在做什么”，Plan 要回答“这周排不排得下”。这两个问题都依赖同一组事实：

- 这个任务现在算不算逾期？
- 这个任务到底完成没有？
- 这个任务已经排了多少、还剩多少？
- 这些学习块还算不算计划？
- 完成这个任务会连带发生什么？

如果这些事实不统一，Today/Plan 越漂亮，错误越明显。**Phase 0 的交付物不是视觉稿，而是这份契约 + 可执行的 selector / command / migration。**

---

## 2. 任务生命周期 V2

### 2.1 状态机

```text
                    ┌──────────────┐
                    │     todo     │
                    └──────┬───────┘
                           │ start
                           ▼
                    ┌──────────────┐
          reopen    │    doing     │
       ┌────────────└──────┬───────┘
       │                   │
       │        ┌──────────┴──────────┐
       │        │ submit              │ complete
       ▼        ▼                     ▼
  ┌──────────────┐   complete   ┌──────────────┐
  │  submitted   │─────────────▶│  completed   │
  └──────────────┘              └──────────────┘
       │                              │
       └──────────── reopen ──────────┘
```

### 2.2 状态定义

| 状态 | 语义 | planning eligible | 进入 Today / Plan / DDL | 允许新 StudyBlock / Reminder / Focus |
|---|---|---|---|---|
| `todo` | 待开始 | 是 | 是（按 Today/Plan 规则） | 是 |
| `doing` | 进行中 | 是 | 是（按 Today/Plan 规则） | 是 |
| `submitted` | 已提交，等待反馈/成绩 | 否 | 否 | 否 |
| `completed` | 已完成/已关闭 | 否 | 否 | 否 |

`submitted` 不是“完成”的同义词，也不是“归档”的同义词：

- 它表示**学生已经交了，但还在等反馈**。
- 它保留在“等待反馈”视图，不进入任何行动队列。
- 它可以长期停留；不强制自动转 completed。
- 它可以在用户明确操作下 `submitted → completed`（确认完成/收到反馈）。
- 它可以被明确 `reopen` 回 active，恢复可编辑/可规划。

### 2.3 合法迁移

| From | To | 触发 | 前置条件 | 副作用 |
|---|---|---|---|---|
| `todo` | `doing` | 开始 | 无 | 只改 status；写 History |
| `doing` | `todo` | 放回待开始 | 无 | 只改 status；写 History |
| `todo` / `doing` | `submitted` | 提交 | 无 active focus；通过 preview | 时间戳、释放未来 blocks、取消提醒、可能生成重复 child |
| `todo` / `doing` | `completed` | 完成 | 无 active focus；通过 preview | 时间戳、释放未来 blocks、取消提醒、可能生成重复 child |
| `submitted` | `completed` | 确认完成 | 通过 preview | 只补 `completedAt`；不重复释放/取消/生成 child |
| `submitted` | `doing` / `todo` | 重新打开 | 通过 reopen preview | 恢复可选 blocks/reminders；清 `submittedAt`；可能删除 pristine child |
| `completed` | `doing` / `todo` | 重新打开 | 通过 reopen preview | 恢复可选 blocks/reminders；清 `completedAt`；可能删除 pristine child |
| 任意 | 相同状态 | no-op | 无 | 0 副作用、0 History |
| `completed` | `submitted` | 禁止 | — | 先 reopen 到 active，再重新提交 |

`todo → submitted` 和 `todo → completed` 都允许；不是所有任务都必须先 doing。

### 2.4 `submissionRequired`

新增字段：

```ts
submissionRequired?: boolean; // 默认规则见下
```

它只决定**主操作**，不决定数据模型：

- `submissionRequired: true`：任务行的主操作是“提交” → `submitted`；详情主按钮也是“提交”。
- `submissionRequired: false`：主操作是“完成” → `completed`。
- 任何任务都可以通过“更多”菜单显式“标记已提交”，即使 `submissionRequired` 为 false。
- 任何 active 任务都可以通过“更多”菜单“直接完成”，即使 `submissionRequired` 为 true；preview 会提示“此任务标记为需要提交，直接完成会跳过等待反馈”。

默认值：

- 新建任务时 `courseId` 非空 → `true`（课程作业默认有提交动作）。
- 新建任务时 `courseId` 为空 → `false`（个人任务默认直接完成）。
- 显式传入值优先。
- 旧数据迁移为 `false`，避免改变已有任务的一键完成行为。

### 2.5 `doDate`（今天做）

新增字段：

```ts
doDate?: string; // 本地日期 "YYYY-MM-DD"，无时间
```

语义：

- “我打算在这一天推进这个任务”，是**规划意图**，不是 deadline。
- 不创建 CalendarMark，不创建 Reminder，不自动创建 StudyBlock。
- 与 `ddl` 独立：可以先做后交，也可以今天做但下周才截止。
- 与 StudyBlock 独立：`doDate` 是日级意图，StudyBlock 是时间级安排；两者可以同时存在。
- 可以在任务详情、任务行右键、Quick Add、批量操作中设置。
- 关闭状态（submitted/completed）不允许设置；重新打开后可设置。
- `doDate` 晚于 `ddl` 的日期时，显示警告“这一天晚于截止时间”，但不阻止。
- 重复任务生成下一次时，`doDate` 按同一 recurrence 规则推进到 terminal 时间之后的第一个 occurrence；没有 `doDate` 则保持 undefined。

### 2.6 `progress` 的处置

**Phase 0 起，`progress` 不再驱动任何状态，也不再作为主 UI 的完成度。**

规则：

- `Assignment.progress` 字段暂时保留，标记 `@deprecated`，用于旧数据兼容；不再有 `updateAssignmentProgress` 公共 action。
- 有子任务时，UI 显示 `已完成子任务 / 总子任务`（例如 `3 / 5`），不显示百分比。
- 无子任务时，UI 不显示百分比；显示 status chip + 预计耗时 + 已排/剩余。
- 勾选/取消子任务：
  - 只改 `subtasks[].completed`。
  - 不写 `status`。
  - 不写 `progress`。
  - 全部子任务完成时，显示 inline 建议“子任务已全部完成，标记完成？”，由用户显式触发 terminal transition。
- submitted/completed 任务的子任务列表只读；要编辑先 reopen。
- 旧 `progress` 值不迁移成 status，不伪造完成时间；保留在 JSON 中，Phase 1 可清理。

### 2.7 时间戳

新增：

```ts
submittedAt?: string;  // 本地墙钟 "YYYY-MM-DDTHH:mm:ss"
completedAt?: string;  // 本地墙钟 "YYYY-MM-DDTHH:mm:ss"
```

规则：

- 进入 `submitted` 时写 `submittedAt`；重新提交时覆盖为最新一次。
- 进入 `completed` 时写 `completedAt`；重新完成后覆盖为最新一次。
- `submitted → completed` 时只写 `completedAt`，保留 `submittedAt`。
- reopen 时清空当前状态的 `submittedAt` / `completedAt`；历史由 Learning History 保留。
- 旧数据没有时间戳 → 保持 undefined；不伪造。Analytics 对旧数据使用历史事件的 `occurredAt`（如果存在），否则按 unknown 处理。
- 定义学术完成时间：
  ```ts
  academicDoneAt = submittedAt ?? completedAt ?? null
  ```
  用于“按时完成”和 Review 的完成口径。

### 2.8 `lastTerminalTransition`（每任务一份小型恢复账本）

新增：

```ts
export type TaskTransitionSource = "ui" | "batch" | "kiro" | "recurrence" | "migration";

export interface TaskTerminalTransition {
  id: string;
  at: string; // 本地墙钟
  fromStatus: AssignmentStatus;
  toStatus: "submitted" | "completed";
  /** terminal 之前的 active 状态，reopen 时优先恢复它 */
  activeStatusBeforeTerminal: "todo" | "doing";
  releasedStudyBlockIds: string[];
  cancelledReminderIds: string[];
  generatedRecurrenceId?: string;
  batchId?: string;
  source: TaskTransitionSource;
}

interface Assignment {
  // ...
  lastTerminalTransition?: TaskTerminalTransition;
  recurrenceSpawnedAt?: string;
}
```

作用：

- 让 `undo` / `reopen` 不需要查询 IndexedDB 历史，也不依赖可能已被清理的 Learning History。
- 记录“这次 terminal 动作到底影响了哪些 block / reminder / recurrence child”。
- 批量操作通过 `batchId` 聚合撤销。

`submitted → completed` 时：

- 新 transition 的 `fromStatus = "submitted"`、`toStatus = "completed"`、`at = now`。
- **继承**上一条 transition 的 `activeStatusBeforeTerminal`、`releasedStudyBlockIds`、`cancelledReminderIds`、`generatedRecurrenceId`。
- 这样从 completed 重新打开时，恢复的是整条 terminal 链的副作用，而不是只恢复最后一步。

reopen 成功后清空 `lastTerminalTransition`；历史仍保留在 Learning History。

---

## 3. StudyBlock 生命周期与“计划事实”

### 3.1 active / released

沿用现有 `planningState`：

```ts
planningState?: "released";
```

新增 provenance：

```ts
releasedAt?: string; // 本地墙钟
releasedBy?: "task-submitted" | "task-completed" | "manual" | "rebalance" | "legacy";
releasedByTaskId?: string;
```

规则：

- `planningState !== "released"` = active。
- active block 才占容量、才算 `scheduledMinutes`、才参与 Health、才出现在 Plan 活跃层。
- released block 是历史快照：可查看、可打开原任务、可删除；不占容量、不制造冲突、不参与 Rebalance / Focus anchor。
- 旧数据中被 reconcile 释放但没有 provenance 的 blocks 标记 `releasedBy: "legacy"`；reopen 不会自动恢复它们，因为无法证明是这次 terminal 动作释放的。
- `StudyBlockCreateInput` / `StudyBlockUpdatePatch` 必须排除生命周期字段：
  ```ts
  type StudyBlockLifecycleField =
    | "planningState"
    | "releasedAt"
    | "releasedBy"
    | "releasedByTaskId";
  ```
- 所有调用方必须通过 `isStudyBlockPlanningActive()` 判断，禁止直接比较 `planningState` 字面量。

### 3.2 计划覆盖度

定义：

```ts
plannedActiveMinutes(taskId) =
  sum(duration(b) for b in studyBlocks
      where b.assignmentId === taskId
        and isStudyBlockPlanningActive(b))

remainingMinutes =
  task.estimatedMinutes != null
    ? max(0, task.estimatedMinutes - plannedActiveMinutes(taskId))
    : null

type TaskSchedulingState =
  | "unscheduled" // 没有 active block
  | "partial"     // 有 active block，有估时，remaining > 0
  | "full"        // 有估时，remaining === 0
  | "unknown";    // 有 active block，但没有估时
```

规则：

- **`unscheduled` 不再等于“一个 block 都没有”**。`partial` 也要进入待安排/Backlog，并显示“剩余 3h”。
- `unknown` 不能被当成“已排满”；UI 显示“已排 1 段 · 未估时”，Health 返回 unknown。
- `scheduledMinutes`、`studyBlockCount`、`scheduledToday` 在所有任务视图、Peek、Health、Overview 图层中只统计 active blocks。
- `freeTime` / capacity / rebalance 继续只认 active blocks（现有 `isStudyBlockPlanningActive` 语义）。
- `released` blocks 只在“历史计划”计数中出现（如任务详情的“已释放 N 个旧计划”）。

### 3.3 释放事务

`releaseFutureStudyBlocksForAssignment` 改为：

- 只释放 linked 且 `end > now` 的 blocks（未结束：未来或进行中）。
- 已结束的 blocks 保持原样（历史证据）。
- 写入 `releasedAt`、`releasedBy`、`releasedByTaskId`。
- 返回 `releasedIds`。
- 幂等：已 released 的 block 不重复改。

释放后：

- 任务视图不再统计它们。
- Health 不再统计它们。
- Overview / Timeline 活跃层不再绘制。
- 相关 StudyBlock reminders 取消（见第 4 节）。

### 3.4 任务健康

`deriveAssignmentHealth` 的输入必须是 active blocks；`deriveAssignmentHealthV2`：

- 对 submitted/completed 返回 `null`（不显示 Health）。
- 逾期按截止时刻：`deadline.getTime() < now.getTime()`。
- 已排分钟只统计截止前的 active blocks。
- `remainingMinutes` 用 `estimatedMinutes - scheduled`，不读 `progress`。
- 无 DDL / 无估时 → `unknown`。
- 部分已排 → `attention`。
- 可用时间 < remaining → `at-risk`。
- 已排满 → `safe`。

`TaskHealthState` 不新增 `"closed"`；closed 任务直接不计算 Health，避免 UI 出现“未知”误解。

---

## 4. Reminder 生命周期

### 4.1 新增状态与 provenance

```ts
export type ReminderStatus = "scheduled" | "fired" | "skipped" | "cancelled";

interface Reminder {
  // ...
  cancelledAt?: string;
  cancelledByTaskId?: string;
  cancelledReason?:
    | "task-submitted"
    | "task-completed"
    | "task-deleted"
    | "study-block-released"
    | "manual";
}
```

### 4.2 terminal 动作的清理规则

进入 `submitted` / `completed` 时：

- `source: "manual" | "kiro"` 的 scheduled reminders → `status = "cancelled"` + provenance，**不删除**。
- `source: "auto"` 的 scheduled reminders → 删除（派生数据，可由 `reconcileAllAuto` 重建）。
- StudyBlock reminders 随 block release 同样处理：
  - manual/kiro → cancelled + `cancelledByTaskId` / `cancelledReason: "study-block-released"`。
  - auto → 删除。
- fired / skipped 历史保持不动。

这样做的原因：

- 用户手建的提醒是有价值的数据，不能因为一次误点完成就永久消失。
- auto 提醒是 DDL 的派生结果，删除后不会膨胀；reopen 时 `reconcileAllAuto` 会按当前 DDL 重建。
- cancelled 状态在 Reminder Center 默认隐藏；Reminder Runtime 只处理 `scheduled`，不会误触发。

### 4.3 reopen 恢复规则

`restoreCancelledRemindersForTask(taskId, transitionAt, now)`：

- 只恢复 `status === "cancelled"`、`cancelledByTaskId === taskId`、`cancelledAt >= transitionAt` 的 manual/kiro reminders。
- `triggerAt > now` 才恢复；已过去的不恢复（避免立即补发）。
- 目标 anchor 仍有效（任务存在 / block 仍 active）才恢复。
- 去重：同一 target + offset + triggerAt 已有 scheduled → 不重复。
- 恢复时清空 `cancelledAt` / `cancelledByTaskId` / `cancelledReason`，`status = "scheduled"`。

### 4.4 不允许的写入

- `submitted` / `completed` 任务不允许新增 assignment reminder。
- `released` StudyBlock 不允许新增 relative reminder。
- `AssignmentReminderSection` 对 closed 任务隐藏“添加提醒”，显示“任务已提交/完成，重新打开后可添加提醒”。
- Kiro `create_reminder` / `update_reminder` 对 closed target 返回明确错误，不静默降级。

---

## 5. 重复任务 V2

### 5.1 触发时机

在**第一次 terminal 动作**时生成下一次：

- `submissionRequired: true`：`submitted` 时生成。
- `submissionRequired: false`：`completed` 时生成。
- 手动 `submitted` 的任意任务：`submitted` 时生成。
- `submitted → completed`：不重复生成。

幂等键：

```ts
Assignment.recurrenceSpawnedAt?: string;
```

`spawnRecurringChild` 的条件：

1. task 有 `recurrence` 和有效 `ddl`。
2. task 是第一次进入 terminal（`lastTerminalTransition` 为空或 `generatedRecurrenceId` 为空）。
3. `recurrenceSpawnedAt` 为空。
4. 不存在 `recurrenceParentId === task.id` 的 child（兼容旧数据）。

任一条件不满足 → 不生成。

生成时在同一个 store transaction 中：

- 设置 parent `recurrenceSpawnedAt = now`。
- 创建 child，写入 `recurrenceParentId = parent.id`。
- child `status = "todo"`、`progress = 0`、子任务全部未完成。
- child 复制 `courseId / title / description / estimatedMinutes / priority / tags / materialIds / recurrence / recurrenceSeriesId / submissionRequired`。
- child 不复制 StudyBlocks（新 occurrence 重新安排）。
- 创建 child 的 linked DDL CalendarMark。

### 5.2 下一次 DDL：保留节奏，跳过已错过的 occurrence

当前实现是“原 DDL + 一个周期”，逾期很久后完成会生成一个仍然过期的下一次。改为：

```ts
nextRecurringOccurrenceAfter(anchorDdl, recurrence, after: Date): string | null
```

规则：

- daily / weekly / biweekly：从 anchor 开始按周期推进，直到 **严格大于 `after`** 的第一个 occurrence。
- monthly：从 anchor 的“日”开始，逐月推进并 clamp 到目标月最后一天，直到严格大于 `after`。
- 保留原 `HH:mm:ss`。
- `after = terminalAt`（提交/完成时刻）。
- 这样：
  - 周一 23:59 的 weekly 任务，周三提交 → 下周一 23:59（保持周一节奏）。
  - 逾期 3 周才提交 → 提交后的下一个周一（跳过已错过的周，不生成一串逾期任务）。
- 如果 anchor 本身无效 → 不生成。
- 月度 1 月 31 日 → 2 月最后一天，后续继续按目标月 clamp。

### 5.3 `doDate` 推进

如果 parent 有 `doDate`：

- `nextDoDate = nextRecurringOccurrenceAfter(doDate, recurrence, terminalAt)`。
- 保留“周几做”的节奏。
- 如果 nextDoDate 晚于 nextDdl，保留并显示警告；不阻止。

### 5.4 撤销 / reopen

- 如果 `lastTerminalTransition.generatedRecurrenceId` 指向的 child 仍是 **pristine**：
  - pristine = child 仍为 `todo`、没有 StudyBlock、没有 Reminder、没有子任务被勾选、没有字段被编辑。
  - undo / reopen 可以选择删除该 child。
  - 删除后清空 parent `recurrenceSpawnedAt`，允许未来重新生成。
- 如果 child 已被修改：
  - 保留 child。
  - parent `recurrenceSpawnedAt` 保持。
  - UI 明确提示“下一次重复任务已存在，重新打开会产生两个待办”。
- 如果 child 已被删除：
  - parent `recurrenceSpawnedAt` 仍然阻止再次生成；用户如需要，可手动新建。

### 5.5 Phase 0 不做的重复能力

- 系列视图 / 系列编辑。
- 跳过下一次 / 暂停系列。
- 结束日期 / 次数上限。
- “只改这一次 / 改整个系列”的完整语义。
- 自定义 weekly weekday。

这些是 P1，不进入 Phase 0 验收。

---

## 6. 统一派生 selector

新增模块建议：

- `lib/tasks/taskLifecycle.ts`：状态判定、时间戳、academicDoneAt。
- `lib/tasks/taskPlanning.ts`：active blocks、planned/remaining、schedulingState。
- `lib/tasks/taskProjections.ts`：Today / Plan backlog / deadline feed。
- `lib/tasks/taskTransitions.ts`：preview / apply / undo / reopen 的纯函数部分。

### 6.1 基础 selector

```ts
export function isActiveTask(t: Pick<Assignment, "status">): boolean;
export function isWaitingTask(t: Pick<Assignment, "status">): boolean;
export function isCompletedTask(t: Pick<Assignment, "status">): boolean;
export function isClosedTask(t: Pick<Assignment, "status">): boolean;
export function isPlanningEligible(t: Pick<Assignment, "status">): boolean;

export function academicDoneAt(t: Assignment): string | null;
export function isTaskOverdue(t: Assignment, now: Date): boolean;
export function isDueToday(t: Assignment, now: Date): boolean;
export function isDueSoon(t: Assignment, now: Date, warningDays: number): boolean;
export function isDoToday(t: Assignment, now: Date): boolean;
export function isDoInWeek(t: Assignment, weekDates: string[]): boolean;

export function isActiveBlock(b: StudyBlock): boolean;
export function activeBlocksForTask(t: Assignment, blocks: StudyBlock[]): StudyBlock[];
export function plannedActiveMinutes(t: Assignment, blocks: StudyBlock[]): number;
export function remainingMinutes(t: Assignment, blocks: StudyBlock[]): number | null;
export function schedulingState(t: Assignment, blocks: StudyBlock[]): TaskSchedulingState;
```

### 6.2 截止语义

统一函数：

```ts
export function isTaskOverdue(t, now) {
  return isActiveTask(t)
    && hasTaskDeadline(t)
    && getTaskDeadline(t)!.getTime() < now.getTime();
}
```

边界：

- DDL 是本地墙钟，不做 UTC 转换。
- 新数据必须带时间；旧数据只有日期时，按当天 `23:59:00` 解释（读取时补，不写回），避免午夜误判逾期。
- 今天 09:00 截止、现在 15:00 → overdue；`dueToday` 也为 true，但 Today 只归入 overdue 组，不重复。
- 今天 23:59 截止、现在 15:00 → 不是 overdue；`dueToday` true。
- submitted/completed → overdue 永远 false。
- 重新打开后 DDL 已过 → 立即 overdue。

### 6.3 按时完成

```ts
onTime =
  ddl != null && academicDoneAt != null
    ? academicDoneAt <= ddl
    : null;
```

- submitted 用 `submittedAt`；直接 completed 用 `completedAt`；submitted → completed 仍用 `submittedAt`。
- 无 DDL / 无完成时间 → null（unknown，不进分母）。
- 旧数据没有 `submittedAt/completedAt` 时，Analytics 可用历史事件的 `occurredAt` 作为完成时间；当前任务详情不伪造时间。

### 6.4 Today 投影

```ts
export interface TodayProjection {
  groups: {
    overdue: TaskWorkspaceItem[];
    dueToday: TaskWorkspaceItem[];
    doToday: TaskWorkspaceItem[];
    scheduledToday: TaskWorkspaceItem[];
  };
  /** 去重后的任务数 */
  taskCount: number;
  /** 今天所有 active StudyBlock 分钟 */
  plannedMinutes: number;
  /** 今天任务中尚未安排到今天的剩余分钟（不重复计已有 block） */
  unplannedMinutes: number;
  /** 等待反馈数量，仅用于底部轻量入口 */
  waitingCount: number;
}
```

归组优先级（每个任务只出现一次）：

1. **overdue**：`isTaskOverdue`
2. **dueToday**：`isDueToday` 且非 overdue
3. **doToday**：`doDate === today` 且未在前两组
4. **scheduledToday**：今天有 active block 且未在前三组

排序：

- overdue：DDL 升序（最早逾期在前）
- dueToday：DDL 时间升序
- doToday：priority（urgent→low），再 DDL
- scheduledToday：block 开始时间升序

排除：

- submitted / completed
- released blocks 不计入 plannedMinutes
- 没有 `doDate`、没有今天 DDL、没有今天 active block 的 doing 任务**不进入 Today**（放到 Tasks 的 All / Doing，或 Plan backlog）

底部轻量入口：

- `等待反馈 N` → 打开 Tasks 的 Waiting 视图。
- 不在 Today 主列表展开 waiting 任务，避免行动队列被非行动项污染。

### 6.5 Plan Backlog 投影

```ts
export interface PlanBacklogProjection {
  buckets: {
    overdue: TaskWorkspaceItem[];
    dueThisWeek: TaskWorkspaceItem[];
    needsScheduling: TaskWorkspaceItem[];
  };
  counts: { overdue: number; dueThisWeek: number; needsScheduling: number };
}
```

输入包含 `selectedWeekDates`（当前 Plan 正在看的周）和 `now`。

归组优先级（每个任务只出现一次）：

1. **overdue**：`deadline < now`（永远按真实 now，不因浏览未来周而消失）
2. **dueThisWeek**：DDL 日期落在 `selectedWeekDates` 内，且非 overdue
3. **needsScheduling**：active 且 `schedulingState !== "full"`，且未在前两组

排序：

- overdue：DDL 升序
- dueThisWeek：DDL 升序，priority
- needsScheduling：DDL 升序（无 DDL 在后），priority，remainingMinutes 降序

排除：

- submitted / completed
- fully scheduled 的任务不进入 needsScheduling（但仍可能出现在 dueThisWeek，用于“这周要交”的提醒）
- released blocks 不计入任何计划覆盖度

### 6.6 任务工作区视图

Phase 0 收敛为：

```ts
export type TaskWorkspaceView =
  | "today"
  | "upcoming"
  | "unscheduled"
  | "waiting"
  | "completed"
  | "all";
```

移除/映射：

- `focus` → 退役；旧的“聚焦”命令映射到 `today`。
- `at-risk` → 不再是视图，变成 `riskOnly` 过滤器（可在 Today / Upcoming / Unscheduled / All 使用）。
- `archive` → 退役；拆成 `waiting` 和 `completed`。
- `defaultTaskWorkspaceView` 持久化值迁移：`focus → today`、`at-risk → today`、`archive → completed`。

视图规则：

| 视图 | 内容 | 排序 |
|---|---|---|
| `today` | 与 Today 投影同一组任务，列表形式 | overdue → dueToday → doToday → scheduledToday |
| `upcoming` | 所有有 DDL 的 active 任务，分组：逾期 / 今天 / 未来 7 天 / 更晚 | DDL 升序 |
| `unscheduled` | `schedulingState !== "full"` 的 active 任务 | overdue → DDL → priority → remaining 降序 |
| `waiting` | submitted | `submittedAt` 降序，缺失在后 |
| `completed` | completed | `completedAt` 降序，缺失在后 |
| `all` | 全部，分组：进行中 / 等待反馈 / 已完成 | active 按 focus 排序；waiting/completed 按时间倒序 |

计数：

- Tab count = 当前课程筛选 + `riskOnly` 后的 domain count，**不含搜索词**。
- 搜索时显示“当前视图 N 个结果”，Tab 数字不随搜索变化。
- Header 的“N 项未完成”只算 `todo + doing`，不含 submitted。

`riskOnly`：

- 过滤 `health === "at-risk" || health === "overdue"`。
- 对 closed 任务无意义，自动排除。
- 不再有“孤儿视图”：Command Center 的“有风险”命令映射到 `all` + `riskOnly: true`，或 `today` + `riskOnly`。

### 6.7 跨 surface 真相表

| Surface | 必须使用的 selector | 必须排除 | 备注 |
|---|---|---|---|
| Today 主列表 | `buildTodayProjection` | submitted/completed/released blocks | 逾期必须出现 |
| Today 等待反馈入口 | `waitingCount` | active | 只显示数量/链接 |
| Upcoming DDL 卡片 | `buildDeadlineFeed` | submitted/completed | 逾期置顶，不隐藏 |
| Quick Glance | `buildTodayProjection` + occurrence resolver | submitted/completed | 课程/任务/DDL 同源 |
| MiniCalendar DDL 点 | `isActiveTask` + `hasTaskDeadline` | submitted/completed | 今天的 agenda 加“逾期”组 |
| Timeline Key Lane DDL | `isActiveTask` | submitted/completed | linked mark 不重复 |
| Plan Backlog | `buildPlanBacklogProjection` | submitted/completed/released | 部分安排显示剩余 |
| Tasks 工作区 | `deriveTaskWorkspace` V2 | 按视图 | 所有视图共用 selector |
| Task Peek | `TaskWorkspaceMetaV2` | released | 不再显示旧计划为“已计划” |
| Task Health | `deriveAssignmentHealthV2` | released / closed | closed 返回 null |
| Course 卡片待处理 | `isActiveTask` | submitted/completed | 已有 correct 语义，统一复用 |
| Overview 学习块图层 | `isActiveBlock` | released | 空态不能遮挡计划 |
| Analytics / Review | `academicDoneAt` + reliability | 无可靠数据不进分母 | submitted 计入“完成/提交” |
| Search / Command | `isActiveTask` / `isClosedTask` | 按结果类型 | 显示状态 chip |
| Reminder Center | `status === "scheduled"` | cancelled/fired/skipped | closed 任务不新增提醒 |
| Kiro read tools | 同上 | 同上 | 与页面同源 |
| Kiro write tools | `transitionTask` 等命令 | 直接 set status/progress | 提案 + 批准 |
| Group（Phase 0） | 现有 group selector | — | 明确标注“不含小组任务” |

---

## 7. 完成 / 提交事务

### 7.1 Preview（无副作用）

```ts
export type TaskTerminalStatus = "submitted" | "completed";

export interface TaskTransitionPreview {
  taskId: string;
  transitionId: string;
  fromStatus: AssignmentStatus;
  toStatus: TaskTerminalStatus;
  academicDoneAt: string;
  sideEffects: {
    releaseStudyBlocks: { count: number; minutes: number; ids: string[] };
    cancelReminders: { count: number; manualCount: number; autoCount: number; ids: string[] };
    recurrence: {
      willGenerate: boolean;
      nextDdl?: string;
      nextDoDate?: string;
      seriesId?: string;
    };
    incompleteSubtasks: { count: number; ids: string[] };
    activeFocus: { sessionId: string; relation: "current" | "other" } | null;
  };
  blockers: Array<"not-found" | "focus-running" | "already-completed">;
  warnings: Array<
    | "incomplete-subtasks"
    | "do-date-after-ddl"
    | "submission-required-direct-complete"
    | "recurrence-will-skip-missed"
  >;
}
```

规则：

- `transitionId` 在 preview 时生成；apply 时复用，保证双击/重试幂等。
- preview 绝不写 store、不写 History、不发提醒、不生成 child。
- `blockers` 非空 → 主按钮禁用，并显示原因。
- active focus 正在当前任务上 → `focus-running`，要求先结束专注；不自动停止。
- 不完整子任务 → warning，不 block；preview 显示“还有 2 个子任务未完成”。
- `submissionRequired: true` 且直接 complete → warning。

### 7.2 Apply（原子事务）

```ts
export interface TaskTransitionResult {
  ok: true;
  transitionId: string;
  taskId: string;
  appliedStatus: TaskTerminalStatus;
  releasedStudyBlockIds: string[];
  cancelledReminderIds: string[];
  generatedRecurrenceId?: string;
}

export function transitionTask(
  taskId: string,
  to: TaskTerminalStatus,
  input: {
    transitionId: string;
    source: TaskTransitionSource;
    batchId?: string;
  }
): TaskTransitionResult | { ok: false; blocker: string };
```

执行顺序（同一个 store `set`）：

1. 校验 task 存在、状态迁移合法、`transitionId` 未重复。
2. 校验无 active focus（当前任务）。
3. 计算 `now`、`academicDoneAt`。
4. 写入 status / 时间戳 / `lastTerminalTransition`。
5. 释放未来 blocks，写入 provenance。
6. 取消 manual/kiro reminders，删除 auto scheduled reminders。
7. 若满足重复条件，设置 parent `recurrenceSpawnedAt`，创建 child + DDL mark。
8. 运行 `reconcileAllAuto`（closed 任务不重建 auto）。
9. 写 Learning History：
   - `assignment.submitted`（to submitted）或 `assignment.completed`（to completed）
   - 可能 `assignment.created`（child，source system）
10. 返回结果。

不允许的隐式行为：

- 不允许在 apply 中自动停止 Focus。
- 不允许在 apply 中删除 Assignment。
- 不允许在 apply 中修改 DDL / course / estimate。
- 不允许 `set_assignment_status` 绕过 preview 直接调用。

### 7.3 Undo（即时撤销）

```ts
export interface TaskTransitionUndoResult {
  ok: boolean;
  restoredStatus: AssignmentStatus;
  restoredStudyBlockIds: string[];
  restoredReminderIds: string[];
  deletedRecurrenceId?: string;
  skipped: Array<{
    kind: "study-block" | "reminder" | "recurrence";
    id: string;
    reason: string;
  }>;
}
```

`undoTaskTransition(taskId, transitionId)`：

- 只接受 `task.lastTerminalTransition.id === transitionId`。
- 恢复到 `activeStatusBeforeTerminal`（没有则 `doing`）。
- 清 `submittedAt` / `completedAt`。
- 恢复 `releasedByTaskId === taskId` 且 `releasedAt >= transition.at` 的未来 blocks：
  - 只恢复 `end > now` 的。
  - 恢复前做 hard conflict 校验；冲突则跳过并报告。
  - 清 `releasedAt` / `releasedBy` / `releasedByTaskId`。
- 恢复 cancelled manual/kiro reminders：
  - 只恢复未来、anchor 有效、无重复的。
- 删除 pristine recurrence child（如果存在）：
  - 清 parent `recurrenceSpawnedAt`。
- 清 `lastTerminalTransition`。
- 写 `assignment.reopened` History，payload 带 restored counts。
- 返回 skipped 明细。

即时 Undo 窗口：

- Toast / 任务详情提供 10 秒“撤销”。
- 超过 10 秒仍可通过“重新打开”执行同样的恢复流程；不是永久不可逆。

### 7.4 Reopen（持久恢复）

`previewReopen(taskId)` 返回：

```ts
export interface TaskReopenPreview {
  taskId: string;
  fromStatus: "submitted" | "completed";
  toStatus: "todo" | "doing";
  restorableStudyBlocks: Array<{ id: string; title: string; date: string; startTime: string; endTime: string }>;
  restorableReminders: Array<{ id: string; title: string; triggerAt: string }>;
  recurrenceChild: { id: string; title: string; ddl?: string; pristine: boolean } | null;
  warnings: Array<"ddl-in-past" | "recurrence-child-exists" | "study-block-conflict">;
}
```

Reopen 对话框：

- 默认勾选“恢复未来学习计划”和“恢复手动提醒”（如果存在可恢复项）。
- 如果重复 child 是 pristine，显示“删除下一次重复任务”选项，默认勾选。
- 如果 DDL 已过，提示“重新打开后会立即变成逾期”。
- 如果 child 已被修改，显示“下一次重复任务已存在，保留它会产生两个待办”。

Reopen 后：

- status 恢复 active。
- 可以重新安排 StudyBlock / 新增提醒 / 开始 Focus。
- 该任务重新进入 Today / Plan / DDL 的正常判定。

### 7.5 批量

- `previewBatchTransition(ids, to)` 汇总所有任务 side effects。
- apply 时每个任务生成 transition，带同一 `batchId`。
- 已 terminal / 不存在 / focus-running 的任务进入 blocked 列表，不阻塞其他任务；UI 明确显示“将处理 N 个，跳过 M 个”。
- 单批上限 200；超过分批。
- Undo batch：按 batchId 找到 transitions，逐个 undo；部分失败如实报告。
- 批量 bar 的文案用“提交”还是“完成”，取决于选中任务的 `submissionRequired`：
  - 全部 true → “提交”
  - 全部 false → “完成”
  - 混合 → 菜单二选一，不猜。

---

## 8. 数据模型与迁移

### 8.1 类型新增/修改

```ts
// types/index.ts

export type AssignmentStatus = "todo" | "doing" | "submitted" | "completed";

export interface Assignment {
  // ...existing fields
  /** @deprecated Phase 0 起只读兼容，不再驱动 status / 主 UI */
  progress: number;
  /** 本地日期 "YYYY-MM-DD"；规划意图，不是 deadline */
  doDate?: string;
  /** true = 主操作是提交（等待反馈）；false = 主操作是完成 */
  submissionRequired?: boolean;
  submittedAt?: string;
  completedAt?: string;
  lastTerminalTransition?: TaskTerminalTransition;
  recurrenceSpawnedAt?: string;
}

export interface StudyBlock {
  // ...existing fields
  planningState?: "released";
  releasedAt?: string;
  releasedBy?: "task-submitted" | "task-completed" | "manual" | "rebalance" | "legacy";
  releasedByTaskId?: string;
}

export type ReminderStatus = "scheduled" | "fired" | "skipped" | "cancelled";

export interface Reminder {
  // ...existing fields
  cancelledAt?: string;
  cancelledByTaskId?: string;
  cancelledReason?:
    | "task-submitted"
    | "task-completed"
    | "task-deleted"
    | "study-block-released"
    | "manual";
}

export interface FocusSession {
  // ...existing fields
  /** P1：计划 vs 实际；Phase 0 不强制 */
  studyBlockId?: string;
}

export interface CalendarMark {
  // ...existing fields
  /** P1：考试/活动归入课程 */
  courseId?: string;
}
```

### 8.2 持久化版本

- `useAppStore` persist version：`8 → 9`。
- `PersistedAppState` 不变（新字段随 `Assignment` / `StudyBlock` / `Reminder` 自动进入）。
- `normalizeAssignment` 增加：
  - `doDate` 校验（真实日期、`YYYY-MM-DD`）。
  - `submissionRequired` 布尔清洗。
  - `submittedAt` / `completedAt` 本地墙钟字符串校验；非法 → undefined。
  - `lastTerminalTransition` 逐字段清洗；非法 → undefined。
  - `recurrenceSpawnedAt` 校验。
  - `progress` 继续清洗，但不再参与状态。
- `normalizeReminder` 接受 `"cancelled"`；旧 status 保持不变。
- `normalizeHydratedStudyBlock` 清洗 provenance；旧 released 数据补 `releasedBy: "legacy"`（不补 `releasedAt`）。
- `sanitizePersistedState` 继续在 hydrate 时运行 `reconcileTerminalAssignmentStudyBlocks`，但 release 时写 provenance。
- `migrate`：v8 → v9 是 additive；不做破坏性状态转换。
  - 旧 submitted/completed 任务保持原状态。
  - 旧 `progress` 保留。
  - 旧 completed/submitted 时间戳保持 undefined（不伪造）。
  - 旧 `submissionRequired` 默认 false。
  - 旧 `doDate` undefined。
  - 旧 released blocks 标记 legacy。
- 未来版本降级保护保持：version > 9 拒载。

### 8.3 备份版本

当前 `ClassFlowBackup.version = 1`，且 `ClassFlowBackupData` 不含 Learning History / Kiro / Reminder Preferences / Skills/MCP。Phase 0 先做“诚实备份”，Phase 1 再做“完整备份”。

Phase 0 目标：

```ts
export type BackupScope =
  | "business"
  | "materials"
  | "avatar"
  | "learning-history"
  | "preferences"
  | "kiro";

export interface BackupManifest {
  schemaVersion: 9;
  createdAt: string;
  included: BackupScope[];
  excluded: BackupScope[];
  counts: Record<string, number>;
}

export interface ClassFlowBackupV2 {
  version: 2;
  exportedAt: string;
  manifest: BackupManifest;
  data: ClassFlowBackupData; // Phase 0 仍为业务数据 + 资料
}
```

Phase 0 必须：

- 把“完整备份”改名为“业务数据 + 课程资料备份”，或保留名称但在描述/预览中明确不包含 Learning History / Kiro / 扩展配置。
- `RestorePreviewDialog` 明确显示：
  - 包含哪些 scope；
  - 不包含哪些 scope；
  - “恢复会清空当前学习历史”的警告 + 必须勾选确认；
  - 恢复后 Analytics 可能显示“范围无记录”。
- `restoreAppData` 不再静默 `resetLearningHistoryForDomainReset()`；改为显式 `replaceLearningHistory: boolean` 参数。
- 旧 v1 备份仍可恢复，但显示同样的警告。

Phase 1（不在本契约实现）：

- 备份包含 Learning History、Reminder Preferences、Kiro 配置/对话/记忆。
- 恢复时默认一起恢复；不再清空历史。
- Kiro 数据有单独的导出/删除入口。

### 8.4 课程删除级联

Phase 0 必须：

- `CourseDetailDrawer` 删除确认显示完整级联：
  - 排课时段数
  - 任务数（active / waiting / completed）
  - 小组项目数 + 小组任务数 + 成员数
  - 学习计划数（active / released）
  - 提醒数
  - 课程资料数
  - 调课/停课记录数
- 如果 `groupProjects.length > 0`：
  - 要求输入课程名确认；
  - 明确写出“将删除 N 个小组项目、M 个小组任务、K 名成员”；
  - 提供“先导出备份”链接。
- 删除后没有 Undo（Phase 0 接受），但必须有强确认。
- Phase 1 再考虑“归档课程”替代删除。

同时修复任务改课程的两个数据完整性点：

1. **StudyBlock 级联规则**：
   - 有 `assignmentId` 的 block：只在 `assignmentId` 被删除时删除；不要仅因为 `block.courseId === courseId` 就删除。
   - 无 `assignmentId` 的 block：按 `courseId` 删除。
   - 这样任务从课程 A 改到课程 B 后，删除 A 不会误删已迁移任务的学习计划。
2. **改课程时**：
   - active blocks 的 `courseId` 同步到新课程。
   - released blocks 保留原课程快照（历史），但级联仍按 `assignmentId` 保护。
   - 被清除的 `materialIds` 在 UI 中提前预览“将解除 N 个资料关联”，不静默。

### 8.5 Analytics reliability

Phase 0 的“数据真相”还包括分析口径。当前 partial coverage 会泄漏到 Weekly Review / Signals / Verdict。

规则：

- 每个指标带 `reliability: "complete" | "partial" | "unknown"`。
- `partial` 不得显示精确百分比；显示“已记录 X”或“—”。
- `WeeklyReviewCard`、`Signals`、`Verdict` 必须消费同一个 `AnalyticsPresentation`，不得自己重算。
- “日均专注”只在 day bucket 使用；week / semester bucket 显示“周均专注”或“教学周均专注”。
- 刷新失败保留最后一次可用数据 + 行内错误/重试；不要用错误页替换 stale data。
- `isEmpty` 表示“当前范围无记录”，不是“全局无记录”；空态文案必须带范围。
- `AnalyticsVerdict` 不再固定写“本周”，使用当前范围文案。

### 8.6 Kiro 写入边界

Phase 0 必须：

- `getKiroToolsForRequest` 增加写权限参数：
  - `writeAccess: "none" | "approval"`。
  - `none`：只暴露 `KIRO_READ_TOOLS`（含 proposal tools）+ memory；不暴露 `KIRO_WRITE_TOOLS`。
  - `approval`：暴露 write tools，但 terminal / 跨实体 / 批量写必须走 proposal + 用户批准。
- 模式映射：
  - `chat`（Computer OFF）→ `none`
  - `plan` → `none`
  - `guided` → `approval`
  - `workspace-auto` → `approval`（Phase 0 不对业务写开放 direct；Computer 仍按原策略）
- 移除：
  - `set_assignment_status`
  - `set_assignment_progress`
- 新增：
  - `submit_assignment`
  - `complete_assignment`
  - `reopen_assignment`
  - `set_task_do_date`
  - `update_task_fields`（仅非生命周期字段）
- `create_assignment` / `update_assignment`：
  - 移除 `status` / `progress` 入参。
  - 增加 `submissionRequired?` / `doDate?`。
  - 创建默认 status = todo。
- `toggle_assignment_subtask`：
  - 仅 active 任务；closed 返回明确错误。
- `KiroWriteApi`：
  - 移除 `updateAssignmentStatus` / `updateAssignmentProgress`。
  - 增加 `transitionTask` / `reopenTask` / `undoTaskTransition` / `setTaskDoDate`。
- `prepareSetAssignmentStatus` / `prepareSetAssignmentProgress` 删除或重写为 transaction preview。
- `KiroActionCard` 增加 `targetRef` 深链：任务 / 课程 / 时间表 / 提醒 / StudyBlock。
- Busy handoff：
  - `handoffPrompt` / `handoffAssignmentPrompt` 在 Kiro busy 时不再静默 return。
  - 进入可见队列（最多 5 条），Toast “Kiro 正在处理，已加入队列”，全局 Kiro 状态点显示 pending。
  - 当前 turn 结束后按 FIFO 发送；用户可取消。
- Base Context：
  - 增加 selected task 的 `status / doDate / schedulingState / remainingMinutes`。
  - Phase 1 提供“Kiro 看到什么”上下文面板；Phase 0 至少不再声称“关闭自动上下文”会阻止 base context 发送，修正文案或实现。

---

## 9. UI 行为契约（只定行为，不定布局）

> 详细布局、响应式、快捷键、动效在下一份 `Today + Plan Interaction Spec`。这里只锁定会写数据的行为。

### 9.1 任务行

- 状态 chip：待完成 / 进行中 / 等待反馈 / 已完成。
- 主 checkbox：
  - active + `submissionRequired: false` → 完成。
  - active + `submissionRequired: true` → 提交。
  - submitted → 不显示可勾选 checkbox；显示“等待反馈” chip + 行内“确认完成”动作。
  - completed → checked disabled；右键/更多“重新打开”。
- 行内不再显示 `progress` 百分比；显示：
  - 子任务 `3/5`
  - 已排 `1h` / 剩余 `3h`
  - 逾期 `6h`
- 行内隐藏按钮在不可见时必须 `tabIndex=-1`，避免每行产生多个焦点停靠点。
- 行 checkbox 必须有包含任务标题的 `aria-label`，例如“提交《计量作业》”。

### 9.2 任务详情

- Hero 的 status 下拉移除，替换为只读 status chip。
- 主操作：
  - active + submissionRequired → “提交”
  - active + !submissionRequired → “完成”
  - submitted → “确认完成” + “重新打开”
  - completed → “重新打开”
- “更多”：
  - “直接完成”（submissionRequired 时显示警告）
  - “标记为已提交”（!submissionRequired 时可选）
  - “标记为进行中 / 待完成”（active）
  - “删除”
- 进度滑杆移除。
- 子任务：
  - active 可勾选；closed 只读。
  - 全部完成时显示“全部子任务已完成，标记完成？”按钮。
- DDL：
  - 详情内可 inline 修改日期 + 时间；
  - 快捷 `+1 天` / `推到周末` / `清除`；
  - closed 任务不可改 DDL；提示先 reopen。
- `doDate`：
  - 显示“今天做 / 选择日期 / 清除”；
  - closed 任务不可设置。
- 完成/提交前：
  - 有 side effects 时打开 preview dialog；
  - 无 side effects 时可直接执行 + 10 秒 Undo Toast；
  - preview dialog 列出：释放的 blocks、取消的 reminders、重复 child、未完成子任务、focus blocker。
- 完成/提交后：
  - 行从当前 active 视图退场（`ExitCollapse` / `ux-fade`）；
  - Toast：“已提交 · 撤销” / “已完成 · 撤销”；
  - Waiting/Completed 视图出现新行（不强制跳转）。
- 重新打开：
  - 有可恢复项时打开 reopen dialog；
  - 无可恢复项时直接 reopen + Undo Toast。

### 9.3 批量

- 选中混合 `submissionRequired` 时，批量主按钮打开菜单：“提交选中 / 完成选中”，不猜。
- 批量 preview 显示聚合 side effects。
- 移动端提供显式“选择”模式；Bulk Bar 使用底部 sheet 或可换行布局，不覆盖 BottomNav。
- 批量删除 / 批量完成都提供 Undo。

### 9.4 空态

- `unscheduled` 空态：“没有待安排任务” + “查看全部”/“清除筛选”；“清除筛选”不能只清课程/搜索却仍停在空视图。
- `waiting` 空态：“没有等待反馈的任务”。
- `completed` 空态：“还没有已完成任务”。
- 课程卡：
  - 总任务 0 → “还没有任务，点击新建”。
  - 总任务 >0 但 active 0 → “没有待处理任务 · 查看全部 N 项”，不能显示“还没有任务”。

### 9.5 可访问性与动效

- Preview / Reopen 使用 `Dialog` / `AlertDialog`，焦点陷阱，初始焦点在“取消”。
- Undo Toast `aria-live="polite"`，支持键盘触发。
- 状态变化有可读的 live announcement，例如“《计量作业》已提交”。
- 不能只用颜色区分 waiting/completed；必须有文字/图标。
- 动效沿用 Motion V6 token；完成/重新打开不超过 180ms；尊重 reduced motion。
- 不做庆祝动画、不做整页 remount。

---

## 10. 验收标准

### A. 逾期

1. 任务 DDL = 今天 09:00，now = 15:00：
   - `isTaskOverdue` true；
   - Today 出现在 overdue 组；
   - Upcoming 出现在逾期组；
   - 行内显示“已逾期 6 小时”；
   - Health = `overdue`。
2. 任务 DDL = 今天 23:59，now = 15:00：
   - 不 overdue；
   - Today 出现在 dueToday 组；
   - Upcoming 出现在“今天”组。
3. submitted 任务 DDL 已过：
   - 不 overdue；
   - 不出现在 Today/Upcoming/Plan/DDL；
   - 出现在 Waiting。
4. 重新打开已逾期任务：
   - 立即 overdue；
   - Today/Upcoming 重新出现。

### B. 提交 / 完成

5. `submissionRequired: true` 的任务点击主操作：
   - 打开 preview；
   - preview 列出未来 blocks / reminders / recurrence / 未完成子任务；
   - 确认后 status = submitted，`submittedAt` 写入；
   - 不进入 Today/Plan/DDL；
   - 进入 Waiting。
6. `submissionRequired: false` 的任务点击主操作：
   - status = completed，`completedAt` 写入；
   - 进入 Completed。
7. submitted → completed：
   - 只写 `completedAt`；
   - 不重复释放/取消/生成 child；
   - 不产生第二条 completed History。
8. 双击完成按钮：
   - 第二次 apply 使用同一 transitionId；
   - 不重复生成 child / 不重复取消 reminder。
9. active focus 正在任务上：
   - preview 返回 `focus-running`；
   - 主按钮禁用；
   - 不自动停止 focus。

### C. 完成事务恢复

10. 任务有 2 个未来 active blocks + 1 个 manual reminder：
    - 完成时 blocks 变 released；
    - reminder 变 cancelled；
    - 任务视图 `scheduledMinutes = 0`；
    - Health 忽略 blocks；
    - Overview 图层不绘制。
11. 10 秒内 Undo：
    - status 恢复 active；
    - 未来 blocks 恢复 active；
    - manual reminder 恢复 scheduled；
    - pristine child 删除；
    - `lastTerminalTransition` 清空。
12. 超过 10 秒 Reopen：
    - preview 列出可恢复项；
    - 勾选后恢复；
    - 冲突的 block 跳过并报告；
    - 已过去的 reminder 不恢复。
13. 删除一个 released block 后 Undo：
    - 该 block 不恢复；
    - 其他 block 恢复；
    - 结果报告 skipped。

### D. 计划覆盖度

14. 4h 任务 + 1h active block：
    - `scheduledMinutes = 60`；
    - `remainingMinutes = 180`；
    - `schedulingState = "partial"`；
    - 出现在 Unscheduled，显示“剩余 3h”；
    - Health = attention。
15. 4h 任务 + 4h active blocks：
    - `schedulingState = "full"`；
    - 不出现在 Unscheduled；
    - Health = safe。
16. 1h active block + 无 estimatedMinutes：
    - `schedulingState = "unknown"`；
    - 不出现在 Unscheduled 的“已排满”；
    - 显示“已排 1 段 · 未估时”。
17. 完成/提交后 released block：
    - 不计 `scheduledMinutes`；
    - 不计 `scheduledToday`；
    - 不计 Health；
    - 不出现在 Overview 图层；
    - 任务详情显示“已释放 N 个旧计划”。

### E. Progress / 子任务

18. 5 个子任务完成 3 个：
    - UI 显示 `3/5`；
    - status 不变；
    - 不写 progress；
    - 不生成 child。
19. 5 个子任务全部完成：
    - 显示“全部完成，标记完成？”；
    - 不自动 completed。
20. 已完成任务取消一个子任务：
    - 操作被阻止（closed 只读）；
    - 不重新打开任务。
21. 旧数据 progress = 100 但 status = todo：
    - UI 不显示 100%；
    - status 仍 todo；
    - 不自动 completed。

### F. 重复任务

22. 周一 23:59 weekly 任务，周三提交：
    - child DDL = 下周一 23:59；
    - 只生成一个 child；
    - `recurrenceSpawnedAt` 写入。
23. submitted → completed：
    - 不生成第二个 child。
24. 逾期 3 周后提交：
    - 生成提交后的下一个周期，不生成一串逾期 child。
25. Undo 时 child 未被修改：
    - child 删除；
    - `recurrenceSpawnedAt` 清空。
26. Undo 时 child 已被安排 StudyBlock：
    - child 保留；
    - 结果报告 child not pristine；
    - UI 提示两个待办。
27. 1 月 31 日月度任务：
    - 下一次 2 月最后一天；
    - 不溢出到 3 月。

### G. 跨 surface

28. submitted 任务：
    - Today 不出现；
    - UpcomingDDL 不出现；
    - QuickGlance 不计入“本周任务”；
    - MiniCalendar 无 DDL 点；
    - Timeline Key Lane 无 DDL；
    - Tasks Waiting 出现；
    - Course 卡片“待处理”不计；
    - Reminder 不新增。
29. released block：
    - Plan 活跃层不显示；
    - Overview 图层不显示；
    - Task Peek 不显示“已计划”；
    - Health 不计；
    - Free Time 计入空闲。
30. 课程卡只有 completed 任务：
    - 不显示“还没有任务”；
    - 显示“没有待处理任务 · 查看全部 N 项”。

### H. 数据与备份

31. v8 → v9 迁移：
    - 旧任务状态不变；
    - 旧 progress 保留但不显示；
    - 旧 submitted/completed 时间戳保持 undefined；
    - 旧 released blocks 标记 legacy；
    - 不产生重复 child；
    - 不丢失任何 blocks/reminders。
32. 恢复 v1 备份：
    - preview 明确提示“学习历史不会恢复，当前学习历史将被清空”；
    - 用户必须勾选确认；
    - 不勾选则不能恢复。
33. 删除课程有 2 个小组项目：
    - 确认框列出 2 个项目、任务数、成员数；
    - 要求输入课程名；
    - 不能一键误删。
34. 任务从课程 A 改到课程 B：
    - active blocks 的 courseId 更新；
    - 删除课程 A 不会删除已迁移任务的学习计划；
    - 被解除的 materialIds 提前可见。

### I. Kiro

35. 在“仅规划”模式：
    - 请求“把 DDL 改到周五”；
    - 不直接写；
    - 只生成 proposal / 说明需要切换模式；
    - `KIRO_WRITE_TOOLS` 不在 tool set。
36. 在“受控访问”模式：
    - 请求完成一个任务；
    - 生成 transition preview；
    - 用户批准后才写入；
    - Action Card 可以跳到该任务。
37. Kiro busy 时从任务 Drawer 点“估算任务”：
    - 不静默丢弃；
    - 进入队列；
    - 显示 Toast / 全局 pending 状态；
    - turn 结束后发送。
38. closed 任务上让 Kiro 加提醒：
    - 返回明确错误“任务已提交/完成，重新打开后可添加提醒”；
    - 不静默创建。

### J. Analytics

39. 本周三才开始记录，只记录 2 个完成任务：
    - KPI 显示“已记录 2 项”；
    - Weekly Review 不显示 100% 精确值；
    - Signals 不把 partial 样本说成“截止节奏”；
    - Verdict 不显示“本周节奏稳健”。
40. 选“近 4 周”：
    - 指标标签是“周均专注”，不是“日均专注”。
41. 刷新失败：
    - 保留上一次数据；
    - 行内显示错误/重试；
    - 不清空整页。

### K. 性能

42. 2,000 tasks + 1,000 blocks：
    - Today / Plan backlog 派生 < 16ms（桌面）；
    - 任务列表滚动无持续掉帧；
    - 不为每行全量 filter blocks。

---

## 11. 工程拆解（Phase 0）

### 11.1 0.1 Domain 与 selector

新增：

- `lib/tasks/taskLifecycle.ts`
  - `isActiveTask` / `isWaitingTask` / `isCompletedTask` / `isClosedTask`
  - `academicDoneAt`
  - `isTaskOverdue` / `isDueToday` / `isDueSoon` / `isDoToday`
- `lib/tasks/taskPlanning.ts`
  - active block 过滤
  - `plannedActiveMinutes` / `remainingMinutes` / `schedulingState`
- `lib/tasks/taskProjections.ts`
  - `buildTodayProjection`
  - `buildPlanBacklogProjection`
  - `buildDeadlineFeed`
- `lib/tasks/taskTransitions.ts`
  - `buildTransitionPreview`
  - `applyTransition` 的纯函数部分
  - `buildReopenPreview`
  - `applyReopen`
  - `buildUndoResult`

修改：

- `types/index.ts`
- `lib/tasks/taskSemantics.ts`
- `lib/tasks/taskViews.ts`
- `lib/tasks/taskHealth.ts`
- `lib/tasks/taskRecurrence.ts`
- `lib/planning/studyBlockLifecycle.ts`

### 11.2 0.2 Store 事务

修改 `store/useAppStore.ts`：

- 新增：
  - `previewTaskTransition`
  - `transitionTask`
  - `undoTaskTransition`
  - `previewTaskReopen`
  - `reopenTask`
  - `setTaskDoDate`
  - `updateTaskFields`
- 移除/降级：
  - `updateAssignmentStatus`
  - `updateAssignmentProgress`
- 保留但收紧：
  - `toggleSubtask`：只改 subtasks，不写 status/progress；closed 拒绝。
  - `updateAssignment`：内部使用，拒绝 lifecycle 字段。
  - `updateAssignmentPatch`：拒绝 lifecycle 字段；closed 任务限制 DDL/estimate/course。
- terminal 事务统一走 `transitionTask`；`addAssignment` / recurrence spawn 不直接写 completed。
- `persist` version 9；`migrate` additive。
- `restoreAppData` 增加 `replaceLearningHistory` 参数。
- `deleteCourse` 级联规则修正。

### 11.3 0.3 任务 surface

修改：

- `components/dashboard/AssignmentTable.tsx`
- `components/assignment/AssignmentWorkspaceViewBar.tsx`
- `components/assignment/AssignmentPeekPanel.tsx`
- `components/assignment/QuickAddCard.tsx`
- `hooks/useAssignmentWorkspaceController.ts`
- `components/drawers/AssignmentDrawer.tsx`
- `components/assignment/detail/AssignmentDetailHero.tsx`
- `components/assignment/detail/AssignmentDetailExecution.tsx`
- `components/assignment/detail/AssignmentDetailActions.tsx`
- `components/modals/AddAssignmentModal.tsx`
- `lib/assignmentActions.ts` / `lib/assignmentSelection.ts`（批量命令）

重点：

- 状态下拉 → 只读 chip + 命令按钮。
- progress 滑杆 → 子任务比例 / 剩余工时。
- preview / reopen dialog。
- 视图集合与 counts。
- 移动端选择模式与 Bulk Bar。
- 行 checkbox 语义。

### 11.4 0.4 跨 surface 与信任层

修改：

- `components/dashboard/UpcomingDDL.tsx`
- `components/dashboard/TimetableQuickGlance.tsx`
- `components/dashboard/MiniCalendar.tsx`
- `components/dashboard/overviewStudyBlockLayers.tsx`
- `components/timeline/TimelineWorkspace.tsx`
- `components/timeline/TimelineUnscheduledShelf.tsx`
- `lib/timeline/deriveTimelineItems.ts`
- `components/course/CourseLibraryCard.tsx`
- `components/course/detail/CourseTaskSection.tsx`
- `components/course/detail/CourseMaterialSection.tsx`
- `components/drawers/CourseDetailDrawer.tsx`
- `lib/dataDependencies.ts`
- `components/settings/BackupSection.tsx`
- `components/settings/RestorePreviewDialog.tsx`
- `lib/analytics/*`
- `components/analytics/WeeklyReviewCard.tsx`
- `components/analytics/LearningSignalsCard.tsx`
- `components/analytics/AnalyticsVerdict.tsx`（及相关 presentation）
- `lib/ai/tools/*`
- `hooks/useKiroChat.ts`
- `lib/ai/tools/write/api.ts`
- `lib/ai/tools/write/prepare.ts`
- `lib/ai/tools/write/executor.ts`
- `lib/ai/tools/write/schemas.ts`
- `lib/ai/tools/write/registry.ts`
- `lib/ai/tools/index.ts`
- `hooks/useKiroHandoff.ts`
- `components/kiro/KiroSessionProvider.tsx`
- `components/kiro/KiroActionCard.tsx`

### 11.5 0.5 History

修改：

- `lib/history/types.ts`
  - 新增 `assignment.submitted`
  - 新增 `assignment.do_date_changed`
  - 扩展 `AssignmentCompletedData`
  - 扩展 `AssignmentReopenedData`
- `lib/history/assignmentEvents.ts`
  - `submittedAt` / `completedAt` / `onTime` / `doDate`
- `lib/history/recorder.ts`
  - 不需要大改；只接新事件。

### 11.6 0.6 测试

新增/修改：

- `tests/taskLifecycle.test.ts`
- `tests/taskPlanning.test.ts`
- `tests/taskProjections.test.ts`
- `tests/taskTransitions.test.ts`
- `tests/taskReopenUndo.test.ts`
- `tests/taskMigration.test.ts`
- `tests/taskRecurrenceV2.test.ts`
- `tests/reminderCancellation.test.ts`
- `tests/backupManifest.test.ts`
- `tests/kiroTaskWriteBoundary.test.ts`
- 更新现有：
  - `tests/timelineStudyBlockExecution.test.tsx`
  - `tests/assignmentWorkspace*`
  - `tests/analytics*`
  - 相关 E2E：`overview-timetable.spec.ts`、`timeline-v2-visual.spec.ts`、`assignment*`、`course*`、`review*`、`kiro*`

测试类型：

- Unit：selector / preview / apply / undo / recurrence / migration。
- Property：closed 任务永不出现在 Today；released block 永不计 scheduledMinutes；subtask toggle 永不改 status；每个 occurrence 最多一个 child。
- Integration：store transaction、History events、reminder cancel/restore、backup restore。
- E2E：Today/Upcoming/Tasks/Plan/Course/Review/Kiro 关键路径。
- Visual regression：任务行状态、preview dialog、waiting/completed 分组。

### 11.7 Feature flag 与灰度

- Build-time flag：`TASK_LIFECYCLE_V2`。
- Dev/beta override：`localStorage["classflow:task-lifecycle-v2"] = "1"`。
- 读路径与写路径共用同一 flag；关闭时保持旧行为。
- 迁移始终 additive；旧代码可忽略新字段。
- 灰度：
  1. 内部 dev
  2. 5–10 名 beta 学生
  3. 10% → 50% → 100%
- 回滚：
  - 新字段 additive；旧代码忽略。
  - `ReminderStatus.cancelled` 旧代码只处理 `scheduled`，不会误触发。
  - `submitted` 仍是旧枚举值，不会崩。
  - 回滚前建议用户先备份。

### 11.8 性能预算

- 建立索引：
  - `activeBlocksByAssignmentId`
  - `activeBlocksByDate`
  - `tasksByDoDate`
  - `tasksByDeadlineDate`
- Today/Plan 派生 O(tasks + blocks)，不做 O(tasks × blocks)。
- React：
  - 行组件 memo；
  - 不因 1s focus tick 重渲染整页；
  - 大列表使用 `content-visibility` 或虚拟化（按现有模式）。
- 目标：
  - 2,000 tasks + 1,000 blocks：Today/Plan < 16ms。
  - 完成/提交事务 < 50ms（不含 IndexedDB History 异步）。
  - 页面切换不重播首屏 choreography。

---

## 12. 非目标（Phase 0 不做）

- 不合并 Task / Deadline / StudyBlock / CourseSchedule。
- 不做多学期模型（`Semester[]` / `Course.semesterId`）。
- 不做 GroupTask → 个人 Assignment / StudyBlock 的桥（Phase 2）。
- 不做 StudyBlock 块级 `done/partial/skipped`（Phase 2，和 Plan Block Inspector 一起做）。
- 不做 `FocusSession.studyBlockId` 的完整计划 vs 实际 UI（字段可先加，UI 后置）。
- 不做 `CalendarMark.courseId` 的课程归属 UI（字段可先加，UI 后置）。
- 不做完整 Kiro 对话/记忆/Artifact 备份（Phase 1）。
- 不做 AI 自动写业务数据（用户已选“建议 + 批准”）。
- 不做完整的系列视图 / 跳过 occurrence / 系列编辑。
- 不做“课程归档”替代删除（Phase 1）。
- 不做新的笔记/文档系统。

---

## 13. 已确认决策

| 决策 | 选择 |
|---|---|
| 信息架构 | Today / Plan / Courses / Review / Groups + Kiro |
| 任务生命周期 | submitted = 等待反馈；progress 只读派生；引入 doDate |
| AI 自主级别 | 建议 + 用户批准后执行 |
| 首版范围 | Phase 0 + Today + Plan |
| 视觉方向 | Warm academic studio |
| 交付顺序 | 先 Phase 0 契约，再 Today / Plan 规格，再工程拆解 |

### 本契约新增的决定

1. `submissionRequired` 默认：新课程任务 true，个人任务 false，旧数据 false。
2. `progress` 字段保留但不再显示/驱动状态；Phase 1 再清理。
3. `doDate` 是日级意图，不创建 Reminder / CalendarMark。
4. 完成/提交是 preview → apply → undo/reopen 的事务。
5. 重复任务在第一次 terminal 动作生成，保留节奏并跳过已错过的 occurrence。
6. `at-risk` 从视图变为 filter；`focus` / `archive` 退役并映射。
7. Phase 0 备份先“诚实化”，完整历史/Kiro 备份放 Phase 1。
8. Phase 0 AI 对业务写只开放 `approval`，不开放 direct。
9. Group 任务 Phase 0 明确标注“不含小组任务”，桥接放 Phase 2。

---

## 14. 下一步

1. 评审本契约，确认没有遗漏的 Domain 语义。
2. 基于本契约写 `Today + Plan Interaction Spec`：
   - 桌面 / 平板 / 移动端布局；
   - Today 首屏分组；
   - Plan 三栏（Backlog / Calendar / Inspector）；
   - 空态 / 加载 / 错误；
   - 键盘 / 动效 / 可访问性；
   - 组件树与状态所有权。
3. 输出 Phase 0–2 工程拆解与迁移清单。
4. 进入实现前，先补 Phase 0 的单元测试骨架与迁移 fixture。
