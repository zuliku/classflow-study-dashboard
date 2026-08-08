"use client";

import React from "react";
import { CalendarClock, CalendarDays, Plus, Check, ArrowDown, Undo2, PencilLine } from "lucide-react";
import { parseLocalDDL, getLocalDDLDate, getLocalDDLTime } from "@/lib/ddl";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { WriteToolResult } from "@/lib/ai/tools/write/types";

export type KiroActionCardVariant = "ddl" | "schedule" | "create" | "generic";

export interface KiroActionCardProps {
  variant: KiroActionCardVariant;
  heading: string;
  title: string;
  change?: { from: string; to: string };
  bullets?: string[];
  footer?: string;
  onUndo?: () => void;
}

/**
 * Action Result Card（真实 Tool Result 事实 UI）：
 * 内容只来自 ToolResult.action.before / after，模型不得生成。
 */
export function KiroActionCard({ variant, heading, title, change, bullets, footer, onUndo }: KiroActionCardProps) {
  const Icon =
    variant === "ddl" ? CalendarClock : variant === "schedule" ? CalendarDays : variant === "create" ? Plus : PencilLine;
  const isCreate = variant === "create";

  return (
    <div
      data-testid="kiro-action-card"
      className="max-w-md rounded-2xl bg-[#F7F5F5] border border-line p-3.5 space-y-2.5"
    >
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-lg bg-pastel-mint flex items-center justify-center shrink-0">
          <Icon className="w-3.5 h-3.5 text-charcoal" />
        </span>
        <p className="text-xs font-bold text-charcoal">{heading}</p>
      </div>

      <p className="text-xs font-bold text-charcoal pl-8">{title}</p>

      {!isCreate && change && (
        <div className="pl-8">
          <p className="text-[11px] text-sandrift">{change.from}</p>
          <ArrowDown className="w-3 h-3 text-sandrift my-0.5" />
          <p className="text-[11px] font-bold text-charcoal">{change.to}</p>
        </div>
      )}

      {isCreate && bullets && (
        <ul className="pl-8 space-y-1">
          {bullets.map((b) => (
            <li key={b} className="text-[11px] text-satin-grey flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-sandrift shrink-0" />
              {b}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between pl-8 pt-1">
        {footer ? (
          <span
            className={cn(
              "text-[10px] font-semibold flex items-center gap-1",
              footer.startsWith("✓") ? "text-success" : "text-sandrift"
            )}
          >
            {footer.startsWith("✓") && <Check className="w-3 h-3" />}
            {footer}
          </span>
        ) : (
          <span />
        )}
        {onUndo && (
          <button
            onClick={onUndo}
            className="flex items-center gap-1 text-[11px] font-semibold text-satin-grey hover:text-charcoal transition-colors"
          >
            <Undo2 className="w-3 h-3" />
            撤销
          </button>
        )}
      </div>
    </div>
  );
}

/** 本地 DDL → "M月d日 HH:mm"（显示用） */
export function formatDDLDisplay(ddl: string): string {
  const d = parseLocalDDL(ddl);
  if (!d) return ddl;
  const time = getLocalDDLTime(ddl);
  return `${format(d, "M月d日", { locale: zhCN })} ${time}`;
}

const DAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function scheduleDisplay(s: { dayOfWeek?: number; startTime?: string; endTime?: string }): string {
  const day = s.dayOfWeek ? DAY_NAMES[s.dayOfWeek - 1] ?? String(s.dayOfWeek) : "—";
  return `${day} ${s.startTime ?? "—"}–${s.endTime ?? "—"}`;
}

/** 从真实 ToolResult.action 构建 Card 视图（事实 UI，模型不得生成） */
export function actionToCardProps(
  action: Extract<WriteToolResult, { ok: true }>["action"]
): Omit<KiroActionCardProps, "onUndo"> {
  const tool = action.tool;
  const op = action.operation;
  const before = action.before as Record<string, unknown> | undefined;
  const after = action.after as Record<string, unknown> | undefined;

  // DDL 调整（任务 / 小组任务）
  if (tool === "set_assignment_ddl" || tool === "set_group_task_ddl") {
    return {
      variant: "ddl",
      heading: tool === "set_assignment_ddl" ? "已调整任务" : "已调整小组任务",
      title: action.title,
      change: {
        from: formatDDLDisplay(String(before?.ddl ?? "")),
        to: formatDDLDisplay(String(after?.ddl ?? "")),
      },
    };
  }

  // 课表调整（移动 / 时长 / 排课信息）
  if (tool === "move_schedule" || tool === "resize_schedule" || tool === "update_schedule") {
    return {
      variant: "schedule",
      heading: "已调整课程",
      title: action.title,
      change: {
        from: scheduleDisplay(before as { dayOfWeek?: number; startTime?: string; endTime?: string }),
        to: scheduleDisplay(after as { dayOfWeek?: number; startTime?: string; endTime?: string }),
      },
      footer: "未发现课程冲突",
    };
  }

  // 创建类
  if (op === "create") {
    const bullets: string[] = [];
    if (after?.ddl) bullets.push(`截止：${formatDDLDisplay(String(after.ddl))}`);
    if (after?.priority) {
      const label = after.priority === "urgent" ? "紧急" : after.priority === "high" ? "高" : after.priority === "medium" ? "中" : "低";
      bullets.push(`优先级：${label}`);
    }
    if (after?.status) {
      const label =
        after.status === "todo" ? "待完成" : after.status === "doing" ? "进行中" : after.status === "submitted" ? "已提交" : "已完成";
      bullets.push(`状态：${label}`);
    }
    if (tool === "create_schedule" && after) {
      bullets.push(`时间：${scheduleDisplay(after as { dayOfWeek?: number; startTime?: string; endTime?: string })}`);
    }
    if (bullets.length === 0 && after?.title) bullets.push(String(after.title));
    return {
      variant: "create",
      heading: tool === "create_course" ? "已创建课程" : tool === "create_group_project" ? "已创建小组项目" : "已创建",
      title: action.title,
      bullets,
    };
  }

  // 删除类
  if (op === "delete") {
    return {
      variant: "generic",
      heading: tool === "delete_assignment" ? "已删除任务" : tool === "delete_schedule" ? "已删除排课" : "已删除",
      title: action.title,
      change: before?.ddl ? { from: `截止：${formatDDLDisplay(String(before.ddl))}`, to: "已删除" } : undefined,
    };
  }

  // 其它修改（优先级/状态/进度/课程信息/成员/小组任务等）
  const parts: string[] = [];
  if (before && after) {
    for (const key of Object.keys(after)) {
      const b = before[key];
      const a = after[key];
      if (String(b ?? "") !== String(a ?? "")) {
        parts.push(`${keyLabel(key)}：${String(b ?? "—")} → ${String(a ?? "—")}`);
      }
    }
  }
  return {
    variant: "generic",
    heading: "已修改",
    title: action.title,
    bullets: parts.length > 0 ? parts.slice(0, 3) : undefined,
  };
}

function keyLabel(key: string): string {
  const map: Record<string, string> = {
    priority: "优先级",
    status: "状态",
    progress: "进度",
    ddl: "截止时间",
    title: "标题",
    name: "姓名",
    role: "角色",
    major: "专业",
    location: "地点",
    weeks: "周次",
  };
  return map[key] ?? key;
}
