import { describe, expect, it } from "vitest";
import { layoutPlanItems, planDurationMinutes, minutesToPlanTime } from "@/lib/plan/canvasLayout";
import { planSelectionKey } from "@/lib/plan/selectionKey";

describe("Plan canvas layout", () => {
  it("不重叠实体保持单 lane", () => {
    const layout = layoutPlanItems([
      { id: "a", start: 9 * 60, end: 10 * 60 },
      { id: "b", start: 10 * 60, end: 11 * 60 },
    ]);
    expect(layout.get("a")).toEqual({ lane: 0, lanes: 1 });
    expect(layout.get("b")).toEqual({ lane: 0, lanes: 1 });
  });

  it("重叠实体并排分 lane", () => {
    const layout = layoutPlanItems([
      { id: "a", start: 9 * 60, end: 11 * 60 },
      { id: "b", start: 9 * 60 + 30, end: 10 * 60 + 30 },
    ]);
    expect(layout.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(layout.get("b")).toEqual({ lane: 1, lanes: 2 });
  });

  it("三个重叠实体共享 lanes=3", () => {
    const layout = layoutPlanItems([
      { id: "a", start: 9 * 60, end: 12 * 60 },
      { id: "b", start: 9 * 60, end: 10 * 60 },
      { id: "c", start: 9 * 60 + 30, end: 10 * 60 + 30 },
    ]);
    expect(layout.get("a")?.lanes).toBe(3);
    expect(layout.get("b")?.lane).toBe(0);
    expect(layout.get("c")?.lane).toBe(2);
  });

  it("时间工具：格式化与时长", () => {
    expect(minutesToPlanTime(9 * 60 + 5)).toBe("09:05");
    expect(planDurationMinutes("09:00", "10:30")).toBe(90);
    expect(planDurationMinutes("10:00", "09:00")).toBe(0);
  });
});

describe("Plan selection key", () => {
  it("按实体类型生成稳定 key", () => {
    expect(planSelectionKey({ kind: "assignment", assignmentId: "a1" })).toBe("assignment-a1");
    expect(planSelectionKey({ kind: "block", blockId: "b1" })).toBe("block-b1");
    expect(planSelectionKey({ kind: "mark", markId: "m1" })).toBe("mark-m1");
    expect(
      planSelectionKey({
        kind: "course",
        courseId: "c1",
        date: "2026-11-02",
        startTime: "09:00",
        endTime: "10:00",
      })
    ).toBe("course-c1-2026-11-02-540");
    expect(planSelectionKey(null)).toBeNull();
  });
});
