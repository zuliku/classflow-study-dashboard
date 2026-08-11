/**
 * Kiro Tool Capability Audit（Intelligence V2 Task 4B）。
 *
 * 只产出结构化审计结果（+ 测试 + 报告），本轮绝不修改任何 Tool / Prompt / Runtime。
 * 基于 15 个 Eval 场景（kiroScenarios.ts）逐项核对 Read / Write / Memory Tool 能力，
 * 为 Task 5 提供「skip / refine-existing-tools / add-minimal-tool」决策输入。
 *
 * Tool 名与 Scenario id 均派生自真实 registry，不手写 union。
 */

import { KIRO_TOOLS } from "@/lib/ai/tools";
import { KIRO_EVAL_SCENARIOS } from "@/lib/ai/eval/kiroScenarios";

export type KiroAuditedToolName = keyof typeof KIRO_TOOLS;
export type KiroEvalScenarioId = (typeof KIRO_EVAL_SCENARIOS)[number]["id"];

export type KiroToolAuditDecision = "skip" | "refine-existing-tools" | "add-minimal-tool";

export type KiroToolFindingDisposition =
  | "keep"
  | "refine-description"
  | "refine-output"
  | "refine-runtime"
  | "candidate-new-tool";

export type KiroScenarioCoverage = "direct" | "composed" | "transactional";
export type KiroScenarioGap = "none" | "low" | "medium" | "high";

export interface KiroScenarioCapabilityAudit {
  scenarioId: KiroEvalScenarioId;
  coverage: KiroScenarioCoverage;
  gap: KiroScenarioGap;
  evidence: string[];
  conclusion: string;
}

export interface KiroToolCapabilityFinding {
  id: string;
  tool: KiroAuditedToolName;
  disposition: KiroToolFindingDisposition;
  severity: "info" | "low" | "medium" | "high";
  evidence: string[];
  recommendation: string;
}

export const KIRO_TOOL_CAPABILITY_AUDIT = {
  task5Decision: "refine-existing-tools" as const,

  aggregateTool: {
    recommended: false,
    proposedName: null,
    // weekly-pressure 是唯一较明显的宽聚合场景，但单一场景不足以证明需要新 Tool
    supportingScenarioIds: ["weekly-pressure"],
    repeatedToolPattern: [],
    reason:
      "只有 weekly-pressure 一个场景重复出现 get_upcoming_assignments + get_week_schedule + get_available_time + 少数 get_assignment_health 的组合；" +
      "不满足「>= 3 个常用场景 + 相同 4+ Tool pattern + Task 3 无法消除」的严格门槛，暂不新增 aggregate Tool。",
  },

  scenarios: [
    {
      scenarioId: "today-task-list",
      coverage: "direct" as const,
      gap: "none" as const,
      evidence: [
        "search_assignments 支持 scope=today（Do Date ≠ Due Date），单次调用即可得到今日任务列表",
        "Task 3 Policy 已要求到列表即停止",
      ],
      conclusion: "现有 search_assignments 直接覆盖，无需改动。",
    },
    {
      scenarioId: "today-top-priority",
      coverage: "composed" as const,
      gap: "low" as const,
      evidence: [
        "search_assignments + 少数 get_assignment_health 即可判定第一优先",
        "get_assignment_health 内部完成 Health/scheduledMinutes/gap/截止前可用分钟数计算",
        "Task 3 Policy 已限制只对竞争第一优先级的少数候选查 Health",
      ],
      conclusion: "组合路径已由 Task 3 约束收敛，无需新增 Tool。",
    },
    {
      scenarioId: "today-study-plan",
      coverage: "composed" as const,
      gap: "none" as const,
      evidence: [
        "propose_study_plan 内部使用 assignments/studyBlocks/semester/schedules/calendarMarks 生成确定性 Proposal",
        "search_assignments 提供任务清单输入",
      ],
      conclusion: "高层确定性排程能力已存在，无需改动。",
    },
    {
      scenarioId: "assignment-health",
      coverage: "direct" as const,
      gap: "none" as const,
      evidence: [
        "get_assignment_health 已返回 health status / scheduledMinutes / gapMinutes / availableMinutesBeforeDeadline",
        "不需要 get_available_time 二次确认（Task 3 已明确）",
      ],
      conclusion: "现有 composite Health Tool 直接覆盖，是既有设计优点。",
    },
    {
      scenarioId: "weekly-pressure",
      coverage: "composed" as const,
      gap: "medium" as const,
      evidence: [
        "get_upcoming_assignments + 必要时 get_week_schedule / get_available_time / 少数 get_assignment_health 组合",
        "Eval 中没有另外 2–3 个高频场景重复同一组合",
      ],
      conclusion: "真实 composed 场景，但 aggregate Tool 证据不足（保持现状，Task 4 Eval 后续补充场景再评估）。",
    },
    {
      scenarioId: "tonight-free-time",
      coverage: "direct" as const,
      gap: "low" as const,
      evidence: [
        "get_available_time 通过确定性 free-time domain 排除课程/Calendar Marks/StudyBlocks，直接返回 slots",
        "output 仅 { startDate, endDate, slots }，无 totalMinutes，模型需自行求和（见 finding available-time-total-minutes）",
      ],
      conclusion: "路径正确；输出层可小步补齐 totalMinutes。",
    },
    {
      scenarioId: "pdf-task-breakdown",
      coverage: "composed" as const,
      gap: "none" as const,
      evidence: [
        "get_assignment → read_material → propose_task_breakdown 完整链路存在",
        "propose_task_breakdown description 已要求先 get_assignment 且按需 read_material",
      ],
      conclusion: "现有链路覆盖，无需改动。",
    },
    {
      scenarioId: "multi-assignment-week-plan",
      coverage: "composed" as const,
      gap: "none" as const,
      evidence: [
        "propose_study_plan 接受 assignmentIds 直接生成确定性排程 Proposal",
        "不允许 create_schedule / move_schedule 由模型直接写入（Proposal ≠ Applied）",
      ],
      conclusion: "高层排程工具直接覆盖，无需改动。",
    },
    {
      scenarioId: "batch-ddl-change",
      coverage: "transactional" as const,
      gap: "none" as const,
      evidence: [
        "apply_change_set 提供 preflight + atomicity + confirmation 的完整事务语义",
        "Task 3 Policy 已要求相关多项修改走 Change Set",
      ],
      conclusion: "事务 Write 语义正确，无需改动。",
    },
    {
      scenarioId: "create-reminder",
      coverage: "direct" as const,
      gap: "none" as const,
      evidence: [
        "create_reminder 支持 relative（目标 + offsetMinutes，自动解析 anchor 并跟随目标时间）",
        "explicit-intent 规则已写入 description",
      ],
      conclusion: "直接覆盖，无需改动。",
    },
    {
      scenarioId: "cancel-reminder",
      coverage: "composed" as const,
      gap: "medium" as const,
      evidence: [
        "list_reminders + delete_reminder 组合可完成定位与删除",
        "delete_reminder description 强制「删除前必须 list_reminders」（无条件），与 Task 3「无唯一 ID 才 list」冲突",
        "delete_reminder executor 无 scheduled-only guard，与 description「仅 scheduled 状态」不符（见 findings）",
      ],
      conclusion: "路径存在，但 description 与 runtime 均有待修正确认，列为 Task 5 refine。",
    },
    {
      scenarioId: "start-focus",
      coverage: "direct" as const,
      gap: "none" as const,
      evidence: [
        "start_focus_session 支持 plannedMinutes + courseId/assignmentId 直接启动",
        "Task 3 Policy 已要求直接调用、不强制先 get_focus_status",
      ],
      conclusion: "直接覆盖，无需改动。",
    },
    {
      scenarioId: "course-material-list",
      coverage: "direct" as const,
      gap: "none" as const,
      evidence: [
        "get_material_metadata 直接返回课程资料 metadata（courseId 唯一时可调用）",
        "read_material 明确禁止用于纯列表",
      ],
      conclusion: "直接覆盖，无需改动。",
    },
    {
      scenarioId: "material-requirements-summary",
      coverage: "direct" as const,
      gap: "none" as const,
      evidence: [
        "read_material 读取指定资料正文；citation 协议支持来源引用",
        "truncated 语义已由 Prompt 约束",
      ],
      conclusion: "直接覆盖，无需改动。",
    },
    {
      scenarioId: "save-study-preference-memory",
      coverage: "direct" as const,
      gap: "none" as const,
      evidence: [
        "save_memory 支持明确意图下的稳定偏好保存",
        "Task 3 Policy 已禁止无必要读取课表等",
      ],
      conclusion: "直接覆盖，无需改动。",
    },
  ],

  toolFindings: [
    {
      id: "available-time-total-minutes",
      tool: "get_available_time",
      disposition: "refine-output" as const,
      severity: "low" as const,
      evidence: [
        "executor 返回 { startDate, endDate, slots }（slots 截断为 20 条），没有 totalMinutes",
        "「今晚还有多少空闲时间」需要总分钟数；Tool 已确定性计算 slots，却让模型自己再 sum",
      ],
      recommendation: "Task 5：只给现有 Tool 输出增加 totalMinutes（确定性求和），不新增 Tool、不改 schema。",
    },
    {
      id: "delete-reminder-listing-description",
      tool: "delete_reminder",
      disposition: "refine-description" as const,
      severity: "medium" as const,
      evidence: [
        "description 写死「删除前必须用 list_reminders 拿到真实 reminderId」（无条件）",
        "Task 3 Policy 规定：只有没有唯一 reminderId 时才 list_reminders；当前 Turn 已有真实唯一 ID 时强制 list 属于无意义重复 Read",
        "update_reminder description 已是条件式：「若没有唯一 reminderId，先 list_reminders 定位」",
      ],
      recommendation: "Task 5：把 delete_reminder description 改为与 update_reminder 一致的条件式措辞。",
    },
    {
      id: "delete-reminder-scheduled-guard",
      tool: "delete_reminder",
      disposition: "refine-runtime" as const,
      severity: "high" as const,
      evidence: [
        "description 声明「仅 scheduled 状态」可删除",
        "executor deleteReminder：find by id → 直接 delete，没有 if (target.status !== 'scheduled') guard",
        "update_reminder executor 已有 scheduled-only guard（old.status !== 'scheduled' → invalidInput），delete 与之不一致",
      ],
      recommendation:
        "Task 5：删除前拒绝 fired / skipped 提醒（与 update_reminder 现有 guard 一致），错误码 INVALID_INPUT（如「历史提醒不能删除。」，文案按现有 Domain 风格确定）。",
    },
  ],
} as const;
