/**
 * Invocation Filter — Defense in Depth
 * local-user: 正常工具集
 * remote-channel: 仅 read/propose
 */

import { KIRO_WRITE_TOOL_NAMES } from "@/lib/ai/tools/write/registry";
import { KIRO_MUTATING_TOOL_NAMES } from "@/lib/ai/tools/mutating";
import type { ToolSet } from "ai";

const REMOTE_ALLOWED = new Set<string>([
  "search_courses",
  "get_course",
  "get_week_schedule",
  "search_assignments",
  "get_assignment",
  "get_assignment_schedule",
  "get_assignment_health",
  "get_available_time",
  "propose_study_plan",
  "get_upcoming_assignments",
  "search_group_projects",
  "get_group_project",
  "get_group_tasks",
  "get_calendar_range",
  "get_material_metadata",
  "read_material",
  "read_project_file",
  "search_project_file",
  "read_project_visual",
  "propose_task_breakdown",
  "list_reminders",
  "get_focus_status",
  "query_learning_history",
  "summarize_learning_history",
  "get_learning_analytics",
  "get_learning_outlook",
  "propose_study_rebalance",
  "propose_visual_actions",
  "propose_timetable_import",
  "activate_skill",
  "mcp_search_tools",
  "get_current_context",
  "get_user_study_profile",
  "begin_final_answer",
]);

export function filterKiroToolsForInvocation(opts: { tools: ToolSet; origin: "local-user" | "remote-channel" }): ToolSet {
  if (opts.origin === "local-user") return opts.tools;
  // remote-channel: allowlist
  const filtered: ToolSet = {};
  for (const [name, tool] of Object.entries(opts.tools)) {
    if (REMOTE_ALLOWED.has(name)) {
      (filtered as Record<string, unknown>)[name] = tool;
    }
  }
  return filtered;
}
