/**
 * Assignment 完成投影（Analytics V2）：
 * 重建完成时的 DDL（created / deadline_changed 历史状态），判断按时/逾期。
 * 无可靠 DDL（History coverage 前存在 / 从未设置）→ 不进入 eligible sample。
 */

import { AnalyticsProjectionEvent } from "@/lib/analytics/types";
import { parseLocalDDL } from "@/lib/ddl";

export interface AssignmentCompletion {
  entityId: string;
  completedAt: number;
  ddlAtCompletion: string | null;
  onTime: boolean | null; // null = 无可靠 DDL（不参与按时率）
  reopened: boolean;
}

export interface AssignmentProjectionResult {
  completions: AssignmentCompletion[];
  /** distinct 至少完成过一次的 assignment id 数 */
  uniqueCompletedAssignments: number;
  /** distinct 被 reopened 过的 assignment id 数 */
  uniqueReopenedAssignments: number;
}

/** 纯函数：从 Assignment 事件重建完成投影 */
export function projectAssignmentCompletions(events: AnalyticsProjectionEvent[]): AssignmentProjectionResult {
  const byEntity = new Map<string, AnalyticsProjectionEvent[]>();
  for (const e of events) {
    const list = byEntity.get(e.entityId) ?? [];
    list.push(e);
    byEntity.set(e.entityId, list);
  }

  const completions: AssignmentCompletion[] = [];
  const completedIds = new Set<string>();
  const reopenedIds = new Set<string>();

  for (const [entityId, entityEvents] of Array.from(byEntity.entries())) {
    const sorted = entityEvents
      .filter((e) =>
        e.type === "assignment.created" ||
        e.type === "assignment.deadline_changed" ||
        e.type === "assignment.completed" ||
        e.type === "assignment.reopened"
      )
      .sort((a, b) => a.occurredAt - b.occurredAt || a.sequence - b.sequence);

    let ddl: string | null = null;
    let ddlKnown = false; // created 或 deadline_changed 出现后才算已知

    for (const event of sorted) {
      if (event.type === "assignment.created") {
        ddl = (event.data as { ddl?: string | null }).ddl ?? null;
        ddlKnown = true;
      } else if (event.type === "assignment.deadline_changed") {
        ddl = (event.data as { after?: string | null }).after ?? null;
        ddlKnown = true;
      } else if (event.type === "assignment.completed") {
        const ddlDate = ddlKnown && ddl ? parseLocalDDL(ddl) : null;
        const onTime = ddlDate ? event.occurredAt <= ddlDate.getTime() : null;
        completions.push({ entityId, completedAt: event.occurredAt, ddlAtCompletion: ddlKnown ? ddl : null, onTime, reopened: false });
        completedIds.add(entityId);
      } else if (event.type === "assignment.reopened") {
        reopenedIds.add(entityId);
      }
    }
  }

  return {
    completions,
    uniqueCompletedAssignments: completedIds.size,
    uniqueReopenedAssignments: reopenedIds.size,
  };
}
