/**
 * Workflow UX V10：Focus → StudyBlock Execution Anchor（纯函数，不写 Store / 不读 Date.now）。
 *
 * 唯一可信规则：以 FocusSession.startedAt（会话创建、进入 running 的时刻）为 execution origin：
 * - block.assignmentId === session.assignmentId（Domain 只有任务级关联，无 studyBlockId）
 * - block.date === startedAt 的本地日期（yyyy-MM-dd）
 * - block.startTime <= startedAt 本地时间 < block.endTime（[start, end) 与 Timeline 时间语义一致）
 *
 * 为什么不用 activeStartedAt / now：resume 会改写 activeStartedAt——19:10 开始、21:00 继续
 * 若按 activeStartedAt 重锚，会错误绑定到 21:00 附近的计划；本 Session 的 origin 保持不变。
 *
 * 同一 Assignment 可有多个 StudyBlock：只有「时间上包含 startedAt」的那个才是本次专注的
 * temporal anchor；从 Assignment Workspace 在无计划时段手动开始的 Focus 不映射任何 block。
 */

import { format } from "date-fns";
import { FocusSession, StudyBlock } from "@/types";
import { timeToMinutes } from "@/lib/timeline/timelineGeometry";
import { isStudyBlockPlanningActive } from "@/lib/planning/studyBlockLifecycle";

export interface FocusStudyBlockAnchorInput {
  session: FocusSession | null | undefined;
  studyBlocks: StudyBlock[];
}

/** startedAt（epoch ms）→ { 本地日期 yyyy-MM-dd, 当天分钟数 } */
function localStartParts(startedAt: number): { date: string; minutesOfDay: number } | null {
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) return null;
  const d = new Date(startedAt);
  if (Number.isNaN(d.getTime())) return null;
  return {
    date: format(d, "yyyy-MM-dd"),
    minutesOfDay: d.getHours() * 60 + d.getMinutes(),
  };
}

/** 稳定排序：date → startTime → endTime → id（脏数据多候选时 deterministic，不 throw） */
function compareBlocks(a: StudyBlock, b: StudyBlock): number {
  return (
    a.date.localeCompare(b.date) ||
    a.startTime.localeCompare(b.startTime) ||
    a.endTime.localeCompare(b.endTime) ||
    a.id.localeCompare(b.id)
  );
}

export function resolveFocusStudyBlockAnchor({
  session,
  studyBlocks,
}: FocusStudyBlockAnchorInput): StudyBlock | null {
  // 只处理 running / paused；completed 永不映射（完成即清除执行态）
  if (!session) return null;
  if (session.status !== "running" && session.status !== "paused") return null;
  // 无任务关联（course-only / standalone）：Header 可展示，但不映射 StudyBlock
  if (!session.assignmentId) return null;

  const start = localStartParts(session.startedAt);
  if (!start) return null;

  const candidates = studyBlocks.filter((b) => {
    if (b.assignmentId !== session.assignmentId) return false;
    // Workflow UX V15：released block 不再声明「此计划正在执行」——不作 execution anchor
    if (!isStudyBlockPlanningActive(b)) return false;
    if (b.date !== start.date) return false;
    const s = timeToMinutes(b.startTime);
    const e = timeToMinutes(b.endTime);
    if (s === null || e === null) return false;
    return s <= start.minutesOfDay && start.minutesOfDay < e; // [start, end)
  });

  if (candidates.length === 0) return null;
  return [...candidates].sort(compareBlocks)[0];
}
