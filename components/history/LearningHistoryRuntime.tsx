"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";
import { ensureLearningHistoryCoverage } from "@/lib/history/store";
import { runFocusBackfill } from "@/lib/history/migration";
import { flushLearningHistoryQueue } from "@/lib/history/recorder";

/**
 * Learning History Runtime（Part 1）：
 * - 只负责 ensure DB initialized + 幂等 Focus backfill
 * - 不显示 UI
 * - SSR 安全：IndexedDB 只在浏览器 effect 内触发
 *
 * BUG-049：pagehide/beforeunload 时 flush 记录队列 —— 队列是内存 promise 链，
 * 不 flush 则「完成专注 → 立即关窗」会永久丢失尾部事件。
 */
export function LearningHistoryRuntime() {
  useEffect(() => {
    let cancelled = false;
    const flush = () => {
      void flushLearningHistoryQueue().catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
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
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
    };
  }, []);
  return null;
}
