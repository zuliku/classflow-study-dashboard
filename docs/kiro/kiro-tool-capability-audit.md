# Kiro Tool Capability Audit

基于 15 个 Kiro Eval 场景（`lib/ai/eval/kiroScenarios.ts`）逐项核对 Read / Write / Memory Tool 的 description、schema、executor output 与 runtime guard。结构化结果见 `lib/ai/eval/kiroToolAudit.ts`（`KIRO_TOOL_CAPABILITY_AUDIT`）。

## Decision

**refine-existing-tools**

Task 5 只做有证据的小型 existing-tool hardening，不新增聚合 Tool。

## What already works well

- **deterministic Health**：`get_assignment_health` 内部完成 Deadline Health / scheduledMinutes / gap / 截止前可用分钟数计算 → "来得及吗" 不需要 `get_available_time` 二次确认
- **deterministic Available Time**：`get_available_time` 确定性排除课程 / Calendar Marks / StudyBlocks
- **deterministic Study Plan Proposal**：`propose_study_plan` 内部使用 assignments / studyBlocks / semester / schedules / calendarMarks 生成确定性排程 Proposal（是"暂不新增 dashboard aggregate Tool"的重要证据）
- **direct Material / Reminder / Focus 路径**：`get_material_metadata`、`read_material`、`create_reminder`、`start_focus_session` 等直接覆盖对应场景

## Findings

1. **get_available_time：建议补 totalMinutes**（low / refine-output）
   executor 只返回 `{ startDate, endDate, slots }`（slots 截断 20 条），无总分钟数；"今晚还有多少空闲时间" 需要总分钟数，Tool 已确定性计算却让模型自己再 sum。Task 5：仅增加 `totalMinutes` 输出字段，不新增 Tool。

2. **delete_reminder：description 不应在已有唯一 ID 时强制 list_reminders**（medium / refine-description）
   description 写死"删除前必须用 list_reminders 拿到真实 reminderId"（无条件）；Task 3 已规定只有没有唯一 reminderId 时才 list。与 `update_reminder` 的条件式措辞不一致。Task 5：改为条件式。

3. **delete_reminder：runtime 应真正限制 scheduled-only 删除**（high / refine-runtime）
   description 声明"仅 scheduled 状态"，但 executor 直接 find-by-id → delete，无 `status !== "scheduled"` guard；`update_reminder` 已有 scheduled-only guard，二者不一致。Task 5：删除前拒绝 fired / skipped（错误码 INVALID_INPUT，文案按现有 Domain 风格）。

## Aggregate Tool Decision

暂不新增 aggregate Tool（如 `get_today_study_brief` / `get_weekly_study_brief` / `get_dashboard_summary`）。

理由：当前只有 `weekly-pressure` 一个场景较明显地需要宽聚合组合（`get_upcoming_assignments` + `get_week_schedule` + `get_available_time` + 少数 `get_assignment_health`），不满足门槛。

## Evidence Threshold

只有同时满足以下条件才考虑新增 aggregate Tool：

- **>= 3 个常用 Eval 场景** 重复需要
- **相同 4+ Tool 组合**（repeatedToolPattern.length >= 4）
- **Task 3 Prompt Policy 已无法可靠减少** 调用

## Eval Coverage Limits

当前 15 场景覆盖：Task、Planning、Health、Materials、Reminder、Focus、Memory、Batch Write。

**未覆盖**：Group Project CRUD、全部 Course CRUD、全部 Schedule CRUD。这些工具家族在本轮 Eval 中没有场景证据——保持现状，不得基于有限 Eval 做大范围 API 重构。"未覆盖" ≠ "无用 / 可删除"。

## Task 5 Scope

只处理有证据的 refinement：

- `get_available_time`：输出补 `totalMinutes`
- `delete_reminder`：description 条件式化 + runtime scheduled-only guard
