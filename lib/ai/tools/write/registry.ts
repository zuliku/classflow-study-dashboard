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
      "调用前必须先通过读取工具解析真实实体 ID；存在歧义时先询问用户。Risk 与确认由系统决定，不要提供 risk 字段。",
    inputSchema: KIRO_WRITE_TOOL_SCHEMAS.apply_change_set,
  }),
};

export const KIRO_WRITE_TOOL_NAMES = Object.keys(KIRO_WRITE_TOOLS) as (keyof typeof KIRO_WRITE_TOOLS)[];
