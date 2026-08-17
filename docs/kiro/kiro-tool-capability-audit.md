# Kiro Tool Capability Audit

基于 15 个 Kiro Eval 场景（`lib/ai/eval/kiroScenarios.ts`）逐项核对 Read / Write / Memory Tool 的 description、schema、executor output 与 runtime guard。结构化结果见 `lib/ai/eval/kiroToolAudit.ts`（`KIRO_TOOL_CAPABILITY_AUDIT`）。

## Decision

**skip**

Task 4B 的三个 evidence-backed Finding 已全部通过 Task 5A / 5B 关闭。当前没有新的 evidence-backed Tool hardening 任务。

## What already works well

- **deterministic Health**：`get_assignment_health` 内部完成 Deadline Health / scheduledMinutes / gap / 截止前可用分钟数计算 → "来得及吗" 不需要 `get_available_time` 二次确认
- **deterministic Available Time**：`get_available_time` 确定性排除课程 / Calendar Marks / StudyBlocks
- **deterministic Study Plan Proposal**：`propose_study_plan` 内部使用 assignments / studyBlocks / semester / schedules / calendarMarks 生成确定性排程 Proposal（是"暂不新增 dashboard aggregate Tool"的重要证据）
- **direct Material / Reminder / Focus 路径**：`get_material_metadata`、`read_material`、`create_reminder`、`start_focus_session` 等直接覆盖对应场景

## Resolved Findings

1. **get_available_time.totalMinutes → 已关闭**
   输出新增 `totalMinutes`（基于完整未截断 slots 求和；slots 详情仍最多 20 条）。Kiro 回答"今晚还有多少空闲时间"不再需要自行求和。

2. **delete_reminder conditional-list description → 已关闭**
   description 改为条件式：只有没有唯一 reminderId 时才 `list_reminders`；已有真实唯一 ID 时可直接删除；多个候选仍必须询问。

3. **delete_reminder scheduled-only runtime guard → 已关闭**
   executor 增加 scheduled-only guard：fired / skipped 返回 `INVALID_INPUT`，失败不 mutation、不注册 Undo；scheduled 删除与 exact-snapshot Undo 保持原行为。

## Aggregate Tool Decision

暂不新增 aggregate Tool（如 `get_today_study_brief` / `get_weekly_study_brief` / `get_dashboard_summary`）。

`weekly-pressure` 是目前唯一比较明显的宽聚合场景，但一个场景证据不足。

## Evidence Threshold

只有同时满足以下条件才考虑新增 aggregate Tool：

- **>= 3 个常用 Eval 场景** 重复需要
- **相同 4+ Tool 组合**（repeatedToolPattern.length >= 4）
- **Task 3 Prompt Policy 已无法可靠减少** 调用

## Eval Coverage Limits

当前 15 场景覆盖：Task、Planning、Health、Materials、Reminder、Focus、Memory、Batch Write。

**未覆盖**：Group Project CRUD、全部 Course CRUD、全部 Schedule CRUD。这些工具家族在本轮 Eval 中没有场景证据——保持现状，不得基于有限 Eval 做大范围 API 重构。"未覆盖" ≠ "无用 / 可删除"。当前审计结论不声称"所有 Kiro Tools 都已完整验证"。

## Current Next Step

没有新的 evidence-backed Tool hardening 任务。

下一阶段如果继续提升 Kiro，优先：

- 扩展 Eval Coverage（尤其 Group Project / Course / Schedule）
- 运行真实 Agent Eval（把 `KIRO_EVAL_SCENARIOS` 喂给真实 Agent runner）

不要在没有重复场景证据时新增 aggregate Tool。
