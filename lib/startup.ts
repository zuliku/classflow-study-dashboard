import { StartupView, NavTab } from "@/types";

/**
 * 启动位置解析（纯函数）：偏好 → 初始工作区 Tab。
 * last 仅在 startupView 明确为 "last" 时生效（默认回总览）。
 */
export function resolveStartupTab(
  startupView: StartupView,
  lastWorkspaceTab: NavTab,
  todayWorkspaceEnabled = true
): NavTab {
  const fallback = (tab: NavTab): NavTab =>
    !todayWorkspaceEnabled && tab === "today" ? "overview" : tab;
  switch (startupView) {
    case "today":
      return fallback("today");
    case "timetable":
      return "timetable";
    case "assignments":
      return "assignments";
    case "last":
      return fallback(lastWorkspaceTab);
    default:
      return "overview";
  }
}
