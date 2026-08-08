import { SettingsSection } from "@/types";

/**
 * Settings Registry：搜索 metadata 的唯一来源（不做 DOM 文本抓取）。
 * Preferences 的值仍来自 Zustand；这里只描述「有哪些设置、属于哪个 section」。
 */

export interface SettingDefinition {
  id: string;
  section: SettingsSection;
  title: string;
  description: string;
  keywords?: string[];
}

export const SETTINGS_REGISTRY: SettingDefinition[] = [
  // ---- 通用 ----
  {
    id: "startup-view",
    section: "general",
    title: "默认打开位置",
    description: "启动后进入的默认工作区",
    keywords: ["启动", "默认页面", "首页", "进入", "startup", "last"],
  },
  // ---- 个人资料 ----
  {
    id: "avatar-url",
    section: "profile",
    title: "头像地址",
    description: "头像图片 URL，留空使用首字占位",
    keywords: ["头像", "avatar", "图片", "照片"],
  },
  // ---- 学期与课表 ----
  {
    id: "show-weekends",
    section: "semester",
    title: "显示周末",
    description: "在课表中显示周六与周日",
    keywords: ["课表", "星期", "周六", "周日", "weekend"],
  },
  {
    id: "semester-overview",
    section: "semester",
    title: "当前学期",
    description: "开学日期、教学周数与当前进度",
    keywords: ["学期", "校历", "周数", "开学", "结束日期"],
  },
  // ---- 任务 ----
  {
    id: "ddl-warning-days",
    section: "tasks",
    title: "临近截止提醒",
    description: "未来多少天内显示截止任务",
    keywords: ["截止", "提醒", "warning", "ddl", "ddl 提醒"],
  },
  {
    id: "default-ddl-time",
    section: "tasks",
    title: "默认截止时间",
    description: "新建任务的默认截止时刻",
    keywords: ["截止", "时间", "ddl", "新建任务", "预填"],
  },
  {
    id: "default-task-priority",
    section: "tasks",
    title: "默认优先级",
    description: "新建任务的默认优先级",
    keywords: ["优先级", "priority", "新建任务"],
  },
  {
    id: "default-task-status",
    section: "tasks",
    title: "默认状态",
    description: "新建任务的默认状态（待完成 / 进行中）",
    keywords: ["任务状态", "状态", "status", "新建任务"],
  },
  // ---- 交互与快捷键 ----
  {
    id: "schedule-direct-manipulation",
    section: "interaction",
    title: "课表直接操作",
    description: "在完整课表中启用拖动调整与缩放排课",
    keywords: ["拖拽", "拖动", "课表", "drag", "resize", "直接操作"],
  },
  {
    id: "ddl-direct-manipulation",
    section: "interaction",
    title: "DDL 直接操作",
    description: "在日历中启用拖动调整截止日期",
    keywords: ["拖拽", "拖动", "日历", "ddl", "drag", "直接操作"],
  },
  {
    id: "single-key-shortcuts",
    section: "interaction",
    title: "启用单键快捷键",
    description: "N、J/K、X 等单键快速操作",
    keywords: ["快捷键", "键盘", "按键", "single key", "shortcut"],
  },
  {
    id: "content-density",
    section: "interaction",
    title: "界面密度",
    description: "任务工作区、课程列表与命令中心的行高与间距",
    keywords: ["密度", "紧凑", "舒适", "行高", "density", "compact"],
  },
  {
    id: "motion-preference",
    section: "interaction",
    title: "动效偏好",
    description: "界面动画强度；跟随系统时尊重系统减弱动效设置",
    keywords: ["动效", "动画", "motion", "reduced", "减少"],
  },
  // ---- 数据与存储 ----
  {
    id: "backup-full",
    section: "data",
    title: "完整备份",
    description: "导出包含课程资料文件的完整备份",
    keywords: ["备份", "导出", "zip", "附件"],
  },
  {
    id: "backup-json",
    section: "data",
    title: "仅数据备份",
    description: "导出不含课程资料的 JSON 备份",
    keywords: ["备份", "导出", "json", "仅数据"],
  },
  {
    id: "restore-data",
    section: "data",
    title: "恢复数据",
    description: "从 ClassFlow 备份恢复课程、任务与设置",
    keywords: ["备份", "恢复", "导入", "restore"],
  },
];

export function normalizeQuery(query: string): string {
  return (query || "").trim().toLowerCase().replace(/\s+/g, "");
}

/** 简单匹配：normalize + includes + keywords（不引入 fuzzy 依赖） */
export function searchSettings(query: string): SettingDefinition[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  return SETTINGS_REGISTRY.filter((s) => {
    if (s.title.toLowerCase().includes(q)) return true;
    if (s.description.toLowerCase().includes(q)) return true;
    return (s.keywords ?? []).some((k) => normalizeQuery(k).includes(q));
  });
}
