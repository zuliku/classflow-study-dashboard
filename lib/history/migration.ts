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
  // BUG-058：先取全部已存在的 focus.completed 事件，构建 sessionId 集合 ——
  // 回填只应补「从未被 live recorder 记录」的会话；否则首次回填中断后，
  // 已 live 记录的 session 会被再补一条，专注分钟/校准样本最高 2× 通胀。
  const { collectLearningHistoryEvents, resolveLearningHistoryQuery } = await import("@/lib/history/query");
  const existingFocusEvents = await collectLearningHistoryEvents(
    resolveLearningHistoryQuery({ eventTypes: ["focus.completed"], limit: 100000 })
  );
  const liveSessionIds = new Set<string>();
  for (const ev of existingFocusEvents) {
    // focus.completed 的 entityId = session.id（live 与 backfill 同一构建器）
    if (ev.entityId) liveSessionIds.add(ev.entityId);
  }
  for (const session of input.sessions) {
    if (liveSessionIds.has(session.id)) continue; // 已有 live 记录 → 不回填
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
