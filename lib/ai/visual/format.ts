/**
 * Visual Action Intake：Preflight Facts → Action Row 展示（纯 formatter）。
 * V1.1 Trust Hardening：Proposal UI 的 kind/title/subtitle 完全由 PreparedActionView + 当前 state 推导，
 * 模型不提供任何 display 字段（模型只能决定 evidence + business change）。
 */
import { format } from "date-fns";
import { AppState } from "@/store/useAppStore";
import { PreparedActionView } from "@/lib/ai/tools/write/prepare";
import {
  VISUAL_KIND_OF_TOOL,
  VisualActionKind,
} from "@/lib/ai/visual/types";
import { parseLocalDDL } from "@/lib/ddl";

const WEEKDAY_LABELS: Record<number, string> = {
  1: "周一",
  2: "周二",
  3: "周三",
  4: "周四",
  5: "周五",
  6: "周六",
  7: "周日",
};

const weekday = (d?: number): string => (d && WEEKDAY_LABELS[d]) || (d ? `周${d}` : "");

/** "2026-08-20T23:59:00" → "8月20日 23:59"（本地时间；无 DDL → null） */
function formatDDL(ddl?: string | null): string | null {
  if (!ddl) return null;
  const parsed = parseLocalDDL(ddl);
  if (!parsed) return null;
  return format(parsed, "M月d日 HH:mm");
}

const timeRange = (start?: string, end?: string): string =>
  [start, end].filter(Boolean).join("–");

function courseName(state: AppState, courseId?: string): string {
  if (!courseId) return "课程";
  return state.courses.find((c) => c.id === courseId)?.name ?? "课程";
}

function scheduleOf(state: AppState, scheduleId?: string): AppState["schedules"][number] | undefined {
  if (!scheduleId) return undefined;
  return state.schedules.find((s) => s.id === scheduleId);
}

interface VisualPreparedDisplay {
  kind: VisualActionKind;
  title: string;
  subtitle?: string;
}

/** PreparedActionView（来自 Change Set Preflight）→ 用户可读的确定性展示 */
export function formatVisualPreparedAction(
  prepared: PreparedActionView,
  state: AppState
): VisualPreparedDisplay {
  const kind = VISUAL_KIND_OF_TOOL[prepared.tool] ?? "assignment-update";
  const after = (prepared.after ?? {}) as Record<string, unknown>;
  const before = (prepared.before ?? {}) as Record<string, unknown>;

  switch (prepared.tool) {
    case "create_assignment": {
      const course = courseName(state, after.courseId as string | undefined);
      const ddl = formatDDL(after.ddl as string | undefined);
      return {
        kind,
        title: (after.title as string) || prepared.title,
        subtitle: ddl ? `${course} · ${ddl}` : course,
      };
    }
    case "set_assignment_ddl": {
      const from = formatDDL(before.ddl as string | undefined);
      const to = formatDDL(after.ddl as string | undefined);
      return {
        kind,
        title: prepared.title,
        subtitle: `${from ?? "未设置"} → ${to ?? "未设置"}`,
      };
    }
    case "update_assignment": {
      const course = courseName(
        state,
        state.assignments.find((a) => a.id === prepared.entityId)?.courseId
      );
      const titleChanged =
        typeof before.title === "string" && typeof after.title === "string" && before.title !== after.title;
      return {
        kind,
        title: (after.title as string) || prepared.title,
        subtitle: titleChanged ? `${course} · 原名「${before.title}」` : course,
      };
    }
    case "set_assignment_priority": {
      return {
        kind,
        title: prepared.title,
        subtitle: `优先级 ${(before.priority as string) ?? "默认"} → ${(after.priority as string) ?? "默认"}`,
      };
    }
    case "cancel_schedule_occurrence": {
      const base = scheduleOf(state, after.scheduleId as string | undefined);
      const time = timeRange(base?.startTime, base?.endTime);
      return {
        kind,
        title: courseName(state, (after.courseId as string | undefined) ?? base?.courseId),
        subtitle: `第 ${after.week} 周 · ${weekday(base?.dayOfWeek)} ${time} · 停课`.trim(),
      };
    }
    case "move_schedule_occurrence": {
      const base = scheduleOf(state, after.scheduleId as string | undefined);
      const from = `${weekday(base?.dayOfWeek)} ${base?.startTime ?? ""}`.trim();
      const to = `${weekday(after.dayOfWeek as number | undefined)} ${(after.startTime as string) ?? ""}`.trim();
      return {
        kind,
        title: courseName(state, (after.courseId as string | undefined) ?? base?.courseId),
        subtitle: `第 ${after.week} 周 · ${from} → ${to}`,
      };
    }
    case "create_extra_schedule_occurrence": {
      return {
        kind,
        title: courseName(state, after.courseId as string | undefined),
        subtitle: `第 ${after.week} 周 · ${weekday(after.dayOfWeek as number | undefined)} ${timeRange(
          after.startTime as string | undefined,
          after.endTime as string | undefined
        )} · 临时补课`.trim(),
      };
    }
    case "move_schedule":
    case "update_schedule": {
      const course = courseName(state, state.schedules.find((s) => s.id === prepared.entityId)?.courseId);
      const from = `${weekday(before.dayOfWeek as number | undefined)} ${(before.startTime as string) ?? ""}`.trim();
      const to = `${weekday(after.dayOfWeek as number | undefined)} ${(after.startTime as string) ?? ""}`.trim();
      return {
        kind,
        title: course,
        // 必须明确「永久」，不能看起来像临时调课
        subtitle: `永久调整排课 · ${from} → ${to}`,
      };
    }
    default:
      return { kind, title: prepared.title };
  }
}
