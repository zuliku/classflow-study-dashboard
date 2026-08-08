import {
  LayoutDashboard,
  CalendarDays,
  ClipboardCheck,
  FolderKanban,
  Sparkles,
  BarChart3,
  Users2,
  Settings,
} from "lucide-react";
import { NavTab } from "@/types";

/**
 * Kiro 图标集中定义：Kiro 正式 Logo 落地后只需替换此处的实现，
 * 所有入口（Sidebar / BottomNav / Header / Command Center / Kiro Workspace）自动生效。
 */
export const KIRO_ICON = Sparkles;

export interface NavItem {
  id: NavTab;
  label: string;
  icon: React.ElementType;
}

/** 全局 Action（非 Workspace Tab）：打开 Settings Modal */
export interface GlobalAction {
  id: "settings";
  label: string;
  icon: React.ElementType;
}

/** 工作区导航：Sidebar（Desktop/Icon Rail）与 Bottom Nav 共用 */
export const WORKSPACE_NAV_ITEMS: NavItem[] = [
  { id: "overview", label: "总览", icon: LayoutDashboard },
  { id: "timetable", label: "我的课表", icon: CalendarDays },
  { id: "assignments", label: "任务与 DDL", icon: ClipboardCheck },
  { id: "courses", label: "课程资料", icon: FolderKanban },
  { id: "kiro", label: "Kiro", icon: KIRO_ICON },
  { id: "analytics", label: "学习统计", icon: BarChart3 },
  { id: "group", label: "小组协作", icon: Users2 },
];

/** 全局 Action：设置是 Modal 入口，不假装是 Workspace Tab */
export const GLOBAL_NAV_ACTIONS: GlobalAction[] = [
  { id: "settings", label: "设置", icon: Settings },
];

/** 移动端 Bottom Nav 主要入口（Kiro 是顶级入口，其余收进「更多」菜单） */
export const BOTTOM_NAV_MAIN: NavItem[] = [
  { id: "overview", label: "总览", icon: LayoutDashboard },
  { id: "timetable", label: "课表", icon: CalendarDays },
  { id: "assignments", label: "任务", icon: ClipboardCheck },
  { id: "kiro", label: "Kiro", icon: KIRO_ICON },
];

/** 更多菜单：课程/分析/小组为 workspace tab；设置是 action（打开 Settings Modal） */
export const BOTTOM_NAV_MORE: (NavItem | GlobalAction)[] = [
  { id: "courses", label: "课程", icon: FolderKanban },
  { id: "analytics", label: "学习统计", icon: BarChart3 },
  { id: "group", label: "小组协作", icon: Users2 },
  { id: "settings", label: "设置", icon: Settings },
];

/** 底部「更多」菜单命中判定：属于隐藏 workspace Tab 时高亮「更多」；settings 是 action，不参与 */
export const MORE_TAB_IDS: NavTab[] = ["courses", "analytics", "group"];
