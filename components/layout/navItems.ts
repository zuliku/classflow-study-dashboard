import {
  LayoutDashboard,
  CalendarDays,
  ClipboardCheck,
  FolderKanban,
  BarChart3,
  Users2,
  Settings,
} from "lucide-react";
import { NavTab } from "@/types";

export interface NavItem {
  id: NavTab;
  label: string;
  icon: React.ElementType;
}

/** 全站唯一导航配置：Sidebar（Desktop/Icon Rail）与 Bottom Nav 共用 */
export const NAV_ITEMS: NavItem[] = [
  { id: "overview", label: "总览", icon: LayoutDashboard },
  { id: "timetable", label: "我的课表", icon: CalendarDays },
  { id: "assignments", label: "任务与 DDL", icon: ClipboardCheck },
  { id: "courses", label: "课程资料", icon: FolderKanban },
  { id: "analytics", label: "学习统计", icon: BarChart3 },
  { id: "group", label: "小组协作", icon: Users2 },
  { id: "settings", label: "设置", icon: Settings },
];

/** 移动端 Bottom Nav 主要入口（其余收进「更多」菜单） */
export const BOTTOM_NAV_MAIN: NavItem[] = [
  { id: "overview", label: "总览", icon: LayoutDashboard },
  { id: "timetable", label: "课表", icon: CalendarDays },
  { id: "assignments", label: "任务", icon: ClipboardCheck },
  { id: "courses", label: "课程", icon: FolderKanban },
];

export const BOTTOM_NAV_MORE: NavItem[] = [
  { id: "analytics", label: "学习统计", icon: BarChart3 },
  { id: "group", label: "小组协作", icon: Users2 },
  { id: "settings", label: "设置", icon: Settings },
];

/** 底部「更多」菜单命中判定：属于隐藏 Tab 时高亮「更多」 */
export const MORE_TAB_IDS: NavTab[] = ["analytics", "group", "settings"];
