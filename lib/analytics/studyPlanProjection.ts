/**
 * StudyBlock 计划重建（Analytics V2）：
 * 按 entityId 聚合 created/updated/deleted，按 (occurredAt, sequence) 升序重放。
 * 「成熟计划」= 该 revision 在 scheduledStart 时刻仍然有效（scheduledStart ∈ [revisionStartedAt, nextRevisionAt)）。
 * 缺少 created（History coverage 之前存在）→ projection incomplete，不计入。
 */

import { AnalyticsProjectionEvent } from "@/lib/analytics/types";

export interface MaturedPlan {
  entityId: string;
  /** 计划开始 epoch ms（date + startTime 本地墙钟） */
  scheduledStart: number;
  plannedMinutes: number;
  courseId?: string;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" + "HH:mm" → 本地墙钟 epoch ms（非法 → null） */
export function localStartMs(date: string, startTime: string): number | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(startTime);
  if (!dm || !tm) return null;
  const d = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]), 0, 0);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

export interface StudyPlanRevision {
  entityId: string;
  scheduledStart: number;
  endMs: number;
  plannedMinutes: number;
  courseId?: string;
}

export interface StudyPlanProjectionResult {
  /** 成熟计划列表（按 scheduledStart 升序） */
  maturedPlans: MaturedPlan[];
  /** 缺少 created 事件的实体（coverage 不完整，不纳入计划时长） */
  incompleteEntities: string[];
  /** 按 (occurredAt, sequence) 排序后的 revision 流（测试可断言） */
  revisions: StudyPlanRevision[];
}

/** 纯函数：从 StudyBlock 事件重放计划 revision */
export function projectStudyPlans(events: AnalyticsProjectionEvent[]): StudyPlanProjectionResult {
  const byEntity = new Map<string, AnalyticsProjectionEvent[]>();
  for (const e of events) {
    const list = byEntity.get(e.entityId) ?? [];
    list.push(e);
    byEntity.set(e.entityId, list);
  }

  const maturedPlans: MaturedPlan[] = [];
  const incompleteEntities: string[] = [];
  const revisions: StudyPlanRevision[] = [];

  for (const [entityId, entityEvents] of Array.from(byEntity.entries())) {
    const sorted = entityEvents
      .filter((e) => e.type === "study_block.created" || e.type === "study_block.updated" || e.type === "study_block.deleted")
      .sort((a, b) => a.occurredAt - b.occurredAt || a.sequence - b.sequence);

    let hasCreated = false;
    let current: { date: string; startTime: string; endTime: string; plannedMinutes: number | null; courseId?: string } | null = null;

    // 事件窗口：revision 在 [event.occurredAt, nextEvent.occurredAt) 有效
    for (let i = 0; i < sorted.length; i++) {
      const event = sorted[i];
      const next = sorted[i + 1];
      const revisionStartedAt = event.occurredAt;
      const nextRevisionAt = next ? next.occurredAt : Infinity;

      if (event.type === "study_block.created") {
        hasCreated = true;
        const data = event.data as { date?: string; startTime?: string; endTime?: string; plannedMinutes?: number | null; courseId?: string };
        if (!data.date || !data.startTime || !data.endTime) continue;
        current = {
          date: data.date,
          startTime: data.startTime,
          endTime: data.endTime,
          plannedMinutes: typeof data.plannedMinutes === "number" ? data.plannedMinutes : null,
          courseId: event.courseId,
        };
      } else if (event.type === "study_block.updated") {
        if (!current || !hasCreated) continue; // 缺 created：不猜初始状态
        const data = event.data as { date?: string; startTime?: string; endTime?: string; plannedMinutesBefore?: number | null; plannedMinutesAfter?: number | null };
        current = {
          date: data.date ?? current.date,
          startTime: data.startTime ?? current.startTime,
          endTime: data.endTime ?? current.endTime,
          plannedMinutes: data.plannedMinutesAfter ?? current.plannedMinutes,
          courseId: current.courseId,
        };
      } else if (event.type === "study_block.deleted") {
        if (!hasCreated) continue;
        // 删除前 revision 是否成熟已由前一次迭代的 [prev, deletedAt) 窗口评估；
        // 删除本身不产生新计划（计划开始时间在删除之后 → 不成熟）
        current = null;
        continue;
      }

      // created/updated 之后：当前 revision 生效期 [revisionStartedAt, nextRevisionAt)
      if (current) {
        const scheduledStart = localStartMs(current.date, current.startTime);
        if (scheduledStart !== null && scheduledStart >= revisionStartedAt && scheduledStart < nextRevisionAt) {
          const endMs = localStartMs(current.date, current.endTime);
          const inferredMinutes = endMs !== null && endMs > scheduledStart ? (endMs - scheduledStart) / 60000 : 0;
          maturedPlans.push({
            entityId,
            scheduledStart,
            plannedMinutes: current.plannedMinutes ?? inferredMinutes,
            courseId: current.courseId,
          });
          revisions.push({
            entityId,
            scheduledStart,
            endMs: endMs ?? scheduledStart,
            plannedMinutes: current.plannedMinutes ?? inferredMinutes,
            courseId: current.courseId,
          });
        }
      }
    }

    if (!hasCreated && sorted.length > 0) {
      incompleteEntities.push(entityId);
    }
  }

  maturedPlans.sort((a, b) => a.scheduledStart - b.scheduledStart);
  return { maturedPlans, incompleteEntities, revisions };
}
