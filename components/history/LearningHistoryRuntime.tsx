"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";
import { ensureLearningHistoryCoverage } from "@/lib/history/store";
import { runFocusBackfill } from "@/lib/history/migration";

/**
 * Learning History Runtime（Part 1）：
 * - 只负责 ensure DB initialized + 幂等 Focus backfill
 * - 不显示 UI
 * - SSR 安全：IndexedDB 只在浏览器 effect 内触发
 */
export function LearningHistoryRuntime() {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const coverage = await ensureLearningHistoryCoverage();
        if (cancelled) return;
        if (coverage.focusBackfillDisabled === true || coverage.focusBackfillCompleted) return;
        const state = useAppStore.getState();
        await runFocusBackfill({ sessions: state.focusSessions, semester: state.semester });
      } catch {
        // History best effort：失败不影响业务
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
