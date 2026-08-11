/**
 * Kiro Agent Eval Scenario Matrix（Intelligence V2 Task 4A）。
 *
 * 本文件只建立「测试场景契约」，不运行真实模型、不调用外部 AI API。
 * 用于后续判断：应调用什么 Tool、哪些 Tool 属于多余调用、合理 Tool Call 数、
 * 回答必须包含哪些事实、哪些行为必须禁止、是否及时停止 Tool Call。
 *
 * Tool 名类型来自真实 registry（KIRO_TOOLS），不手写枚举，
 * 避免后续 Tool 改名时 Eval 失真。
 */

import { KIRO_TOOLS } from "@/lib/ai/tools";

export type KiroEvalToolName = keyof typeof KIRO_TOOLS;

export type KiroEvalCategory = "read" | "plan" | "write" | "material" | "memory" | "focus";

export interface KiroEvalScenario {
  id: string;
  category: KiroEvalCategory;
  userMessage: string;
  /** 为了让 Tool 路径可判断，明确本场景已知哪些上下文 */
  contextAssumptions: string[];
  /** 本场景正确完成时必须出现的 Tool */
  requiredTools: KiroEvalToolName[];
  /** 只有数据实际需要时才允许调用。allowed ≠ 推荐调用 */
  allowedTools: KiroEvalToolName[];
  /** 本场景属于明显无必要/错误的 Tool */
  forbiddenTools: KiroEvalToolName[];
  /** 合理 Tool Call 上限（不是 Runtime hard limit） */
  maxToolCalls: number;
  /** 最终回答必须依据/覆盖的事实 */
  requiredFacts: string[];
  /** Kiro 明确不能做的事情 */
  forbiddenBehaviors: string[];
  /** Final Answer 最重要的信息 */
  answerPriorities: string[];
}

export const KIRO_EVAL_SCENARIOS: KiroEvalScenario[] = [
  {
    id: "today-task-list",
    category: "read",
    userMessage: "今天还有哪些任务？",
    contextAssumptions: ["当前日期已存在于 baseContext", "不需要任务完整描述", "用户只要求任务列表"],
    requiredTools: ["search_assignments"],
    allowedTools: [],
    forbiddenTools: ["get_assignment", "get_assignment_health", "get_available_time", "get_week_schedule", "propose_study_plan"],
    maxToolCalls: 1,
    requiredFacts: ["scope=today 的任务", "今天截止或今天有 StudyBlock 的任务", "Do Date ≠ Due Date"],
    forbiddenBehaviors: ["对每个任务逐一读取详情", "对每个任务逐一 Health", "自动规划时间"],
    answerPriorities: ["今天需要处理的任务", "必要的 DDL / 已安排信息"],
  },
  {
    id: "today-top-priority",
    category: "read",
    userMessage: "今天最该先做什么？",
    contextAssumptions: ["今天可能存在多个未完成任务", "当前没有唯一明显第一优先任务"],
    requiredTools: ["search_assignments"],
    allowedTools: ["get_assignment_health"],
    forbiddenTools: ["get_week_schedule", "read_material", "get_material_metadata", "get_user_study_profile"],
    maxToolCalls: 3,
    requiredFacts: ["今天任务清单", "第一优先任务的判定依据", "相关 DDL / Health 风险"],
    forbiddenBehaviors: ["N 个任务就 N 次 Health", "无关课程/资料读取"],
    answerPriorities: ["第一优先任务", "为什么", "DDL / 风险", "下一步"],
  },
  {
    id: "today-study-plan",
    category: "plan",
    userMessage: "帮我规划今天的学习任务。",
    contextAssumptions: ["存在多个今天相关任务", "需要真正给出时间安排"],
    requiredTools: ["search_assignments", "propose_study_plan"],
    allowedTools: ["get_assignment"],
    forbiddenTools: ["get_week_schedule", "get_calendar_range"],
    maxToolCalls: 3,
    requiredFacts: ["Proposal 中的时间安排", "每个任务的计划分钟数依据", "Proposal 尚未应用"],
    forbiddenBehaviors: ["自己看课表编 StudyBlock 时间", "声称 Proposal 已应用", "直接批量写 StudyBlock"],
    answerPriorities: ["建议安排", "未安排原因", "Proposal 需用户确认后才生效"],
  },
  {
    id: "assignment-health",
    category: "read",
    userMessage: "这个作业来得及吗？",
    contextAssumptions: ["当前 contextRefs 已提供唯一 assignmentId", "用户没有要求「具体什么时候做」"],
    requiredTools: ["get_assignment_health"],
    allowedTools: [],
    forbiddenTools: ["get_available_time", "get_week_schedule", "get_calendar_range", "propose_study_plan"],
    maxToolCalls: 1,
    requiredFacts: ["Health 状态", "gapMinutes", "截止前可用分钟数", "必要的 DDL 风险"],
    forbiddenBehaviors: ["模型自行推算是否来得及", "Health 后再次 get_available_time 二次确认"],
    answerPriorities: ["是否来得及", "缺口 / 风险", "下一步建议"],
  },
  {
    id: "weekly-pressure",
    category: "read",
    userMessage: "这周学习压力怎么样？",
    contextAssumptions: ["用户问未来约 7 天整体负荷", "不要求逐份资料内容"],
    requiredTools: ["get_upcoming_assignments"],
    allowedTools: ["get_week_schedule", "get_available_time", "get_assignment_health"],
    forbiddenTools: ["read_material", "get_material_metadata", "get_user_study_profile"],
    maxToolCalls: 4,
    requiredFacts: ["本周临近 DDL 数量/分布", "明显风险点", "可解释整体压力的必要信息"],
    forbiddenBehaviors: ["无差别读取所有任务详情", "无差别 Health 每个任务", "读取课程资料正文"],
    answerPriorities: ["整体负荷判断", "风险点", "可行动建议"],
  },
  {
    id: "tonight-free-time",
    category: "read",
    userMessage: "我今晚还有多少空闲时间？",
    contextAssumptions: ["当前日期/今晚时间窗口可由 baseContext 确定"],
    requiredTools: ["get_available_time"],
    allowedTools: [],
    forbiddenTools: ["get_week_schedule", "get_calendar_range", "propose_study_plan"],
    maxToolCalls: 1,
    requiredFacts: ["今晚空闲总量", "如果 Tool 返回具体 slots，则给出主要时段"],
    forbiddenBehaviors: ["手工用课表计算空闲时间"],
    answerPriorities: ["今晚可用时间", "主要空档时段"],
  },
  {
    id: "pdf-task-breakdown",
    category: "material",
    userMessage: "根据老师发的 PDF，帮我把这个作业拆一下。",
    contextAssumptions: ["当前 assignmentId 唯一", "assignment linkedMaterials 中有对应 PDF"],
    requiredTools: ["get_assignment", "read_material", "propose_task_breakdown"],
    allowedTools: [],
    forbiddenTools: ["get_material_metadata", "propose_study_plan"],
    maxToolCalls: 3,
    requiredFacts: ["任务要求", "已有 subtasks", "PDF 中真正相关要求", "AI estimate 必须标记估计"],
    forbiddenBehaviors: ["不读任务直接拆", "扫描课程所有附件", "把 Proposal 说成已应用"],
    answerPriorities: ["拆解建议（2–8 阶段）", "估计耗时标注", "Proposal 未应用提示"],
  },
  {
    id: "multi-assignment-week-plan",
    category: "plan",
    userMessage: "帮我安排这周这几个作业。",
    contextAssumptions: ["用户指定的几个 assignment 可以被唯一解析"],
    requiredTools: ["propose_study_plan"],
    allowedTools: ["search_assignments", "get_assignment"],
    forbiddenTools: ["create_schedule", "move_schedule"],
    maxToolCalls: 3,
    requiredFacts: ["Proposal 中的时间安排", "未安排原因", "Proposal 尚未应用"],
    forbiddenBehaviors: ["模型自己编时间", "把课程当 StudyBlock", "未确认就声称已经安排"],
    answerPriorities: ["建议安排", "未安排原因", "确认前不写入"],
  },
  {
    id: "batch-ddl-change",
    category: "write",
    userMessage: "把这两个任务的 DDL 都改到周五。",
    contextAssumptions: ["当前没有真实 assignmentId", "两个任务名称可以被搜索定位"],
    requiredTools: ["search_assignments", "apply_change_set"],
    allowedTools: [],
    forbiddenTools: ["set_assignment_ddl"],
    maxToolCalls: 3,
    requiredFacts: ["两个真实实体", "Change Set 成功/失败事实"],
    forbiddenBehaviors: ["猜 ID", "绕过 transaction", "preflight fail 后声称部分成功"],
    answerPriorities: ["两个任务都改到周五的结果", "整体校验通过/失败", "失败时明确无修改执行"],
  },
  {
    id: "create-reminder",
    category: "write",
    userMessage: "提前一小时提醒我交这个作业。",
    contextAssumptions: ["当前 assignmentId 唯一", "当前消息存在明确提醒意图"],
    requiredTools: ["create_reminder"],
    allowedTools: [],
    forbiddenTools: ["list_reminders"],
    maxToolCalls: 1,
    requiredFacts: ["relative reminder", "提前 60 分钟", "创建成功/失败"],
    forbiddenBehaviors: ["自己计算 absolute 时间", "为确认是否存在提醒先 list", "仅凭 DDL 自动创建提醒"],
    answerPriorities: ["提醒已创建", "relative 语义（跟随目标时间）"],
  },
  {
    id: "cancel-reminder",
    category: "write",
    userMessage: "把「交计量作业」的提醒取消。",
    contextAssumptions: ["当前没有 reminderId"],
    requiredTools: ["list_reminders", "delete_reminder"],
    allowedTools: [],
    forbiddenTools: [],
    maxToolCalls: 2,
    requiredFacts: ["真实 reminderId", "删除结果"],
    forbiddenBehaviors: ["多候选时猜一个删除", "未 list 就构造 reminderId"],
    answerPriorities: ["已取消的提醒", "若多个候选则询问"],
  },
  {
    id: "start-focus",
    category: "focus",
    userMessage: "现在专注统计学 45 分钟。",
    contextAssumptions: ["「统计学」课程已由当前上下文唯一确定", "duration 明确", "当前没有已知冲突状态"],
    requiredTools: ["start_focus_session"],
    allowedTools: [],
    forbiddenTools: ["get_focus_status"],
    maxToolCalls: 1,
    requiredFacts: ["45 分钟", "关联统计学", "Focus 实际启动结果"],
    forbiddenBehaviors: ["强制先读 Focus status", "把 Focus 写成 StudyBlock"],
    answerPriorities: ["专注已开始", "时长与关联课程"],
  },
  {
    id: "course-material-list",
    category: "material",
    userMessage: "这门课有哪些资料？",
    contextAssumptions: ["当前 courseId 唯一"],
    // 首选高层路径：get_material_metadata 可直接返回课程资料 metadata；
    // 若真实 schema 必须额外参数（如 materialId），可调整为 get_course（注释说明），但不得伪造 schema。
    requiredTools: ["get_material_metadata"],
    allowedTools: ["get_course"],
    forbiddenTools: ["read_material"],
    maxToolCalls: 1,
    requiredFacts: ["资料标题/类型/大小/日期等 metadata"],
    forbiddenBehaviors: ["只列资料却读取正文"],
    answerPriorities: ["资料清单（metadata）"],
  },
  {
    id: "material-requirements-summary",
    category: "material",
    userMessage: "总结一下老师这份文件里的作业要求。",
    contextAssumptions: ["当前 courseId/materialId 唯一", "文件正文尚未进入当前 attachmentsContext"],
    requiredTools: ["read_material"],
    allowedTools: [],
    forbiddenTools: ["get_week_schedule", "get_calendar_range", "get_available_time"],
    maxToolCalls: 1,
    requiredFacts: ["文件中的作业要求", "citation/source 支持", "truncated 时说明未完整读取"],
    forbiddenBehaviors: ["猜文件内容", "扫其他无关资料", "虚构 source/page"],
    answerPriorities: ["作业要求要点", "来源引用"],
  },
  {
    id: "save-study-preference-memory",
    category: "memory",
    userMessage: "记住，我以后晚上不喜欢安排数学。",
    contextAssumptions: ["Memory 功能开启", "用户明确要求跨会话记住"],
    requiredTools: ["save_memory"],
    allowedTools: [],
    forbiddenTools: ["search_assignments", "get_week_schedule", "get_available_time"],
    maxToolCalls: 1,
    requiredFacts: ["保存的是稳定 schedule preference", "不是当前业务状态"],
    forbiddenBehaviors: ["把普通聊天自动记忆", "把某个当前 DDL 当长期 Memory", "无必要读取当前课表"],
    answerPriorities: ["已记住该偏好", "将来排程会遵循"],
  },
];
