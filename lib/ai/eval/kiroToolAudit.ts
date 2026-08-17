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

/** 已被修复的历史 Finding（审计历史；不再作为可执行项） */
export interface KiroResolvedToolCapabilityFinding {
  id: string;
  tool: KiroAuditedToolName;
  resolution: string;
  evidence: string[];
}

export const KIRO_TOOL_CAPABILITY_AUDIT = {
  // Task 4B 有证据要求处理的 existing-tool refinement 已全部完成（Task 5A/5B）
  task5Decision: "skip" as const,

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
      gap: "none" as const,
      evidence: [
        "get_available_time 通过确定性 free-time domain 排除课程/Calendar Marks/StudyBlocks",
        "Tool 现在直接返回基于完整未截断 slots 求和的 totalMinutes，同时 slots 详情仍最多 20 条",
      ],
      conclusion: "直接覆盖：Kiro 可使用确定性 totalMinutes 回答总空闲时间，不再需要自行求和。",
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
      gap: "none" as const,
      evidence: [
        "没有唯一 reminderId 时仍使用 list_reminders 定位；已有真实唯一 ID 时 delete_reminder 可直接调用",
        "delete_reminder runtime 现在只允许 scheduled，fired/skipped 返回 INVALID_INPUT 且不 mutation/不注册 Undo",
        "scheduled Reminder 删除后仍保留 exact-snapshot Undo",
      ],
      conclusion: "定位 + 删除路径与 Task 3 Policy、Tool description、runtime guard 已一致。",
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

  // 当前无未解决的 evidence-backed Tool Finding（Task 4B 三个 Finding 已全部关闭）
  toolFindings: [] as KiroToolCapabilityFinding[],

  // 已被 Task 5A / 5B 修复的历史 Finding（审计历史，保留证据）
  resolvedFindings: [
    {
      id: "available-time-total-minutes",
      tool: "get_available_time",
      resolution: "现有 Tool 输出已增加 totalMinutes；基于完整未截断 slots 求和，slots 详情仍最多 20 条。",
      evidence: [
        "getAvailableTime 在 slice(0, 20) 前 reduce 完整 slots 得到 totalMinutes",
        "kiroPlanning focused test 覆盖短窗口相等与 >20 slots 时 totalMinutes 大于返回详情分钟和",
      ],
    },
    {
      id: "delete-reminder-listing-description",
      tool: "delete_reminder",
      resolution: "description 已改为条件式：只有没有唯一 reminderId 时才要求 list_reminders。",
      evidence: [
        "已有真实唯一 reminderId 时 description 明确允许直接删除",
        "多个候选仍要求询问用户，不得猜 ID",
      ],
    },
    {
      id: "delete-reminder-scheduled-guard",
      tool: "delete_reminder",
      resolution: "executor 已增加 scheduled-only runtime guard。",
      evidence: [
        "fired/skipped 删除返回 INVALID_INPUT",
        "失败路径不 mutation、不注册 Undo；scheduled 删除与 Undo 保持原行为",
      ],
    },
  ],
} as const;
