import { KiroContextRef } from "@/lib/ai/context/types";
import type { AppState } from "@/store/useAppStore";

/** Context Selection：自动 Context（reactive）+ 手动 @ + 入口 Entry。 */

/** 自动 Context：纯函数（Provider 通过 Zustand subscription + useMemo 调用，不依赖偶然 rerender） */
export function buildAutoContextRefs(state: Pick<AppState, "selectedAssignmentId" | "selectedCourseId" | "highlightedAssignmentId" | "assignments" | "courses" | "semester" | "currentSemesterWeek">): KiroContextRef[] {
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

/** 生效的 Context 引用：自动（减去被抑制的）+ 入口 + 手动 */
export function resolveContextRefs(
  autoRefs: KiroContextRef[],
  manualRefs: KiroContextRef[],
  entryRefs: KiroContextRef[],
  suppressedAutoKeys: string[]
): KiroContextRef[] {
  const suppressed = new Set(suppressedAutoKeys);
  return [
    ...autoRefs.filter((r) => !suppressed.has(r.key)),
    ...entryRefs.filter((r) => !suppressed.has(r.key)),
    ...manualRefs,
  ];
}

/**
 * Entry Context 替换：新的业务实体打开 Kiro 时替换上一组 entry refs（防止上下文污染）。
 * 手动 @ context 不受影响。
 */
export function replaceEntryRefs(_prev: KiroContextRef[], next: KiroContextRef[]): KiroContextRef[] {
  return next;
}

/**
 * Prompt Context 引用（strict whitelist；V2 Part 3 Artifact 显式构造，绝不 spread 原 ref）。
 * Artifact 只含 id/workspaceId/rootId/relativePath/type/revision——content/adapterRef/nativePath/bytes 永不进入。
 */
export type KiroPromptContextRef =
  | {
      kind: "course" | "assignment" | "group-project" | "material" | "week";
      id?: string;
      label: string;
    }
  | {
      kind: "artifact";
      id: string;
      label: string;
      workspaceId: string;
      rootId: string;
      relativePath: string;
      type: "text" | "markdown" | "docx";
      revision: number;
    };

/** 传给模型的极简引用（Artifact 走逻辑 whitelist；显式构造；无 meta 的 artifact ref 不输出） */
export function refsForPrompt(refs: KiroContextRef[]): KiroPromptContextRef[] {
  const out: KiroPromptContextRef[] = [];
  for (const r of refs) {
    if (r.kind === "artifact") {
      if (!r.artifact) continue;
      out.push({
        kind: "artifact",
        id: r.artifact.artifactId,
        label: r.label,
        workspaceId: r.artifact.workspaceId,
        rootId: r.artifact.rootId,
        relativePath: r.artifact.relativePath,
        type: r.artifact.type,
        revision: r.artifact.revision,
      });
      continue;
    }
    out.push({
      kind: r.kind,
      id: r.entityId,
      label: r.label,
    });
  }
  return out;
}

const PROMPT_CONTEXT_KINDS = new Set(["course", "assignment", "group-project", "material", "week", "artifact"]);
const ARTIFACT_TYPES = new Set(["text", "markdown", "docx"]);

/**
 * Server 端再次归一化（不可信输入）：只保留白名单字段。
 * 恶意请求的 adapterRef/nativePath/content 等额外字段全部丢弃。
 */
export function normalizePromptContextRefs(input: unknown): KiroPromptContextRef[] {
  if (!Array.isArray(input)) return [];
  const out: KiroPromptContextRef[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) continue;
    const record = raw as Record<string, unknown>;
    const kind = typeof record.kind === "string" ? record.kind : "";
    if (!PROMPT_CONTEXT_KINDS.has(kind)) continue;
    const label = typeof record.label === "string" ? record.label : "";
    if (kind === "artifact") {
      const id = typeof record.id === "string" ? record.id : "";
      const workspaceId = typeof record.workspaceId === "string" ? record.workspaceId : "";
      const rootId = typeof record.rootId === "string" ? record.rootId : "";
      const relativePath = typeof record.relativePath === "string" ? record.relativePath : "";
      const type = typeof record.type === "string" ? record.type : "";
      const revision = typeof record.revision === "number" ? record.revision : NaN;
      if (!id || !workspaceId || !rootId || !relativePath || !ARTIFACT_TYPES.has(type) || !Number.isInteger(revision) || revision < 1) {
        continue;
      }
      out.push({
        kind: "artifact",
        id,
        label,
        workspaceId,
        rootId,
        relativePath,
        type: type as "text" | "markdown" | "docx",
        revision,
      });
      continue;
    }
    out.push({
      kind: kind as "course" | "assignment" | "group-project" | "material" | "week",
      id: typeof record.id === "string" ? record.id : undefined,
      label,
    });
  }
  return out;
}

/**
 * 语义去重（UI 显示层）：同一实体（course/assignment/group-project/week/material）即使来源不同
 * （auto / entry / manual），也只保留一个引用。week 特别处理：entry 的周次与 currentWeek 相同
 * 时与 auto「本周」视为同一实体。
 * 优先级：manual > entry > auto（保留高优先级引用，输出顺序不变）。
 */
export function dedupeContextRefs(refs: KiroContextRef[], currentWeek?: number): KiroContextRef[] {
  const sourcePriority = { auto: 0, entry: 1, manual: 2 } as const;
  const canonicalKey = (r: KiroContextRef): string => {
    if (r.kind === "week") {
      const week = r.entityId === "current" ? "current" : r.entityId;
      const resolved = week !== "current" && currentWeek != null && String(week) === String(currentWeek) ? "current" : week;
      return `week:${resolved}`;
    }
    return `${r.kind}:${r.entityId ?? ""}`;
  };
  const best = new Map<string, KiroContextRef>();
  for (const r of refs) {
    const key = canonicalKey(r);
    const cur = best.get(key);
    if (!cur || sourcePriority[r.source] >= sourcePriority[cur.source]) best.set(key, r);
  }
  const seen = new Set<string>();
  return refs.filter((r) => {
    const key = canonicalKey(r);
    if (best.get(key) !== r) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
