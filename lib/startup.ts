import { StartupView, NavTab } from "@/types";

/**
 * 启动位置解析（纯函数）：偏好 → 初始工作区 Tab。
 * last 仅在 startupView 明确为 "last" 时生效（默认回总览）。
 */
export function resolveStartupTab(startupView: StartupView, lastWorkspaceTab: NavTab): NavTab {
  switch (startupView) {
    case "timetable":
      return "timetable";
    case "assignments":
      return "assignments";
    case "last":
      return lastWorkspaceTab;
    default:
      return "overview";
  }
}
