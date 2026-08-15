/**
 * Kiro Canonical Outlook Tool（Analytics V2 · Part 3，Browser async executor）。
 * get_learning_outlook：未来 7 / 14 天确定性学习前瞻（与「学习洞察」页面同源）。
 * 不复制算法：直接 buildStudyOutlook（内部复用 deriveAssignmentHealth / findFreeTime）；
 * 不暴露原始 StudyBlocks / FreeTime slots / History events。
 */

import { getLearningOutlookSchema } from "@/lib/ai/tools/read/schemas";
import { ReadToolResult } from "@/lib/ai/tools/read/executor";
import { buildStudyOutlook } from "@/lib/outlook/studyOutlook";
import { StudyOutlookHorizon } from "@/lib/outlook/types";
import { loadEstimateCalibration } from "@/lib/analytics/estimateCalibration";
import { flushLearningHistoryQueue } from "@/lib/history/recorder";
import { useAppStore } from "@/store/useAppStore";

export type OutlookToolErrorCode = "INVALID_INPUT" | "READ_FAILED";

function fail(code: OutlookToolErrorCode, message: string): ReadToolResult<unknown> {
  return { ok: false, code, message };
}

/** 输出裁剪：只保留 model-friendly 的 summary / tasks / bottleneckDays / calibration */
function toModelFriendlyOutput(outlook: ReturnType<typeof buildStudyOutlook>) {
  return {
    horizonDays: outlook.horizonDays,
    summary: outlook.summary,
    tasks: outlook.tasks.map((t) => ({
      assignmentId: t.assignmentId,
      title: t.title,
      courseId: t.courseId,
      courseName: t.courseName,
      deadline: t.deadline,
      estimatedMinutes: t.estimatedMinutes,
      scheduledMinutesBeforeDeadline: t.scheduledMinutesBeforeDeadline,
      unscheduledMinutes: t.unscheduledMinutes,
      availableMinutesBeforeDeadline: t.availableMinutesBeforeDeadline,
      health: t.health,
      reasons: t.reasons,
      estimateCalibration: t.estimateCalibration,
    })),
    bottleneckDays: outlook.bottleneckDays,
    estimateCalibration: {
      status: outlook.estimateCalibration.status,
      sampleCount: outlook.estimateCalibration.sampleCount,
      excludedOutliers: outlook.estimateCalibration.excludedOutliers,
      medianRatio: outlook.estimateCalibration.medianRatio,
      interpretation: outlook.estimateCalibration.interpretation,
      byCourse: outlook.estimateCalibration.byCourse,
    },
  };
}

/**
 * 执行 get_learning_outlook（Browser 侧）。
 * - flush History queue → 当前 Zustand state → calibration（一次）→ buildStudyOutlook
 * - calibration 只是 task 的只读参考 metadata；不改变 health / 不自动写任何数据
 */
export async function executeGetLearningOutlook(input: unknown): Promise<ReadToolResult<unknown>> {
  const parsed = getLearningOutlookSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail(
      "INVALID_INPUT",
      first ? `${first.path.join(".") || "输入"}: ${first.message}` : "输入不合法。"
    );
  }
  const horizonDays = parsed.data.horizonDays as StudyOutlookHorizon;
  try {
    await flushLearningHistoryQueue();
    const state = useAppStore.getState();
    const calibration = await loadEstimateCalibration();
    const outlook = buildStudyOutlook({
      assignments: state.assignments,
      studyBlocks: state.studyBlocks,
      schedules: state.schedules,
      calendarMarks: state.calendarMarks,
      courses: state.courses,
      semester: state.semester,
      currentSemesterWeek: state.currentSemesterWeek,
      horizonDays,
      now: new Date(),
      calibration,
    });
    return { ok: true, data: toModelFriendlyOutput(outlook) };
  } catch (err) {
    return fail("READ_FAILED", "暂时无法读取学习前瞻，请稍后重试。");
  }
}
