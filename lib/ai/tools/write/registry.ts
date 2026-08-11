import { tool } from "ai";
import { KIRO_WRITE_TOOL_SCHEMAS } from "@/lib/ai/tools/write/schemas";

/**
 * Write Tool 唯一注册表（Server 提供 schema；Client 按同名执行）。
 * Write Tools 没有 server execute：全部由 Browser Executor 执行。
 * 高风险工具（delete_*）由 risk 策略在 Client 侧强制确认。
 */
export const KIRO_WRITE_TOOLS = {
  create_assignment: tool({
    description:
      "创建学习任务（标题与课程必填）。截止时间（ddl）与预计耗时（estimatedMinutes）可选——任务允许没有截止时间，" +
      "不要为了满足参数而凭空生成 DDL。默认优先级/状态来自用户偏好。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.create_assignment,
  }),
  update_assignment: tool({
    description: "修改任务的标题、描述、标签或预计耗时（estimatedMinutes：数字=设置，null=清除预计耗时）。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.update_assignment,
  }),
  set_assignment_ddl: tool({
    description:
      "设置/修改任务截止时间（本地时间 YYYY-MM-DDTHH:mm）；ddl 传 null 表示清除截止时间，关联日历标记会同步删除。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.set_assignment_ddl,
  }),
  set_assignment_priority: tool({
    description: "修改任务优先级（紧急/高/中/低）。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.set_assignment_priority,
  }),
  set_assignment_status: tool({
    description: "修改任务状态（待完成/进行中/已提交/已完成）。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.set_assignment_status,
  }),
  set_assignment_progress: tool({
    description: "修改任务进度（0-100），状态自动同步。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.set_assignment_progress,
  }),
  toggle_assignment_subtask: tool({
    description: "切换任务子步骤的完成状态。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.toggle_assignment_subtask,
  }),
  delete_assignment: tool({
    description: "删除任务（高风险，需要用户确认）。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.delete_assignment,
  }),
  create_schedule: tool({
    description: "创建排课。若与现有课程时间冲突将拒绝写入。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.create_schedule,
  }),
  move_schedule: tool({
    description: "移动课程到新的星期与开始时间，保持原时长；冲突时拒绝。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.move_schedule,
  }),
  resize_schedule: tool({
    description: "调整课程结束时间（15 分钟吸附，最短 30 分钟，不晚于 21:00）。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.resize_schedule,
  }),
  update_schedule: tool({
    description: "修改排课普通信息（地点/周次/时间等）；时间变化会做冲突检查。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.update_schedule,
  }),
  exclude_schedule_week: tool({
    description: "排除某教学周（调课/停课），该周不再显示此课。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.exclude_schedule_week,
  }),
  delete_schedule: tool({
    description: "删除单个排课（高风险，需要用户确认）。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.delete_schedule,
  }),
  create_course: tool({
    description: "创建课程（基本信息；外观使用默认配色）。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.create_course,
  }),
  update_course: tool({
    description: "修改课程基本信息（名称/代码/教师/教室/学分/描述）。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.update_course,
  }),
  create_group_project: tool({
    description: "创建小组项目。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.create_group_project,
  }),
  update_group_project: tool({
    description: "修改小组项目标题或描述。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.update_group_project,
  }),
  add_group_member: tool({
    description: "向小组项目添加成员（不包含头像）。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.add_group_member,
  }),
  update_group_member: tool({
    description: "修改成员姓名/角色/专业；唯一负责人不能被降级。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.update_group_member,
  }),
  create_group_task: tool({
    description: "创建小组任务（DDL 为本地时间 YYYY-MM-DDTHH:mm:ss）。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.create_group_task,
  }),
  update_group_task: tool({
    description: "修改小组任务标题。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.update_group_task,
  }),
  assign_group_task: tool({
    description: "分配小组任务给项目内成员（null = 取消分配）。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.assign_group_task,
  }),
  set_group_task_ddl: tool({
    description: "修改小组任务截止时间（本地时间 YYYY-MM-DDTHH:mm:ss，不做时区转换）。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.set_group_task_ddl,
  }),
  toggle_group_task: tool({
    description: "切换小组任务完成状态。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.toggle_group_task,
  }),
  apply_change_set: tool({
    description:
      "把一组相互关联的 ClassFlow 修改作为一个事务整体执行（全部合法才全部提交，任一失败则一项都不改）。" +
      "当用户明确要求两个及以上相关修改（批量调整 DDL / 优先级、跨课程课表协调等）时优先使用本工具，而不是连续调用多个独立写工具。" +
      "调用前必须先通过读取工具解析真实实体 ID；存在歧义时先询问用户。Risk 与确认由系统决定，不要提供 risk 字段。" +
      "例外：Reminder 工具（create_reminder / update_reminder / delete_reminder）不属于 Change Set V1，多个提醒操作请直接调用对应工具。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.apply_change_set,
  }),
  create_reminder: tool({
    description:
      "创建提醒（只有用户当前明确要求提醒时才调用：'提醒我…' '设置一个提醒…' '帮我加个提醒…' 等；仅提到 DDL / 截止不构成授权）。" +
      "relative：目标 + offsetMinutes（提前 0 到 30 天，负数为提前），模型不提供 triggerAt，Executor 按目标当前 anchor 自动解析并跟随目标时间变化。" +
      "absolute：用户明确给出具体时间（如'明天晚上 8 点'）时使用；无业务对象 → standalone；有明确任务 → assignment + absolute。" +
      "relative 优先于模型手算 absolute 时间（相对会跟随 DDL）。已完成任务禁止新增 relative 提醒。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.create_reminder,
  }),
  update_reminder: tool({
    description:
      "修改已有提醒（仅 scheduled 提醒可修改；fired / skipped 历史提醒不能重新激活）。" +
      "修改前若没有唯一 reminderId，先 list_reminders 定位；多个候选必须询问用户。不支持更换目标（换目标 = 删除旧 + 新建新）。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.update_reminder,
  }),
  delete_reminder: tool({
    description:
      "删除 / 取消提醒（仅 scheduled 状态；删除有 Undo 可恢复原记录）。" +
      "若当前消息没有唯一 reminderId，先 list_reminders 定位；已有真实唯一 reminderId 时可直接删除。" +
      "多个候选必须询问用户，不得猜 ID。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.delete_reminder,
  }),
  start_focus_session: tool({
    description:
      "开始一个专注会话（Focus Session）。plannedMinutes 为整数 1–240；可选关联 Assignment 或 Course（自动取真实 courseId 与标题快照）。" +
      "全局同时最多一个进行中的会话；已有 running/paused 会话时失败。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.start_focus_session,
  }),
  pause_focus_session: tool({
    description: "暂停当前进行中的专注会话（已暂停 → 失败）。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.pause_focus_session,
  }),
  resume_focus_session: tool({
    description: "恢复当前已暂停的专注会话（未暂停 → 失败）。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.resume_focus_session,
  }),
  finish_focus_session: tool({
    description: "提前结束当前进行中的专注会话（无进行中会话 → 失败）。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.finish_focus_session,
  }),
};

export const KIRO_WRITE_TOOL_NAMES = Object.keys(KIRO_WRITE_TOOLS) as (keyof typeof KIRO_WRITE_TOOLS)[];
