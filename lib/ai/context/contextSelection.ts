import { KiroContextRef } from "@/lib/ai/context/types";
import { useAppStore } from "@/store/useAppStore";

/**
 * Context Selection：自动 Context + 手动 @ Context + 被抑制的自动 Context。
 * 组件（Context Bar）与 Chat Body（contextRefs）共用同一来源。
 */

/** 自动 Context：从 Store 选中实体与当前教学周解析（进入 Kiro 时自动可见） */
export function buildAutoContextRefs(): KiroContextRef[] {
  const state = useAppStore.getState();
  const refs: KiroContextRef[] = [];

  if (state.selectedAssignmentId) {
    const task = state.assignments.find((a) => a.id === state.selectedAssignmentId);
    if (task) {
      refs.push({
        key: `auto-assignment-${task.id}`,
        kind: "assignment",
        entityId: task.id,
        label: `当前任务 · ${task.title}`,
        source: "auto",
      });
    }
  }
  if (state.selectedCourseId) {
    const course = state.courses.find((c) => c.id === state.selectedCourseId);
    if (course) {
      refs.push({
        key: `auto-course-${course.id}`,
        kind: "course",
        entityId: course.id,
        label: `当前课程 · ${course.name}`,
        source: "auto",
      });
    }
  }
  if (state.highlightedAssignmentId && state.highlightedAssignmentId !== state.selectedAssignmentId) {
    const task = state.assignments.find((a) => a.id === state.highlightedAssignmentId);
    if (task) {
      refs.push({
        key: `auto-highlight-${task.id}`,
        kind: "assignment",
        entityId: task.id,
        label: `当前任务 · ${task.title}`,
        source: "auto",
      });
    }
  }
  if (state.semester.totalWeeks > 0) {
    refs.push({
      key: "auto-week-current",
      kind: "week",
      entityId: "current",
      label: `时间范围 · 本周（第 ${state.currentSemesterWeek} 周）`,
      source: "auto",
    });
  }
  return refs;
}

/** 生效的 Context 引用：自动（减去被抑制的）+ 手动 */
export function resolveContextRefs(
  autoRefs: KiroContextRef[],
  manualRefs: KiroContextRef[],
  suppressedAutoKeys: string[]
): KiroContextRef[] {
  const suppressed = new Set(suppressedAutoKeys);
  return [...autoRefs.filter((r) => !suppressed.has(r.key)), ...manualRefs];
}

/** 传给模型的极简引用（只含 kind/id/label，不塞完整实体） */
export function refsForPrompt(refs: KiroContextRef[]): { kind: string; id?: string; label: string }[] {
  return refs.map((r) => ({
    kind: r.kind,
    id: r.entityId,
    label: r.label,
  }));
}
