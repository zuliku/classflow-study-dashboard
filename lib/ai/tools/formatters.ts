/**
 * Tool → 用户语义标签（Read + Write 统一来源）：
 * Activity Trace 只展示「查看了哪些数据 / 执行了什么操作」，
 * 禁止展示内部工具名 / JSON / 参数。
 */
export const KIRO_TOOL_LABELS: Record<string, string> = {
  // Read
  get_current_context: "读取当前上下文",
  get_user_study_profile: "读取学习信息",
  search_courses: "查找课程",
  get_course: "读取课程信息",
  get_week_schedule: "查看课表",
  search_assignments: "查找任务",
  get_assignment: "读取任务详情",
  get_assignment_schedule: "读取学习安排",
  get_assignment_health: "检查任务规划状态",
  get_available_time: "查询可用学习时间",
  propose_study_plan: "生成学习计划建议",
  get_upcoming_assignments: "查看近期 DDL",
  search_group_projects: "查找小组项目",
  get_group_project: "读取小组项目",
  get_group_tasks: "查看小组任务",
  get_calendar_range: "查看日历",
  get_material_metadata: "查看课程资料",
  read_material: "读取资料正文",
  list_reminders: "查看提醒",
  // Write
  create_assignment: "创建任务",
  update_assignment: "修改任务",
  set_assignment_ddl: "调整截止时间",
  set_assignment_priority: "设置优先级",
  set_assignment_status: "设置状态",
  set_assignment_progress: "更新进度",
  toggle_assignment_subtask: "切换子任务",
  delete_assignment: "删除任务",
  create_schedule: "创建排课",
  move_schedule: "移动课程",
  resize_schedule: "调整课程时长",
  update_schedule: "修改排课",
  exclude_schedule_week: "排除教学周",
  delete_schedule: "删除排课",
  create_course: "创建课程",
  update_course: "修改课程",
  create_group_project: "创建小组项目",
  update_group_project: "修改小组项目",
  add_group_member: "添加成员",
  update_group_member: "修改成员",
  create_group_task: "创建小组任务",
  update_group_task: "修改小组任务",
  assign_group_task: "分配小组任务",
  set_group_task_ddl: "调整小组任务截止时间",
  toggle_group_task: "切换小组任务状态",
  // Reminder
  create_reminder: "创建提醒",
  update_reminder: "修改提醒",
  delete_reminder: "删除提醒",
  // Focus
  get_focus_status: "查看专注状态",
  start_focus_session: "开始专注",
  pause_focus_session: "暂停专注",
  resume_focus_session: "继续专注",
  finish_focus_session: "结束专注",
  // Memory
  search_memories: "读取学习偏好",
  save_memory: "保存学习偏好",
  update_memory: "更新学习偏好",
  delete_memory: "删除学习偏好",
  apply_change_set: "整体修改",
  // Task 14：Kiro Search（联网搜索；产品层叫 Kiro Search，不显示 Tavily）
  web_search: "搜索网络",
};

export function toolLabel(toolName: string): string {
  return KIRO_TOOL_LABELS[toolName] ?? "执行操作";
}

/** 写操作成功 Toast 文案 */
export function actionToastMessage(action: { tool: string; operation: string; title: string }): string {
  const opText =
    action.operation === "create"
      ? "已创建"
      : action.operation === "delete"
        ? "已删除"
        : "已调整";
  if (action.tool === "create_reminder" || action.tool === "update_reminder" || action.tool === "delete_reminder") {
    return `Kiro ${opText}提醒「${action.title}」`;
  }
  return `Kiro ${opText}${action.title ? `「${action.title}」` : ""}`;
}
