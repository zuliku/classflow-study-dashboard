/**
 * Timetable Import Proposal Runtime：
 * apply 生命周期（applied / stale）+ 结果计数。刷新即消失（不持久化）。
 */

export interface TimetableImportRuntimeEntry {
  proposalId: string;
  status: "applied" | "stale";
  appliedCount: { courses: number; slots: number };
}

export interface TimetableImportRuntime {
  getState: () => Record<string, TimetableImportRuntimeEntry>;
  recordApplied: (entry: Omit<TimetableImportRuntimeEntry, "status">) => void;
  markStale: (proposalId: string) => void;
  clear: () => void;
}

export function createTimetableImportRuntime(): TimetableImportRuntime {
  let entries: Record<string, TimetableImportRuntimeEntry> = {};
  return {
    getState: () => entries,
    recordApplied: (entry) => {
      entries = { ...entries, [entry.proposalId]: { ...entry, status: "applied" } };
    },
    markStale: (proposalId) => {
      entries = { ...entries, [proposalId]: { ...entries[proposalId], status: "stale" } };
    },
    clear: () => {
      entries = {};
    },
  };
}
