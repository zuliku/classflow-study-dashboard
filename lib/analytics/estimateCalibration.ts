/**
 * Estimate Calibration（Analytics V2 · Part 3）。
 * 术语纪律：History 只知道「已记录专注」（focus.completed actualActiveMs，可能不完整）；
 * 绝不称"任务实际耗时"。Calibration 只做观察/参考，绝不自动修改 estimatedMinutes，
 * TaskHealth / StudyPlanner 也不静默使用校准值。
 *
 * Episode 语义：
 * - 起点 = assignment.created 或 assignment.reopened
 * - episode 内累积 assignmentId 相同的 focus.completed.actualActiveMs
 * - assignment.completed 关闭当前 episode，并重建「完成时生效的 estimatedMinutes」
 *   （created.data.estimatedMinutes → estimate_changed.data.after 依次覆盖）
 * - 缺少可靠 estimate 历史（无 created 事件 / 估时从未可知）→ 排除，不猜
 */

import { AnalyticsProjectionEvent } from "@/lib/analytics/types";
import { collectLearningHistoryEvents, resolveLearningHistoryQuery, sortLearningHistoryEvents } from "@/lib/history/query";
import { getLearningHistoryCoverage } from "@/lib/history/store";

export interface CalibrationSample {
  assignmentId: string;
  /** episode 起点（created/reopened 的 occurredAt） */
  episodeStartedAt: number;
  completedAt: number;
  courseId: string | null;
  courseName: string | null;
  /** 完成时生效的 estimatedMinutes */
  estimatedMinutesAtCompletion: number;
  /** 该 episode 内已记录专注分钟（actualActiveMs / 60000） */
  trackedFocusMinutes: number;
  /** trackedFocusMinutes / estimatedMinutesAtCompletion */
  ratio: number;
}

export type CalibrationInterpretation =
  | "tracked-below-estimate"
  | "roughly-aligned"
  | "tracked-above-estimate";

export interface CourseEstimateCalibration {
  courseId: string | null;
  courseName: string;
  sampleCount: number;
  medianRatio: number | null;
  status: "ready" | "insufficient-data";
}

export interface EstimateCalibration {
  status: "ready" | "insufficient-data";
  sampleCount: number;
  /** 0.25–4 之外的 ratio 样本数（不参与校准；原始 History 事件不动） */
  excludedOutliers: number;
  medianRatio: number | null;
  interpretation: CalibrationInterpretation | null;
  byCourse: CourseEstimateCalibration[];
  /** 内部样本（测试 / Kiro 参考可用；不直接进 UI 文案） */
  samples: CalibrationSample[];
}

export const CALIBRATION_SAMPLE_MIN_GLOBAL = 5;
export const CALIBRATION_SAMPLE_MIN_COURSE = 3;
export const CALIBRATION_FOCUS_MIN_MINUTES = 15;
export const CALIBRATION_RATIO_LOWER = 0.25;
export const CALIBRATION_RATIO_UPPER = 4;

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function interpretRatio(ratio: number): CalibrationInterpretation {
  if (ratio < 0.8) return "tracked-below-estimate";
  if (ratio > 1.2) return "tracked-above-estimate";
  return "roughly-aligned";
}

export interface EstimateCalibrationBuildInput {
  /** 按 (occurredAt, sequence) 升序的 History 事件（从 coverage 起点查询，不含 coverage 之前） */
  events: AnalyticsProjectionEvent[];
}

/** 纯函数：从 History 事件重建校准样本 */
export function buildEstimateCalibration(input: EstimateCalibrationBuildInput): EstimateCalibration {
  const samples: CalibrationSample[] = [];
  let excludedOutliers = 0;

  // 按 assignmentId 分组重放（created/estimate_changed/completed/reopened/focus.completed）
  const byAssignment = new Map<string, AnalyticsProjectionEvent[]>();
  for (const e of input.events) {
    if (!isCalibrationEvent(e)) continue;
    // focus 事件挂在 assignmentId 上（entityId 是 session id）；assignment 事件用 entityId
    const key = e.type === "focus.completed" ? e.assignmentId : e.entityId;
    if (!key) continue;
    const list = byAssignment.get(key) ?? [];
    list.push(e);
    byAssignment.set(key, list);
  }

  for (const [assignmentId, events] of Array.from(byAssignment.entries())) {
    const sorted = events
      .filter((e) =>
        e.type === "assignment.created" ||
        e.type === "assignment.estimate_changed" ||
        e.type === "assignment.completed" ||
        e.type === "assignment.reopened" ||
        e.type === "focus.completed"
      )
      .sort((a, b) => a.occurredAt - b.occurredAt || a.sequence - b.sequence);

    let hadCreated = false;
    let courseId: string | null = null;
    let courseName: string | null = null;
    let currentEstimate: number | null = null;
    let episode: {
      startedAt: number;
      estimate: number | null;
      focusMs: number;
    } | null = null;

    for (const event of sorted) {
      if (event.type === "assignment.created") {
        hadCreated = true;
        courseId = event.courseId ?? null;
        courseName = event.courseNameSnapshot ?? null;
        currentEstimate = readEstimate(event.data);
        episode = { startedAt: event.occurredAt, estimate: currentEstimate, focusMs: 0 };
      } else if (event.type === "assignment.estimate_changed") {
        currentEstimate = readEstimateAfter(event.data);
        if (episode) episode.estimate = currentEstimate;
      } else if (event.type === "focus.completed") {
        if (!episode) continue; // 不在任何 episode 内的专注不计
        if (event.assignmentId !== assignmentId) continue;
        const ms = readFocusMs(event.data);
        if (ms !== null) episode.focusMs += ms;
      } else if (event.type === "assignment.completed") {
        if (!episode || !hadCreated) {
          episode = null;
          continue;
        }
        const estimate = episode.estimate;
        const focusMinutes = Math.round(episode.focusMs / 60000);
        if (estimate !== null && estimate > 0 && focusMinutes >= CALIBRATION_FOCUS_MIN_MINUTES) {
          const ratio = focusMinutes / estimate;
          if (ratio >= CALIBRATION_RATIO_LOWER && ratio <= CALIBRATION_RATIO_UPPER) {
            samples.push({
              assignmentId,
              episodeStartedAt: episode.startedAt,
              completedAt: event.occurredAt,
              courseId,
              courseName,
              estimatedMinutesAtCompletion: estimate,
              trackedFocusMinutes: focusMinutes,
              ratio,
            });
          } else {
            excludedOutliers += 1;
          }
        }
        episode = null;
      } else if (event.type === "assignment.reopened") {
        // 重新开启：不关闭样本（只有 completed 才产出样本）；开启新 episode
        episode = { startedAt: event.occurredAt, estimate: currentEstimate, focusMs: 0 };
      }
    }
  }

  const ratios = samples.map((s) => s.ratio);
  const medianRatio = medianOf(ratios);
  const status: EstimateCalibration["status"] =
    samples.length >= CALIBRATION_SAMPLE_MIN_GLOBAL ? "ready" : "insufficient-data";
  const interpretation =
    medianRatio !== null && status === "ready" ? interpretRatio(medianRatio) : null;

  // course-level：同一 course >= 3 样本才展示
  const byCourseMap = new Map<string, CalibrationSample[]>();
  for (const s of samples) {
    const key = s.courseId ?? "__unlinked__";
    const list = byCourseMap.get(key) ?? [];
    list.push(s);
    byCourseMap.set(key, list);
  }
  const byCourse: CourseEstimateCalibration[] = Array.from(byCourseMap.entries())
    .map(([key, list]) => {
      const courseMedian = medianOf(list.map((s) => s.ratio));
      const ready: CourseEstimateCalibration["status"] =
        list.length >= CALIBRATION_SAMPLE_MIN_COURSE ? "ready" : "insufficient-data";
      return {
        courseId: key === "__unlinked__" ? null : key,
        courseName: list[0].courseName ?? "未关联课程",
        sampleCount: list.length,
        medianRatio: courseMedian,
        status: ready,
      };
    })
    .sort((a, b) => b.sampleCount - a.sampleCount);

  return {
    status,
    sampleCount: samples.length,
    excludedOutliers,
    medianRatio,
    interpretation,
    byCourse,
    samples,
  };
}

function isCalibrationEvent(e: AnalyticsProjectionEvent): boolean {
  return (
    e.type === "assignment.created" ||
    e.type === "assignment.estimate_changed" ||
    e.type === "assignment.completed" ||
    e.type === "assignment.reopened" ||
    e.type === "focus.completed"
  );
}

function readEstimate(data: unknown): number | null {
  const d = data as { estimatedMinutes?: number | null };
  return typeof d.estimatedMinutes === "number" && d.estimatedMinutes > 0 ? d.estimatedMinutes : null;
}

function readEstimateAfter(data: unknown): number | null {
  const d = data as { after?: number | null };
  return typeof d.after === "number" && d.after > 0 ? d.after : null;
}

function readFocusMs(data: unknown): number | null {
  const d = data as { actualActiveMs?: number };
  return typeof d.actualActiveMs === "number" && d.actualActiveMs > 0 ? d.actualActiveMs : null;
}

function toProjectionEvent(e: {
  type: string;
  entityId: string;
  occurredAt: number;
  sequence: number;
  courseId?: string;
  courseNameSnapshot?: string;
  assignmentId?: string;
  data: unknown;
}): AnalyticsProjectionEvent {
  return {
    type: e.type,
    entityId: e.entityId,
    occurredAt: e.occurredAt,
    sequence: e.sequence,
    courseId: e.courseId,
    courseNameSnapshot: e.courseNameSnapshot,
    assignmentId: e.assignmentId,
    data: e.data,
  };
}

/**
 * 从 History IndexedDB 加载校准（Browser 侧；查询起点 = coverage 起点 → 现在）。
 * 单次查询构建全部样本；调用方（hook / Kiro tool）先 flush 队列。
 */
export async function loadEstimateCalibration(): Promise<EstimateCalibration> {
  const coverage = await getLearningHistoryCoverage();
  const historyStartedAt = coverage?.historyStartedAt ?? Date.now();
  const events = sortLearningHistoryEvents(
    await collectLearningHistoryEvents(
      resolveLearningHistoryQuery({
        from: historyStartedAt,
        to: Date.now(),
        eventTypes: [
          "assignment.created",
          "assignment.estimate_changed",
          "assignment.completed",
          "assignment.reopened",
          "focus.completed",
        ],
      })
    ),
    "asc"
  ).map(toProjectionEvent);
  return buildEstimateCalibration({ events });
}
