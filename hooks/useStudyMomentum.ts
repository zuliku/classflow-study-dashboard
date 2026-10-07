"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  flushLearningHistoryQueue,
  subscribeLearningHistoryChanges,
} from "@/lib/history/recorder";
import { collectLearningHistoryEvents, resolveLearningHistoryQuery } from "@/lib/history/query";
import { getLearningHistoryCoverage } from "@/lib/history/store";
import {
  buildStudyMomentum,
  toLocalDateStr,
  type StudyMomentum,
} from "@/lib/analytics/momentum";

export interface UseStudyMomentumResult {
  data: StudyMomentum | null;
  loading: boolean;
  error: boolean;
  refresh: () => void;
}

/**
 * 学习动量数据 hook（12 周热力 + 连续天数，与 useLearningAnalytics 同生命周期语义）：
 * - mount → flush history → 查最近 84 天 focus.completed / assignment.completed → 聚日
 * - history changed → recalculate（订阅 recorder，不 polling）
 * - request generation token 防 stale 覆盖
 */
export function useStudyMomentum(): UseStudyMomentumResult {
  const [data, setData] = useState<StudyMomentum | null>(null);
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
      const now = new Date();
      const todayStr = toLocalDateStr(now);
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      from.setDate(from.getDate() - 83);
      const [events, coverage] = await Promise.all([
        collectLearningHistoryEvents(
          resolveLearningHistoryQuery({
            from: from.getTime(),
            eventTypes: ["focus.completed", "assignment.completed"],
            limit: 5000,
            order: "asc",
          })
        ),
        getLearningHistoryCoverage().catch(() => null),
      ]);
      if (generationRef.current !== generation) return; // stale：新请求已接管
      setData(
        buildStudyMomentum({
          events,
          todayStr,
          historyStartedAt: coverage?.historyStartedAt ?? null,
        })
      );
      setError(false);
    } catch {
      if (generationRef.current !== generation) return;
      setError(true);
    } finally {
      if (generationRef.current === generation) setLoading(false);
    }
  }, []);

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
