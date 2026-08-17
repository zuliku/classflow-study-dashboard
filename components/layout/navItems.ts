import {
  LayoutDashboard,
  CalendarDays,
  ClipboardCheck,
  Library,
  BarChart3,
  Users2,
  Bell,
  Settings,
} from "lucide-react";
import { NavTab } from "@/types";
import { KiroLogoIcon } from "@/components/kiro/KiroLogo";

/**
 * Kiro 图标集中定义：正式 Kiro Logo（透明 PNG，KiroLogoIcon）。
 * 所有入口（Sidebar / BottomNav / Header / Command Center / Kiro Workspace / Ask Kiro）自动生效。
 * 品牌 Logo ≠ 功能图标：AI 魔法类操作仍可用 Sparkles，这里只替换「Kiro 本身」。
 */
export const KIRO_ICON = KiroLogoIcon;

export interface NavItem {
  id: NavTab;
  label: string;
  icon: React.ElementType;
  /** 分组元数据：main = 核心学习功能；ai = AI Agent 独立区域 */
  section?: "main" | "ai";
}

/** 全局 Action（非 Workspace Tab）：Reminder Center 面板 / Settings Modal */
export interface GlobalAction {
  id: "reminders" | "settings";
  label: string;
  icon: React.ElementType;
}

/** 工作区导航：Sidebar（Desktop/Icon Rail）与 Bottom Nav 共用；Kiro 独立为 AI 区域 */
export const WORKSPACE_NAV_ITEMS: NavItem[] = [
  { id: "overview", label: "总览", icon: LayoutDashboard, section: "main" },
  { id: "timetable", label: "时间表", icon: CalendarDays, section: "main" },
  { id: "assignments", label: "任务与 DDL", icon: ClipboardCheck, section: "main" },
  // 课程资料 = Learning Resource Library（PDF/DOCX/PPT 与课程文件集合）
  { id: "courses", label: "课程资料", icon: Library, section: "main" },
  { id: "analytics", label: "学习洞察", icon: BarChart3, section: "main" },
  { id: "group", label: "小组协作", icon: Users2, section: "main" },
  { id: "kiro", label: "Kiro", icon: KIRO_ICON, section: "ai" },
];

/** 核心学习功能（Sidebar 主区域渲染顺序） */
export const MAIN_NAV_ITEMS: NavItem[] = WORKSPACE_NAV_ITEMS.filter((i) => i.section !== "ai");

/** AI Agent 区域（Sidebar Featured Entry） */
export const AI_NAV_ITEMS: NavItem[] = WORKSPACE_NAV_ITEMS.filter((i) => i.section === "ai");

/** 全局 Action：Reminder Center 与 Settings 都是入口，不假装是 Workspace Tab */
export const GLOBAL_NAV_ACTIONS: GlobalAction[] = [
  { id: "reminders", label: "提醒", icon: Bell },
  { id: "settings", label: "设置", icon: Settings },
];

/** 移动端 Bottom Nav 主要入口（Kiro 是顶级入口，其余收进「更多」菜单） */
export const BOTTOM_NAV_MAIN: NavItem[] = [
  { id: "overview", label: "总览", icon: LayoutDashboard },
  { id: "timetable", label: "时间表", icon: CalendarDays },
  { id: "assignments", label: "任务", icon: ClipboardCheck },
  { id: "kiro", label: "Kiro", icon: KIRO_ICON },
];

/** 更多菜单：课程/分析/小组为 workspace tab；提醒/设置是 action（面板 / Modal）。
 *  课程资料图标与 WORKSPACE_NAV_ITEMS 同源（Library）。 */
export const BOTTOM_NAV_MORE: (NavItem | GlobalAction)[] = [
  { id: "courses", label: "课程", icon: Library },
  { id: "analytics", label: "学习洞察", icon: BarChart3 },
  { id: "group", label: "小组协作", icon: Users2 },
  { id: "reminders", label: "提醒", icon: Bell },
  { id: "settings", label: "设置", icon: Settings },
];

/** 底部「更多」菜单命中判定：属于隐藏 workspace Tab 时高亮「更多」；settings 是 action，不参与 */
export const MORE_TAB_IDS: NavTab[] = ["courses", "analytics", "group"];
