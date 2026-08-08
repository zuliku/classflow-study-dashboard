/**
 * Tool → 用户语义标签：Activity Trace 只展示「查看了哪些 ClassFlow 数据」，
 * 禁止展示内部工具名 / JSON / 参数。
 */
export const KIRO_TOOL_LABELS: Record<string, string> = {
  get_current_context: "读取当前上下文",
  get_user_study_profile: "读取学习信息",
  search_courses: "查找课程",
  get_course: "读取课程信息",
  get_week_schedule: "查看课表",
  search_assignments: "查找任务",
  get_assignment: "读取任务详情",
  get_upcoming_assignments: "查看近期 DDL",
  search_group_projects: "查找小组项目",
  get_group_project: "读取小组项目",
  get_group_tasks: "查看小组任务",
  get_calendar_range: "查看日历",
  get_material_metadata: "查看课程资料",
};

export function toolLabel(toolName: string): string {
  return KIRO_TOOL_LABELS[toolName] ?? "读取数据";
}
