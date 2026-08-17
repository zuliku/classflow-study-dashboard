import { describe, it, expect } from "vitest";
import { projectStudyPlans } from "@/lib/analytics/studyPlanProjection";
import { AnalyticsProjectionEvent } from "@/lib/analytics/types";

function ev(
  type: string,
  entityId: string,
  occurredAt: number,
  data: Record<string, unknown>,
  seq = 1,
  courseId?: string
): AnalyticsProjectionEvent {
  return { type, entityId, occurredAt, sequence: seq, courseId, data };
}

const CREATED = (id: string, at: number, data: Record<string, unknown>) => ev("study_block.created", id, at, data);
const UPDATED = (id: string, at: number, data: Record<string, unknown>) => ev("study_block.updated", id, at, data);
const DELETED = (id: string, at: number) => ev("study_block.deleted", id, at, {});

// 2026-08-17 周一 10:00 本地
const MON_10 = new Date(2026, 7, 17, 10, 0, 0).getTime();

describe("StudyPlan Projection", () => {
  it("spec A：created 在 scheduledStart 之前 → 成熟计划（plannedMinutes 使用记录值）", () => {
    const { maturedPlans, incompleteEntities } = projectStudyPlans([
      CREATED("p1", MON_10 - 86400000, { date: "2026-08-17", startTime: "10:00", endTime: "11:30", plannedMinutes: 90 }),
    ]);
    expect(maturedPlans).toHaveLength(1);
    expect(maturedPlans[0].entityId).toBe("p1");
    expect(maturedPlans[0].scheduledStart).toBe(MON_10);
    expect(maturedPlans[0].plannedMinutes).toBe(90);
    expect(incompleteEntities).toEqual([]);
  });

  it("spec A：created 在 scheduledStart 之后 → 不成熟（不纳入计划时长）", () => {
    const { maturedPlans } = projectStudyPlans([
      CREATED("p1", MON_10 + 3600000, { date: "2026-08-17", startTime: "10:00", endTime: "11:30", plannedMinutes: 90 }),
    ]);
    expect(maturedPlans).toHaveLength(0);
  });

  it("spec A：plannedMinutes 缺失 → 用 endTime - startTime 推断", () => {
    const { maturedPlans } = projectStudyPlans([
      CREATED("p1", MON_10 - 86400000, { date: "2026-08-17", startTime: "10:00", endTime: "12:00", plannedMinutes: null }),
    ]);
    expect(maturedPlans[0].plannedMinutes).toBe(120);
  });

  it("spec B：updated 改开始时间 → 旧 revision 不再成熟，新 revision 成熟", () => {
    const at = MON_10 - 86400000;
    const movedAt = MON_10 + 2 * 3600000; // 10:00 开始后 12:00 改到 14:00
    const { maturedPlans, revisions } = projectStudyPlans([
      CREATED("p1", at, { date: "2026-08-17", startTime: "10:00", endTime: "11:00", plannedMinutes: 60 }),
      UPDATED("p1", movedAt, { date: "2026-08-17", startTime: "14:00", endTime: "15:00", plannedMinutesAfter: 60 }),
    ]);
    const starts = maturedPlans.map((p) => p.scheduledStart);
    expect(starts).toContain(MON_10);
    expect(starts).toContain(new Date(2026, 7, 17, 14, 0, 0).getTime());
    expect(maturedPlans).toHaveLength(2);
    expect(revisions).toHaveLength(2);
  });

  it("spec B：updated 在 scheduledStart 之前改开始时间 → 旧 revision 不成熟", () => {
    const at = MON_10 - 86400000;
    const movedAt = at + 3600000; // 计划开始前一天就改走
    const { maturedPlans } = projectStudyPlans([
      CREATED("p1", at, { date: "2026-08-17", startTime: "10:00", endTime: "11:00", plannedMinutes: 60 }),
      UPDATED("p1", movedAt, { date: "2026-08-17", startTime: "14:00", endTime: "15:00", plannedMinutesAfter: 60 }),
    ]);
    expect(maturedPlans).toHaveLength(1);
    expect(maturedPlans[0].scheduledStart).toBe(new Date(2026, 7, 17, 14, 0, 0).getTime());
  });

  it("spec B：updated 只改时长 → 开始时间不变，最终 revision 仍成熟（不重复计）", () => {
    const at = MON_10 - 86400000;
    // 开始前延长：新的 revision 生效于 start 之前 → 计新值
    const before = MON_10 - 3600000;
    const { maturedPlans } = projectStudyPlans([
      CREATED("p1", at, { date: "2026-08-17", startTime: "10:00", endTime: "11:00", plannedMinutes: 60 }),
      UPDATED("p1", before, { date: "2026-08-17", startTime: "10:00", endTime: "11:30", plannedMinutesAfter: 90 }),
    ]);
    expect(maturedPlans).toHaveLength(1);
    expect(maturedPlans[0].scheduledStart).toBe(MON_10);
    expect(maturedPlans[0].plannedMinutes).toBe(90);
    // 开始后延长：start 时刻的 revision 已生效 → 保持原值
    const after = MON_10 + 3600000;
    const { maturedPlans: afterPlans } = projectStudyPlans([
      CREATED("p1", at, { date: "2026-08-17", startTime: "10:00", endTime: "11:00", plannedMinutes: 60 }),
      UPDATED("p1", after, { date: "2026-08-17", startTime: "10:00", endTime: "11:30", plannedMinutesAfter: 90 }),
    ]);
    expect(afterPlans).toHaveLength(1);
    expect(afterPlans[0].plannedMinutes).toBe(60);
  });

  it("spec C：deleted → 后续不再成熟；删除前 revision 保留", () => {
    const at = MON_10 - 86400000;
    const { maturedPlans, incompleteEntities } = projectStudyPlans([
      CREATED("p1", at, { date: "2026-08-17", startTime: "10:00", endTime: "11:00", plannedMinutes: 60 }),
      DELETED("p1", MON_10 + 3600000),
    ]);
    expect(maturedPlans).toHaveLength(1);
    expect(maturedPlans[0].scheduledStart).toBe(MON_10);
    expect(incompleteEntities).toEqual([]);
  });

  it("spec E：缺 created 只有 updated/deleted → incomplete（不猜初始状态）", () => {
    const { maturedPlans, incompleteEntities } = projectStudyPlans([
      UPDATED("p1", MON_10 - 86400000, { date: "2026-08-17", startTime: "10:00", endTime: "11:00", plannedMinutesAfter: 60 }),
    ]);
    expect(maturedPlans).toHaveLength(0);
    expect(incompleteEntities).toEqual(["p1"]);
  });

  it("spec E：多实体 → incomplete 只包含缺 created 的", () => {
    const at = MON_10 - 86400000;
    const { maturedPlans, incompleteEntities } = projectStudyPlans([
      CREATED("p1", at, { date: "2026-08-17", startTime: "10:00", endTime: "11:00", plannedMinutes: 60 }),
      UPDATED("p2", at, { date: "2026-08-17", startTime: "14:00", endTime: "15:00", plannedMinutesAfter: 60 }),
    ]);
    expect(maturedPlans).toHaveLength(1);
    expect(maturedPlans[0].entityId).toBe("p1");
    expect(incompleteEntities).toEqual(["p2"]);
  });

  it("spec：maturedPlans 按 scheduledStart 升序", () => {
    const at = MON_10 - 86400000;
    const { maturedPlans } = projectStudyPlans([
      CREATED("p1", at, { date: "2026-08-18", startTime: "10:00", endTime: "11:00", plannedMinutes: 60 }),
      CREATED("p2", at, { date: "2026-08-17", startTime: "10:00", endTime: "11:00", plannedMinutes: 60 }),
    ]);
    expect(maturedPlans.map((p) => p.scheduledStart)[0]).toBe(MON_10);
  });
});
