import { describe, it, expect } from "vitest";
import { allocateStudyCapacity } from "@/lib/planning/capacityAllocation";
import { FreeTimeSlot } from "@/lib/planning/freeTime";
import { Assignment, StudyBlock } from "@/types";

const NOW = new Date(2026, 7, 10, 9, 0, 0);
const iso = (d: Date, h = 23, m = 59) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
const date = (offset: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function mk(id: string, patch: Partial<Assignment> = {}): Assignment {
  return {
    id, courseId: "c1", title: id, description: "", priority: "medium",
    status: "todo", progress: 0, tags: [],
    ...patch,
  } as Assignment;
}

function slot(start: string, end: string, dateStr = date(1)): FreeTimeSlot {
  const s = Number(start.split(":")[0]) * 60 + Number(start.split(":")[1]);
  const e = Number(end.split(":")[0]) * 60 + Number(end.split(":")[1]);
  return { date: dateStr, startTime: start, endTime: end, minutes: e - s };
}

function blockDuration(b: { startTime: string; endTime: string }): number {
  const [sh, sm] = b.startTime.split(":").map(Number);
  const [eh, em] = b.endTime.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

function run(assignments: Assignment[], freeSlots: FreeTimeSlot[]) {
  return allocateStudyCapacity({
    assignments,
    studyBlocks: [] as StudyBlock[],
    freeSlots,
    fromDate: date(0),
    toDate: date(1),
    now: NOW,
  });
}

describe("V1.3 Exact Minute Conservation（Red First）", () => {
  it("§21 killer：A need=100 + B need=80、共享 180 → 两者都 complete，总量 180（旧算法 A 吃 120）", () => {
    const a = mk("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 100 });
    const b = mk("b1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 80 });
    const r = run([a, b], [slot("18:00", "21:00")]); // 180
    const ta = r.tasks.find((t) => t.assignmentId === "a1")!;
    const tb = r.tasks.find((t) => t.assignmentId === "b1")!;
    expect(ta.allocatedMinutes).toBe(100);
    expect(ta.completeCoverage).toBe(true);
    expect(tb.allocatedMinutes).toBe(80);
    expect(tb.completeCoverage).toBe(true);
    expect(r.totalAllocatedMinutes).toBe(180);
    expect(r.unusedFreeMinutes).toBe(0);
  });

  it("§18 100min exact：Free 180 → allocated=100、sum blocks=100、unused=80", () => {
    const a = mk("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 100 });
    const r = run([a], [slot("18:00", "21:00")]);
    const ta = r.tasks[0];
    expect(ta.allocatedMinutes).toBe(100);
    expect(ta.projectedBlocks.reduce((s, b) => s + b.minutes, 0)).toBe(100);
    expect(ta.projectedBlocks.every((b) => blockDuration(b) === b.minutes)).toBe(true);
    expect(r.unusedFreeMinutes).toBe(80);
    // 推荐 70 + 30（连续容量充足时避免微型尾块）
    expect(ta.projectedBlocks.map((b) => b.minutes).sort((x, y) => y - x)).toEqual([70, 30]);
  });

  it("§19 91min exact：不能 90+30", () => {
    const a = mk("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 91 });
    const r = run([a], [slot("18:00", "21:00")]);
    const ta = r.tasks[0];
    expect(ta.allocatedMinutes).toBe(91);
    expect(ta.projectedBlocks.reduce((s, b) => s + b.minutes, 0)).toBe(91);
    expect(ta.projectedBlocks.map((b) => b.minutes).sort((x, y) => y - x)).toEqual([61, 30]);
  });

  it("§17 short task：20min → 精确 20min block（不创建 30min）", () => {
    const a = mk("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 20 });
    const r = run([a], [slot("18:00", "19:00")]);
    const ta = r.tasks[0];
    expect(ta.allocatedMinutes).toBe(20);
    expect(ta.projectedBlocks).toHaveLength(1);
    expect(ta.projectedBlocks[0].minutes).toBe(20);
    expect(ta.completeCoverage).toBe(true);
    expect(r.unusedFreeMinutes).toBe(40);
  });

  it("§20 partial：need=100、free=90 → block 90、allocated 90、shortfall 10（不 overshoot）", () => {
    const a = mk("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 100 });
    const r = run([a], [slot("18:00", "19:30")]); // 90
    const ta = r.tasks[0];
    expect(ta.allocatedMinutes).toBe(90);
    expect(ta.shortfallMinutes).toBe(10);
    expect(ta.completeCoverage).toBe(false);
    expect(ta.projectedBlocks.reduce((s, b) => s + b.minutes, 0)).toBe(90);
  });

  it("§23 deadline split：Free 09-10、DDL 09:20、need 20 → 09:00-09:20 complete", () => {
    const a = mk("a1", { ddl: iso(new Date(NOW.getTime()), 9, 20), estimatedMinutes: 20 });
    const r = run([a], [slot("09:00", "10:00", date(0))]);
    const ta = r.tasks[0];
    expect(ta.completeCoverage).toBe(true);
    expect(ta.projectedBlocks[0].startTime).toBe("09:00");
    expect(ta.projectedBlocks[0].endTime).toBe("09:20");
  });

  it("§24 later deadline tail：A DDL 09:20 need 20 + B DDL 10:00 need 40 → 两者完整（tail 不丢失）", () => {
    const a = mk("a1", { ddl: iso(new Date(NOW.getTime()), 9, 20), estimatedMinutes: 20 });
    const b = mk("b1", { ddl: iso(new Date(NOW.getTime()), 10, 0), estimatedMinutes: 40 });
    const r = run([a, b], [slot("09:00", "10:00", date(0))]);
    const ta = r.tasks.find((t) => t.assignmentId === "a1")!;
    const tb = r.tasks.find((t) => t.assignmentId === "b1")!;
    expect(ta.completeCoverage).toBe(true);
    expect(ta.projectedBlocks[0].endTime).toBe("09:20");
    expect(tb.completeCoverage).toBe(true);
    expect(tb.projectedBlocks[0].startTime).toBe("09:20");
    expect(tb.projectedBlocks[0].endTime).toBe("10:00");
  });

  it("§22 fragmented：30 + 20 两段、need 50 → 30+20 complete（<30 terminal 允许）", () => {
    const a = mk("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 50 });
    // 通过两段独立 slot 模拟（20min fragment 是内部合法容量）
    const r = run([a], [slot("18:00", "18:30"), slot("18:30", "18:50")]);
    const ta = r.tasks[0];
    expect(ta.completeCoverage).toBe(true);
    expect(ta.projectedBlocks.reduce((s, b) => s + b.minutes, 0)).toBe(50);
  });

  it("§47 property sweep：need 1..360 在连续 360 slot 中 exact（每 block>0 且 ≤90，绝不 overshoot）", () => {
    for (let need = 1; need <= 360; need++) {
      const a = mk("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: need });
      const r = run([a], [slot("08:00", "14:00")]); // 360
      const ta = r.tasks[0];
      expect(ta.allocatedMinutes, `need=${need}`).toBe(need);
      expect(ta.shortfallMinutes, `need=${need}`).toBe(0);
      const sum = ta.projectedBlocks.reduce((s, b) => s + b.minutes, 0);
      expect(sum, `need=${need}`).toBe(need);
      for (const b of ta.projectedBlocks) {
        expect(b.minutes, `need=${need}`).toBeGreaterThan(0);
        expect(b.minutes, `need=${need}`).toBeLessThanOrEqual(90);
        expect(blockDuration(b), `need=${need}`).toBe(b.minutes);
      }
    }
  });

  it("§48 pool conservation sweep：free=360、need 1..360 → allocated + unused = 360", () => {
    for (let need = 1; need <= 360; need++) {
      const a = mk("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: need });
      const r = run([a], [slot("08:00", "14:00")]);
      expect(r.totalAllocatedMinutes + r.unusedFreeMinutes, `need=${need}`).toBe(360);
      expect(r.totalShortfallMinutes, `need=${need}`).toBe(0);
    }
  });
});
