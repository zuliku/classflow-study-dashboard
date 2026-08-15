/**
 * Learning History Migration（Part 1）：
 * - 只回填旧 completed FocusSession（幂等；id = lh_backfill_focus_completed_${session.id}）
 * - 不回填 started/paused/resumed；不回填 Assignment/Course/Schedule 旧数据
 */

import { FocusSession, Semester } from "@/types";
import {
  LearningHistoryCoverage,
  LearningHistoryEvent,
} from "@/lib/history/types";
import { buildFocusCompletedEvent } from "@/lib/history/focusEvents";
import {
  LearningEventEnvironment,
  resolveLearningMutationContext,
} from "@/lib/history/recorder";
import {
  getLearningHistoryCoverage,
  setLearningHistoryCoverage,
  getLearningHistoryEvent,
  appendLearningHistoryEvents,
} from "@/lib/history/store";

export function isBackfillableFocusSession(s: FocusSession): boolean {
  return (
    s.status === "completed" &&
    typeof s.endedAt === "number" &&
    typeof s.actualActiveMs === "number"
  );
}

/** 构造 Focus backfill 事件（source=system；sessionSource=original；backfilled=true；固定幂等 id） */
export function buildFocusBackfillEvent(input: {
  session: FocusSession;
  semester: Semester;
}): LearningHistoryEvent | null {
  const { session, semester } = input;
  if (!isBackfillableFocusSession(session)) return null;
  const environment: LearningEventEnvironment = { semester };
  const context = resolveLearningMutationContext({ source: "system" });
  const event = buildFocusCompletedEvent({
    session,
    endReason: "recovered",
    context,
    environment,
    backfilled: true,
  });
  if (!event) return null;
  return { ...event, id: `lh_backfill_focus_completed_${session.id}` };
}

/**
 * 幂等 Focus backfill：
 * - coverage.focusBackfillCompleted / focusBackfillDisabled → skip
 * - 逐 session 检查事件 id 是否存在（幂等）
 * - 完成后更新 coverage
 */
export async function runFocusBackfill(input: {
  sessions: FocusSession[];
  semester: Semester;
}): Promise<LearningHistoryCoverage | null> {
  const coverage = await getLearningHistoryCoverage();
  if (!coverage) return null;
  if (coverage.focusBackfillCompleted || coverage.focusBackfillDisabled === true) return coverage;

  const events: LearningHistoryEvent[] = [];
  let backfilled = 0;
  for (const session of input.sessions) {
    const id = `lh_backfill_focus_completed_${session.id}`;
    const exists = await getLearningHistoryEvent(id);
    if (exists) continue;
    const event = buildFocusBackfillEvent({ session, semester: input.semester });
    if (!event) continue;
    events.push(event);
    backfilled += 1;
  }
  if (events.length > 0) {
    await appendLearningHistoryEvents(events);
  }
  const next: LearningHistoryCoverage = {
    ...coverage,
    focusBackfillCompleted: true,
    backfilledFocusSessions: coverage.backfilledFocusSessions + backfilled,
  };
  await setLearningHistoryCoverage(next);
  return next;
}
