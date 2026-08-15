"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { StudyOutlook, StudyOutlookHorizon } from "@/lib/outlook/types";
import { buildStudyOutlook } from "@/lib/outlook/studyOutlook";
import { loadEstimateCalibration } from "@/lib/analytics/estimateCalibration";
import { flushLearningHistoryQueue, subscribeLearningHistoryChanges } from "@/lib/history/recorder";

export interface UseStudyOutlookResult {
  data: StudyOutlook | null;
  loading: boolean;
  error: boolean;
  refresh: () => void;
}

/**
 * 未来 7 / 14 天学习前瞻 hook：
 * - 只订阅 Outlook 需要的字段（assignments/studyBlocks/schedules/calendarMarks/courses/semester/week）
 * - History 变更（calibration 依赖）→ 重建；generation token 防 stale
 * - 单次构建（calibration 一次加载 + buildStudyOutlook 一次调用），不逐 task 查 IndexedDB
 */
export function useStudyOutlook(horizonDays: StudyOutlookHorizon): UseStudyOutlookResult {
  const assignments = useAppStore((s) => s.assignments);
  const studyBlocks = useAppStore((s) => s.studyBlocks);
  const schedules = useAppStore((s) => s.schedules);
  const calendarMarks = useAppStore((s) => s.calendarMarks);
  const courses = useAppStore((s) => s.courses);
  const semester = useAppStore((s) => s.semester);
  const currentSemesterWeek = useAppStore((s) => s.currentSemesterWeek);

  const [data, setData] = useState<StudyOutlook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const generationRef = useRef(0);
  const [tick, setTick] = useState(0);

  const calculate = useCallback(async () => {
    const generation = ++generationRef.current;
    setLoading(true);
    try {
      await flushLearningHistoryQueue();
      const calibration = await loadEstimateCalibration();
      const outlook = buildStudyOutlook({
        assignments,
        studyBlocks,
        schedules,
        calendarMarks,
        courses,
        semester,
        currentSemesterWeek,
        horizonDays,
        now: new Date(),
        calibration,
      });
      if (generationRef.current !== generation) return;
      setData(outlook);
      setError(false);
    } catch {
      if (generationRef.current !== generation) return;
      setError(true);
    } finally {
      if (generationRef.current === generation) setLoading(false);
    }
  }, [assignments, studyBlocks, schedules, calendarMarks, courses, semester, currentSemesterWeek, horizonDays]);

  useEffect(() => {
    void calculate();
  }, [calculate]);

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
