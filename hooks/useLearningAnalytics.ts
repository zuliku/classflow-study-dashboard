"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import {
  AnalyticsRangePreset,
  LearningAnalyticsSnapshot,
} from "@/lib/analytics/types";
import { buildLearningAnalyticsSnapshot } from "@/lib/analytics/learningAnalytics";
import {
  flushLearningHistoryQueue,
  subscribeLearningHistoryChanges,
} from "@/lib/history/recorder";

export interface UseLearningAnalyticsResult {
  data: LearningAnalyticsSnapshot | null;
  loading: boolean;
  error: boolean;
  refresh: () => void;
}

/**
 * 学习洞察数据 hook：
 * - mount → flush history → calculate
 * - history changed → recalculate（订阅 recorder，不 polling）
 * - preset changed / semester changed → recalculate
 * - request generation token 防 stale 覆盖
 */
export function useLearningAnalytics(preset: AnalyticsRangePreset): UseLearningAnalyticsResult {
  const semester = useAppStore((s) => s.semester);
  const [data, setData] = useState<LearningAnalyticsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const generationRef = useRef(0);
  const [tick, setTick] = useState(0);

  const calculate = useCallback(async () => {
    const generation = ++generationRef.current;
    setLoading(true);
    try {
      // 保证刚发生的 mutation 事件已写入 History
      await flushLearningHistoryQueue();
      const snapshot = await buildLearningAnalyticsSnapshot({
        preset,
        semester: {
          id: semester.id,
          name: semester.name,
          startDate: semester.startDate,
          totalWeeks: semester.totalWeeks,
        },
      });
      if (generationRef.current !== generation) return; // stale：新 preset/请求已接管
      setData(snapshot);
      setError(false);
    } catch {
      if (generationRef.current !== generation) return;
      setError(true);
    } finally {
      if (generationRef.current === generation) setLoading(false);
    }
  }, [preset, semester]);

  // mount / preset / semester 变化
  useEffect(() => {
    void calculate();
  }, [calculate]);

  // History 变更通知 → 重新计算
  useEffect(() => {
    return subscribeLearningHistoryChanges(() => setTick((t) => t + 1));
  }, []);
  useEffect(() => {
    if (tick === 0) return;
    void calculate();
  }, [tick, calculate]);

  const refresh = useCallback(() => {
    void calculate();
  }, [calculate]);

  return { data, loading, error, refresh };
}
