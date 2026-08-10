"use client";

import React from "react";
import { CalendarClock, CalendarDays, Plus, Check, ArrowDown, Undo2, PencilLine, Layers, ChevronDown, Bell } from "lucide-react";
import { parseLocalDDL, getLocalDDLDate, getLocalDDLTime } from "@/lib/ddl";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { WriteToolResult } from "@/lib/ai/tools/write/types";

export type KiroActionCardVariant = "ddl" | "schedule" | "create" | "generic" | "change-set" | "reminder";

export interface KiroActionCardProps {
  variant: KiroActionCardVariant;
  heading: string;
  title: string;
  change?: { from: string; to: string };
  bullets?: string[];
  footer?: string;
  onUndo?: () => void;
  /** 可展开的明细行（Change Set 内部动作等） */
  details?: { label: string }[];
}

/**
 * Action Result Card（真实 Tool Result 事实 UI）：
 * 内容只来自 ToolResult.action.before / after，模型不得生成。
 */
export function KiroActionCard({ variant, heading, title, change, bullets, footer, onUndo, details }: KiroActionCardProps) {
  const Icon =
    variant === "ddl"
      ? CalendarClock
      : variant === "schedule"
        ? CalendarDays
        : variant === "create"
          ? Plus
          : variant === "change-set"
            ? Layers
            : variant === "reminder"
              ? Bell
              : PencilLine;
  const isCreate = variant === "create";
  const showBullets = isCreate || variant === "change-set" || variant === "reminder";

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

      {(showBullets) && bullets && (
        <ul className="pl-8 space-y-1">
          {bullets.map((b) => (
            <li key={b} className="text-[11px] text-satin-grey flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-sandrift shrink-0" />
              {b}
            </li>
          ))}
        </ul>
      )}

      {/* Change Set 明细（展开可见具体动作，不生成多张 Card） */}
      {variant === "change-set" && details && details.length > 0 && (
        <details className="pl-8 group">
          <summary className="cursor-pointer text-[10px] font-semibold text-sandrift hover:text-charcoal transition-colors list-none flex items-center gap-1">
            <ChevronDown className="w-3 h-3 transition-transform duration-[var(--motion-fast)] group-open:rotate-180" />
            查看明细
          </summary>
          <ul className="mt-1.5 space-y-1">
            {details.map((d) => (
              <li key={d.label} className="text-[10px] text-satin-grey flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-sandrift shrink-0" />
                {d.label}
              </li>
            ))}
          </ul>
        </details>
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

/** relative offset → 用户语义（0 → 到期时；-60 → 提前 1 小时；任意 offset 优雅 fallback） */
function relativeOffsetLabel(offsetMinutes: number | undefined): string {
  const offset = offsetMinutes ?? 0;
  if (offset === 0) return "到期时";
  const abs = Math.abs(offset);
  const unit =
    abs % 1440 === 0 && abs > 0
      ? `${abs / 1440} 天`
      : abs % 60 === 0 && abs > 0
        ? `${abs / 60} 小时`
        : `${abs} 分钟`;
  return `提前 ${unit}`;
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

  // Change Set（Task 8）：一组修改的整体结果（不生成多张 Card）
  if (tool === "apply_change_set" && action.changeSet) {
    const cs = action.changeSet;
    const grouped = new Map<string, number>();
    for (const a of cs.actions) {
      const label = CHANGE_SET_ACTION_LABELS[a.tool] ?? "修改";
      grouped.set(label, (grouped.get(label) ?? 0) + 1);
    }
    return {
      variant: "change-set",
      heading: `已完成 ${cs.count} 项修改`,
      title: cs.summary,
      bullets: Array.from(grouped.entries()).map(([label, n]) => `${label} ${n} 项`),
      details: cs.actions.map((a) => ({ label: `${a.title}（${CHANGE_SET_ACTION_LABELS[a.tool] ?? "修改"}）` })),
    };
  }

  // Reminder（Task 7G-B）：只展示用户语义，不暴露 timingMode / offsetMinutes 等内部字段
  if (tool === "create_reminder" || tool === "update_reminder" || tool === "delete_reminder") {
    const after = action.after as { timingMode?: string; offsetMinutes?: number; triggerAt?: string } | undefined;
    const before = action.before as { timingMode?: string; offsetMinutes?: number; triggerAt?: string } | undefined;
    const lineOf = (t: { timingMode?: string; offsetMinutes?: number; triggerAt?: string } | undefined): string =>
      [t?.timingMode === "relative" ? relativeOffsetLabel(t.offsetMinutes) : t?.timingMode === "absolute" ? "自定义时间" : "", t?.triggerAt ? formatDDLDisplay(t.triggerAt) : ""]
        .filter(Boolean)
        .join(" · ");
    if (op === "create") {
      return {
        variant: "reminder",
        heading: "已创建提醒",
        title: action.title,
        bullets: after ? [lineOf(after)] : undefined,
      };
    }
    if (op === "delete") {
      return {
        variant: "reminder",
        heading: "已删除提醒",
        title: action.title,
        change: before ? { from: lineOf(before), to: "已删除" } : undefined,
      };
    }
    return {
      variant: "reminder",
      heading: "已调整提醒",
      title: action.title,
      change: { from: lineOf(before), to: lineOf(after) },
    };
  }

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

const CHANGE_SET_ACTION_LABELS: Record<string, string> = {
  set_assignment_ddl: "调整任务截止时间",
  set_assignment_priority: "修改任务优先级",
  set_assignment_status: "修改任务状态",
  set_assignment_progress: "修改任务进度",
  update_assignment: "修改任务信息",
  toggle_assignment_subtask: "切换任务子步骤",
  delete_assignment: "删除任务",
  move_schedule: "移动课程",
  resize_schedule: "调整课程时长",
  update_schedule: "调整课程排课",
  exclude_schedule_week: "排除教学周",
  delete_schedule: "删除排课",
  update_course: "修改课程信息",
  update_group_project: "修改小组项目",
  update_group_member: "修改小组成员",
  update_group_task: "修改小组任务",
  assign_group_task: "调整任务分配",
  set_group_task_ddl: "调整小组任务截止时间",
  toggle_group_task: "切换小组任务状态",
};
