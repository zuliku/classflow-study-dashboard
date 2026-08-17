# Task V2 + Kiro Task Agent — 实现契约（架构准备）

> 状态：设计契约，非实现。后续 Task 1–6 按此契约开发。
> 原则：Task ≠ Deadline ≠ StudyBlock ≠ CourseSchedule。禁止重新合并为一个对象。

---

## 1. 当前 Assignment 系统审计（现状）

### 数据模型（types/index.ts）
- `Assignment { id, courseId, title, description, ddl: string(必填), priority, status, progress, tags, subtasks? }`
- `ddl` 本地墙钟语义（无 Z）：`lib/ddl.ts`（combineLocalDateTime / parseLocalDDL 兼容旧 Z 数据）
- `GroupTask`、`CalendarMark`（type: course/ddl/exam/activity，sourceId 关联 assignment）、`StudyBlock { title, date, startTime, endTime, assignmentId?, courseId?, source }` 各自独立

### Store（useAppStore.ts）
- `addAssignment/updateAssignment/updateAssignmentStatus/updateAssignmentPriority/updateAssignmentProgress/toggleSubtask/deleteAssignment(+undo restore, 含 CalendarMark 同步)`
- `studyBlocks` + `addStudyBlock/updateStudyBlock/deleteStudyBlock`（Timeline V1，persist/sanitize/backup 全链路）
- `currentSemesterWeek`、`assignmentTimeSlice`、`assignmentSelection/highlightedAssignmentId`

### 交互层
- `AssignmentTable`（workspace/compact）：course filter、time slice、键盘导航、多选、bulk complete/priority/DDL date/shift、context menu、peek、drawer、delete+undo、Kiro handoff
- `lib/assignmentActions.ts`：批量动作唯一工厂（Command/Context Menu/Bulk Bar 共用）
- `lib/assignmentSelection.ts`：纯函数选择/批量 DDL 逻辑
- `lib/taskDefaults.ts`：新建默认值（优先级/状态/DDL 时刻）唯一来源
- Drawer/Modal/Peek：编辑、详情、快速预览

### 已知不一致（V2 需消除）
1. `progress` 与 `status` 双写派生规则不统一：
   - `toggleSubtask` → progress 由 completed subtasks 比例派生 + status 同步 ✓
   - `updateAssignmentProgress` → status 由 progress 派生 ✓，但 `status: completed → todo`（反向）时 progress 不回落
   - 手动改 status 为 completed → progress=100 ✓；手动改 progress 与 subtasks 并存时互不感知
2. `ddl` 必填：V2 需要可选的未设 DDL 任务
3. 无 `estimatedMinutes`：Deadline Health / 排程无法判断「缺多少时间」

### 保留能力（不推翻）
course filter / time slice / 键盘导航 / 多选 / bulk 全家族 / context menu / peek / drawer / delete+undo / Kiro handoff。

---

## 2. Task V2 数据契约

```ts
interface AssignmentV2 {
  id: string;
  courseId?: string;          // 现有 courseId 已必填；V2 允许无课程任务（可选，按现有模型最小放宽）
  title: string;
  description: string;
  /** 可选 DDL：本地墙钟 "YYYY-MM-DDTHH:mm[:ss]"（无 Z）。缺省 = 未设截止 */
  ddl?: string;
  priority: Priority;
  status: AssignmentStatus;
  progress: number;           // 0-100
  tags: string[];
  subtasks?: Subtask[];
  /** V2 新增：预计完成分钟数（无则 Health 返回 missing-estimate，不伪造） */
  estimatedMinutes?: number;
}
```

- **不把** `startTime/endTime` 加入 Assignment —— 计划时间一律由 StudyBlock 承担。
- `ddl?` 可选化影响面（Task 1 评估）：新建表单、AssignmentTable 排序/筛选、UpcomingDDL、MiniCalendar 的 DDL dot、Kiro read/write 工具、sanitize/persist 无需迁移（optional 字段向后兼容）。

### Progress 确定性规则（Task 1 实现）
| 场景 | progress 来源 |
|---|---|
| 无 subtasks | 手动维护（updateAssignmentProgress 唯一入口），status 同步派生 |
| 有 subtasks | progress = round(completed/total*100)，status 同步；禁止手动 progress 与其冲突 |
| status → completed | progress = 100（强制） |
| status → 非 completed | progress 不自动改；若等于 100 且手动改回，视为用户显式操作（保留） |

---

## 3. Task / Deadline / StudyBlock 语义契约

| 对象 | 语义 | 时间字段 | 谁负责 |
|---|---|---|---|
| Task（Assignment） | 要做什么 | ddl?（最晚） | 用户/任务编辑 |
| Deadline | Task 的截止时刻（投影，非独立实体） | 从 ddl 派生 | derive 层 |
| StudyBlock | 准备什么时候做 | date + startTime/endTime | 用户安排 / Kiro Proposal |
| CourseSchedule | 固定时间约束（hard） | dayOfWeek + start/end + weeks | 课表编辑 |
| Exam/Activity（CalendarMark） | 固定时间约束 | date + startTime?/endTime? | 日程编辑 |

- Timeline 投影层（lib/timeline/deriveTimelineItems.ts）已实现「Task→DDL Point、StudyBlock→弱块、Exam→interval、all-day」分离 —— 保持。
- **Course = Hard Constraint**：StudyBlock 与课程重叠必须拒绝（现有 studyBlockConflict 已实现，保留）。

---

## 4. Deadline Health 确定性设计（Task 4 实现）

纯函数 `lib/taskHealth.ts`（无 AI、无日期库依赖差异）：

```ts
type TaskHealth =
  | "safe"        // 有充足安排时间
  | "attention"   // 可完成但偏紧
  | "at-risk"     // 已排时间不足以完成
  | "overdue"     // 已过 DDL
  | "unscheduled" // 无 DDL 或未排 StudyBlock
  | "unknown";    // 缺 estimatedMinutes，无法判断

interface TaskHealthResult {
  state: TaskHealth;
  minutesUntilDeadline?: number;   // 距离 DDL 的分钟数（有 ddl 时）
  estimatedMinutes?: number;       // 仅当存在
  scheduledMinutes: number;        // 该任务关联 StudyBlock 的计划分钟和
  remainingPlannedMinutes?: number;// estimated - scheduled（仅当两者可知）
  reasons: TaskHealthReason[];     // 如 "missing-estimate" | "insufficient_scheduled_time" | "no_ddl" | "overdue" | "conflicts_with_course"
}
```

规则（deterministic，顺序判定）：
1. 无 ddl → `unscheduled`（reason: no_ddl）
2. 已过 DDL → `overdue`
3. 无 estimatedMinutes → `unknown`（reason: missing-estimate；**禁止默认 60min 伪造**）
4. scheduledMinutes ≥ estimated → `safe`
5. scheduledMinutes < estimated：
   - 剩余可排时间仍够（remaining + 空闲）→ `attention`
   - 明显不足 → `at-risk`（reason: insufficient_scheduled_time）
6. UI / Kiro 文案：
   - unknown →「尚未设置预计耗时。」
   - at-risk →「已排时间可能不够，建议补充学习计划。」

---

## 5. Kiro Read Tools 契约（Task 5 实现，并入现有 read registry）

| Tool | 输入 | 输出（结构化） |
|---|---|---|
| get_tasks | { courseId?, status?, timeRange? } | { items: TaskSummary[] } |
| get_task | { taskId } | 完整任务（含 subtasks、estimatedMinutes） |
| get_task_health | { taskId } | TaskHealthResult（见 §4） |
| get_task_schedule | { taskId } | { task, studyBlocks[], scheduledMinutes, gaps[] } |
| get_available_time | { dateRange?, minGapMinutes? } | 空闲窗口（排除课程 + 已排 StudyBlock/Exam） |

- 命名按现有 registry 风格（search_assignments / get_assignment 已存在 —— 新工具与旧工具并存，旧工具保留以兼容既有 prompt/tests）。
- **禁止返回非结构化叙述**：工具只返回数据，自然语言解释由 Kiro 完成。

---

## 6. Kiro Write Tools 契约（Task 5 实现）

| Tool | 类别 | 说明 |
|---|---|---|
| create_task | DIRECT | 用户明确要求创建（无歧义字段，如标题；courseId 歧义时询问） |
| update_task | DIRECT | 明确单项修改（标题/描述/优先级/状态） |
| set_task_ddl | DIRECT | 明确单个 DDL |
| set_task_subtasks | DIRECT | 明确设置子步骤（用户要求拆分时） |
| create_study_blocks | PROPOSAL | 安排一个或多个 StudyBlock（涉及时间分配） |
| update_study_block | DIRECT | 用户明确调整某个已存在 StudyBlock |
| delete_study_block | DIRECT | 用户明确删除 |

- 全部经现有 `prepareKiroWriteTool` / domain actions；**禁止模型直接 patch Store**。
- StudyBlock 冲突校验复用 `studyBlockConflict`（Course hard constraint + 块间重叠）。

---

## 7. Direct vs Proposal 变更矩阵

| 操作 | 类别 | 确认 |
|---|---|---|
| 修改优先级 / 状态 / 单个 DDL / 任务标题 | DIRECT | 无 |
| 创建明确任务 | DIRECT | 无（歧义先问） |
| 设置 subtasks | DIRECT | 无 |
| 更新/删除单个 StudyBlock | DIRECT | 无 |
| 为任务创建 StudyBlock（用户指定时间） | DIRECT | 无（校验冲突） |
| 多任务批量排程 / 根据推断安排时间 | PROPOSAL | Confirm 一次 → Apply |
| 覆盖/删除多个 StudyBlocks | PROPOSAL | Confirm 一次 → Apply |
| 任何「AI 推断修改用户数据」 | PROPOSAL | 禁止未确认执行 |

Proposal 流程（Task 6）：Read → 生成计划（结构化 JSON）→ UI 预览 → 用户确认 → 逐项 domain action（可复用 apply_change_set 的 commit/rollback 模式，但不要求复用其工具名）。

---

## 8. Kiro Prompt 追加规则（Task 5 实现，追加到 lib/ai/config.ts 的 KIRO_SYSTEM_PROMPT）

```
任务语义：Task（要做什么）≠ Deadline（最晚何时）≠ StudyBlock（准备何时做）≠ 课程（固定时间约束）。
课程时间是不可违反的硬约束；StudyBlock 与课程重叠必须被拒绝。
绝不编造：截止时间、预计耗时、任务状态、排课时间。所有当前状态通过工具获取。
明确且用户指定的单项修改（改优先级/状态/单个 DDL/创建任务）可以直接执行；
涉及多任务排程或根据推断修改用户数据（批量安排、覆盖多个学习计划）必须先给出计划并等待用户确认。
只有工具返回成功后才能声称操作完成。
任务没有预计耗时或没有 DDL 时，如实说明，不要假设默认值。
```

---

## 9. Context 策略

- Assignment Workspace / Drawer 打开 Kiro 时，entry context 只用于**聚焦**（当前视图/筛选/高亮任务/课程），提供 `assignmentEntryRef` / `courseEntryRef`（现有 handoff 复用）。
- 真实业务数据一律通过 Read Tools 获取 —— context snapshot 不是长期事实来源（与现有 Kiro context 原则一致）。
- Suggestions（deterministic，非 AI 生成）：
  - 任务详情：帮我拆解这个任务 / 估计需要多久 / 帮我安排时间 / 检查能否按时完成
  - Assignment Workspace：安排本周任务 / 哪些任务有延期风险 / 帮我确定今天先做什么 / 查看未安排的任务
  - 复用现有 KiroSuggestions 的本地 deterministic 模式。

---

## 10. Task 1–6 路线图

### Task 1 — Task V2 data + migration
- 目标：`ddl?` 可选 + `estimatedMinutes?`；progress 确定性规则统一；兼容旧数据（无需迁移脚本，字段 optional + 读时回落）
- 文件：types/index.ts、useAppStore（updateAssignmentProgress/toggleSubtask 规则对齐）、AddAssignmentModal/AssignmentDrawer 表单、lib/taskDefaults
- 依赖：无；不做：批量排程、UI 重画
- 验收：tsc；现有 assignment 单测全绿；无 subtasks 手动 progress 正常；有 subtasks 派生优先

### Task 2 — Workspace V2
- 目标：任务列表升级信息密度（estimatedMinutes、health 徽标预留位）；筛选/选择/批量能力保留
- 文件：components/dashboard/AssignmentTable.tsx
- 依赖：Task 1；不做：新交互范式
- 验收：tsc；现有 selection/bulk 行为不变

### Task 3 — Quick Add + Detail V2
- 目标：快速新建（标题优先、DDL/时长可选）；详情抽屉展示 estimatedMinutes 与 subtasks 一致性
- 文件：AddAssignmentModal、AssignmentDrawer、lib/uiEvents
- 依赖：Task 1；验收：tsc + 新建/编辑 E2E 冒烟

### Task 4 — Task ↔ Timeline + Health
- 目标：`deriveTaskHealth` 纯函数 + Timeline/Unscheduled 面板接入；health 徽标
- 文件：lib/taskHealth.ts（新）、lib/timeline/deriveTimelineItems.ts（接入 scheduled/health）、TimelineUnscheduledShelf
- 依赖：Task 1；验收：health 单测（6 状态 + missing-estimate 不伪造）

### Task 5 — Kiro Task Tools + Prompt
- 目标：§5/§6/§8 工具与 prompt 落地；全部经 domain action；复用 conflict 校验
- 文件：lib/ai/tools/read|write registry、lib/ai/tools/read/executor、useKiroChat、lib/ai/config.ts
- 依赖：Task 1/4；不做：Proposal UI
- 验收：工具单测（health 结构化、direct 执行、proposal 工具暂以错误提示「需要确认」或仅 read）；tsc

### Task 6 — Kiro Planning Proposal / Apply
- 目标：多任务排程 Proposal（结构化计划 → 预览 → Confirm → Apply）；复用 commit/rollback 模式
- 文件：lib/ai/planner（新）、Kiro UI（proposal card）、confirm 流程
- 依赖：Task 5；不做：全自动重排
- 验收：一条 targeted E2E（安排本周任务 → 预览 → 确认 → StudyBlock 落库 → 撤销）

---

## 11. 本任务明确不做

Recurring Task / Reminder / Dependencies / Pomodoro / 实际工时追踪 / Google Calendar / AI 全自动排程 / 导航改名 / 大规模 UI 重画。
