"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityRow,
  EntityActivityLoadResult,
  loadEntityActivity,
} from "@/lib/history/activityView";
import { subscribeLearningHistoryChanges } from "@/lib/history/recorder";

export interface UseEntityLearningHistoryInput {
  /** 只允许一个 entity scope */
  assignmentId?: string;
  courseId?: string;
  /** 首次展开才置 true（lazy：collapsed 时不做 IndexedDB I/O） */
  enabled: boolean;
}

export interface UseEntityLearningHistoryResult {
  rows: ActivityRow[];
  hasMore: boolean;
  coverageStartedAt: number | null;
  loading: boolean;
  error: boolean;
  /** 手动重试（query error 后） */
  retry: () => void;
}

/**
 * Entity Activity Timeline hook：
 * - 与 useStudyOutlook 同族 pattern：flush queue → query → generation token 防 stale async
 * - History 变更（append / clear）→ 自动刷新（collapsed 时更新内部 data，不自动展开）
 * - enabled=false 不 query；entityId 变化 → 新 generation，旧结果不覆盖新实体
 */
export function useEntityLearningHistory({
  assignmentId,
  courseId,
  enabled,
}: UseEntityLearningHistoryInput): UseEntityLearningHistoryResult {
  const [state, setState] = useState<EntityActivityLoadResult>({
    rows: [],
    hasMore: false,
    coverageStartedAt: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const generationRef = useRef(0);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    if (!enabled) return;
    if (assignmentId === undefined && courseId === undefined) return;
    const generation = ++generationRef.current;
    setLoading(true);
    try {
      const result = await loadEntityActivity({
        assignmentId,
        courseId,
      });
      if (generationRef.current !== generation) return;
      setState(result);
      setError(false);
    } catch (err) {
      if (generationRef.current !== generation) return;
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn("[entity-activity] load failed", err);
      }
      setError(true);
    } finally {
      if (generationRef.current === generation) setLoading(false);
    }
  }, [assignmentId, courseId, enabled]);

  // entity / enabled 变化 → 加载
  useEffect(() => {
    void load();
  }, [load]);

  // History 变更（append / clear / reset）→ 刷新
  useEffect(() => {
    return subscribeLearningHistoryChanges(() => setTick((t) => t + 1));
  }, []);
  useEffect(() => {
    if (tick === 0 || !enabled) return;
    void load();
  }, [tick, enabled, load]);

  const retry = useCallback(() => {
    void load();
  }, [load]);

  return { ...state, loading, error, retry };
}
