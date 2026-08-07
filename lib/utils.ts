import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { KeyboardEvent } from "react";
import { format, differenceInCalendarDays, parseISO, isToday, isTomorrow, isPast } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Priority, AssignmentStatus } from "@/types";
import { parseLocalDDL } from "@/lib/ddl";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format ISO date string into human readable relative countdown
 * DDL 按本地时间语义解析（旧 Z 数据兼容）
 */
export function getDDLStatusText(ddlISO: string): { text: string; isUrgent: boolean } {
  const ddlDate = parseLocalDDL(ddlISO);
  if (!ddlDate) {
    return { text: "待定", isUrgent: false };
  }

  const today = new Date();

  if (isToday(ddlDate)) {
    return { text: "今天截止", isUrgent: true };
  }
  if (isTomorrow(ddlDate)) {
    return { text: "明天截止", isUrgent: true };
  }

  const diffDays = differenceInCalendarDays(ddlDate, today);

  if (diffDays < 0) {
    return { text: `已超时 ${Math.abs(diffDays)} 天`, isUrgent: true };
  }
  if (diffDays === 0) {
    return { text: "今天截止", isUrgent: true };
  }

  return { text: `${diffDays}天后截止`, isUrgent: diffDays <= 3 };
}

/**
 * 低饱和语义色体系：同一暖色系内以深浅/背景区分，不做彩虹化。
 * danger=砖红 / warning=暖褐 / success=鼠尾草绿 / neutral=砂石米。
 */
export function getPriorityMeta(priority: Priority) {
  switch (priority) {
    case "urgent":
      return { label: "紧急", bg: "bg-danger-bg", text: "text-danger", border: "border-danger-border" };
    case "high":
      return { label: "高优先", bg: "bg-warning-bg", text: "text-warning", border: "border-warning-border" };
    case "medium":
      return { label: "中优先", bg: "bg-alabaster", text: "text-charcoal", border: "border-stone-beige" };
    case "low":
      return { label: "低优先", bg: "bg-pastel-mint", text: "text-satin-grey", border: "border-ashy-beige" };
    default:
      return { label: "普通", bg: "bg-surface", text: "text-charcoal", border: "border-line" };
  }
}

export function getStatusMeta(status: AssignmentStatus) {
  switch (status) {
    case "todo":
      return { label: "待完成", bg: "bg-alabaster", text: "text-satin-grey" };
    case "doing":
      return { label: "进行中", bg: "bg-pastel-mint", text: "text-charcoal" };
    case "submitted":
      return { label: "已提交", bg: "bg-alba", text: "text-charcoal" };
    case "completed":
      return { label: "已完成", bg: "bg-success-bg", text: "text-success" };
    default:
      return { label: "未开始", bg: "bg-surface", text: "text-charcoal" };
  }
}

export function formatTimeRange(start: string, end: string): string {
  return `${start} - ${end}`;
}

export function formatDateCN(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "yyyy-MM-dd HH:mm", { locale: zhCN });
  } catch {
    return dateStr;
  }
}

/** 可点击卡片（div onClick）的键盘等价处理：Enter / Space 触发 */
export function cardKeyHandler(handler: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handler();
    }
  };
}

/** 生成带随机后缀的实体 ID，避免同一毫秒批量创建时冲突 */
export function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
