import { tool } from "ai";
import { KIRO_READ_TOOL_SCHEMAS } from "@/lib/ai/tools/read/schemas";

/**
 * Read Tool 唯一注册表（Server 提供 schema / Client 按同名执行）。
 * Read Tools 没有 server execute：只向 Browser 发 Tool Call，由 Client Executor 执行。
 * 后续 Write Tools 复用同一注册机制。
 */
export const KIRO_READ_TOOLS = {
  get_current_context: tool({
    description: "了解当前 ClassFlow 页面与选中对象（当前教学周、当前课程、当前任务、当前时间）。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_current_context,
  }),
  get_user_study_profile: tool({
    description: "读取用户的学习档案（姓名、学院、年级、学分进度）。不包含学号等敏感信息。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_user_study_profile,
  }),
  search_courses: tool({
    description: "按名称/代码/教师搜索课程。多个匹配时全部返回候选，不得猜测唯一对象。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.search_courses,
  }),
  get_course: tool({
    description: "读取指定课程的详细信息（基本信息、排课摘要、资料 metadata）。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_course,
  }),
  get_week_schedule: tool({
    description: "查看某教学周的生效课表（默认当前周；正确处理单双周/excludedWeeks）。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_week_schedule,
  }),
  search_assignments: tool({
    description: "按关键词/课程/状态/截止范围搜索任务。多个匹配时全部返回候选。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.search_assignments,
  }),
  get_assignment: tool({
    description: "读取指定任务的完整学习信息（描述、DDL、优先级、状态、子任务）。只读，不修改。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_assignment,
  }),
  get_upcoming_assignments: tool({
    description: "查看未来 N 天内截止的任务（默认 7 天），按 DDL 升序，默认排除已完成，逾期单独标记。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_upcoming_assignments,
  }),
  search_group_projects: tool({
    description: "按关键词/课程搜索小组项目。多个匹配时全部返回候选。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.search_group_projects,
  }),
  get_group_project: tool({
    description: "读取小组项目详情（成员与任务；不包含头像，未分配成员为 null，不得猜成员）。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_group_project,
  }),
  get_group_tasks: tool({
    description: "按条件查看小组项目中的任务（可指定成员/完成状态）。DDL 为本地时间，不做时区转换。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_group_tasks,
  }),
  get_calendar_range: tool({
    description: "查看日期范围内（最长 90 天）的日历标记（课程/DDL/考试/活动）。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_calendar_range,
  }),
  get_material_metadata: tool({
    description: "查看课程资料的 metadata（标题/类型/大小/日期）。不能读取文件正文。",
    inputSchema: KIRO_READ_TOOL_SCHEMAS.get_material_metadata,
  }),
};

export const KIRO_READ_TOOL_NAMES = Object.keys(KIRO_READ_TOOLS) as (keyof typeof KIRO_READ_TOOLS)[];
