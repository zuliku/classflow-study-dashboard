import { KiroContextRef } from "@/lib/ai/context/types";
import type { AppState } from "@/store/useAppStore";

/**
 * Kiro Entry Context 构造（唯一来源）：业务 UI 不手写 kind/label/source。
 * 实体不存在返回 null（不猜、不制造假引用）。
 */
export type KiroEntryKind = "assignment" | "course" | "group-project" | "week";

export function makeEntryRef(kind: KiroEntryKind, entityId: string, label: string): KiroContextRef {
  return { key: `entry-${kind}-${entityId}`, kind, entityId, label, source: "entry" };
}

export function assignmentEntryRef(state: Pick<AppState, "assignments">, assignmentId: string): KiroContextRef | null {
  const a = state.assignments.find((x) => x.id === assignmentId);
  if (!a) return null;
  return makeEntryRef("assignment", a.id, `任务 · ${a.title}`);
}

export function courseEntryRef(state: Pick<AppState, "courses">, courseId: string): KiroContextRef | null {
  const c = state.courses.find((x) => x.id === courseId);
  if (!c) return null;
  return makeEntryRef("course", c.id, `课程 · ${c.name}`);
}

export function groupProjectEntryRef(state: Pick<AppState, "groupProjects">, projectId: string): KiroContextRef | null {
  const p = state.groupProjects.find((x) => x.id === projectId);
  if (!p) return null;
  return makeEntryRef("group-project", p.id, `小组项目 · ${p.title}`);
}

export function weekEntryRef(week: number): KiroContextRef {
  return makeEntryRef("week", String(week), `时间范围 · 第 ${week} 周`);
}

/** Entry kind → Sidecar 建议类型（material 等未知 kind 一律回退 generic） */
export function suggestionsTypeOf(ref: KiroContextRef): "assignment" | "course" | "group-project" | "week" | "generic" {
  switch (ref.kind) {
    case "assignment":
    case "course":
    case "group-project":
    case "week":
      return ref.kind;
    default:
      return "generic";
  }
}
