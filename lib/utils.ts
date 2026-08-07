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

export function getPriorityMeta(priority: Priority) {
  switch (priority) {
    case "urgent":
      return { label: "紧急", bg: "bg-[#FDF0F0]", text: "text-[#D94F4F]", border: "border-[#F8D7D7]" };
    case "high":
      return { label: "高优先", bg: "bg-[#FFF6EE]", text: "text-[#D97706]", border: "border-[#FDE6D2]" };
    case "medium":
      return { label: "中优先", bg: "bg-[#FEF8F0]", text: "text-[#B45309]", border: "border-[#FEE6C9]" };
    case "low":
      return { label: "低优先", bg: "bg-[#F2F7F3]", text: "text-[#4A7C59]", border: "border-[#D4E7D7]" };
    default:
      return { label: "普通", bg: "bg-[#F7F5F5]", text: "text-[#313032]", border: "border-[#E7E3DD]" };
  }
}

export function getStatusMeta(status: AssignmentStatus) {
  switch (status) {
    case "todo":
      return { label: "待完成", bg: "bg-[#F0EBE1]", text: "text-[#8C7A6B]" };
    case "doing":
      return { label: "进行中", bg: "bg-[#E3E6E0]", text: "text-[#3A5A40]" };
    case "submitted":
      return { label: "已提交", bg: "bg-[#E0E7FF]", text: "text-[#3730A3]" };
    case "completed":
      return { label: "已完成", bg: "bg-[#D1FAE5]", text: "text-[#065F46]" };
    default:
      return { label: "未开始", bg: "bg-[#F7F5F5]", text: "text-[#313032]" };
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
