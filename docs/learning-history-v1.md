# ClassFlow Learning History V1

本地只读学习历史（Part 1 数据生产 + Part 2 数据消费）。**仅本地 IndexedDB，不 sync / 不自动注入聊天**。

## Architecture

```
UI / Kiro / System → Domain Mutation → Zustand Current State + History Recorder → IndexedDB
History IndexedDB → Query Engine → Raw Query / Aggregate Summary → Kiro（只读工具）→ 未来 Analytics V2
```

- 独立 DB：`classflow-learning-history`（v1），stores `events` / `meta`；不进 Zustand localStorage。
- Recorder：serialized queue 保序；Reset 在队列内；失败 best effort（dev warn / prod silent），不影响业务 mutation。

## Event Scope（Part 1）

- Assignment（created / status_changed / completed / reopened / deadline / estimate / priority / deleted / restored）
- StudyBlock（created / updated / deleted；updated 只记录时间字段）
- FocusSession（started / paused / resumed / completed；metrics 来自最终 session）
- Course / Schedule（created / updated / deleted；excludeWeek → updated）
- Semester（updated；相同不记录）
- 不覆盖：Reminder、Material、Group Project、Kiro Chat、普通 UI 操作。

## Source Semantics

| Source | 场景 |
| --- | --- |
| `manual` | UI 用户操作（默认） |
| `kiro` | KiroWriteApi wrapper 统一标记 |
| `system` | recurrence child、timer/recovered focus 完成、backfill |
| `import` | importSchedules 批量导入 |

无全局 mutable source；只能通过显式 `LearningMutationContext`。

## Coverage / Backfill

- 首次初始化记录 `historyStartedAt`：之后事件有完整 coverage。
- `fullCoverage = request.from >= historyStartedAt`（Focus backfill 不使更早范围变 true）。
- 只回填旧 completed FocusSession（幂等 id `lh_backfill_focus_completed_<sessionId>`）；不回填 Assignment/Course/Schedule 旧数据。
- `clearLearningHistoryForUser()`：清空 + `focusBackfillDisabled=true`（不再回填旧 Focus）。
- `clearLearningData` / `resetEntireApp` / `restoreAppData`：重置 History（新 startedAt + 允许 backfill）。

## Query / Aggregation（Part 2）

- `queryLearningHistory`：filters（time/type/semester/course/assignment/entityType/source，AND）+ 稳定排序（occurredAt, sequence）+ limit（默认 100，Kiro 层 clamp 200）。
- `aggregateLearningHistory`：deterministic summary（focus 只从 completed 统计；assignment/studyBlock/course/schedule 只从事件统计）；group by day（event.localDate）/ semester-week（event.semesterWeek，null 不进组）/ course（courseNameSnapshot）。

## Kiro Tools（只读）

- `query_learning_history`：具体问题；默认最近 30 天，最长 90 天（超 → `OUT_OF_RANGE` 提示用 summarize）；结果 ≤200。
- `summarize_learning_history`：宽泛问题；默认最近 28 天，最长 366 天。
- 两者 Browser 异步执行 IndexedDB 查询；`fullCoverage=false` 时 Kiro 必须说明历史不完整。
- 学习历史不自动注入上下文；唯一允许发给模型的数据 = 工具输出。

## Settings（数据 → 学习历史）

- 显示 `YYYY/MM/DD 起记录 · N 条历史事件`（loading 状态不闪 0）。
- 「清除学习历史」→ 确认 Dialog（危险样式）→ `clearLearningHistoryForUser()`（events=0、新 startedAt、禁止再 backfill；当前课程/任务/课表/Focus Session 不受影响）。
- 无 Event Viewer（Part 3+ 再考虑）。

## Privacy

History 是本地数据：无 server sync、无 cloud upload、无自动 Chat Context。
