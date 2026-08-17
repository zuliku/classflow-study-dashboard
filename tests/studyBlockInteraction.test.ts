import { describe, it, expect } from "vitest";
import {
  calculateMovedStudyBlock,
  clampStudyBlockStart,
  getStudyBlockDuration,
  isSameStudyBlockPosition,
  createQuickStudyBlockCandidate,
  QUICK_SCHEDULE_DURATION_MINUTES,
} from "@/lib/timeline/studyBlockInteraction";
import { StudyBlock } from "@/types";

const base: StudyBlock = {
  id: "sb-1",
  title: "数据结构复习",
  date: "2026-08-10",
  startTime: "10:00",
  endTime: "11:00",
  assignmentId: "a-9",
  courseId: "c-2",
  source: "manual",
};

describe("studyBlockInteraction", () => {
  it("15min snap：pointer 落在 10:07 → 10:00（round 到 15min 格）", () => {
    const moved = calculateMovedStudyBlock(base, "2026-08-10", 10 * 60 + 7, 0);
    expect(moved.startTime).toBe("10:00");
    expect(moved.endTime).toBe("11:00");
  });

  it("duration preserved：1h 块移动后仍为 1h", () => {
    const moved = calculateMovedStudyBlock(base, "2026-08-11", 14 * 60 + 22, 0);
    expect(getStudyBlockDuration(moved)).toBe(60);
    expect(moved.startTime).toBe("14:15");
    expect(moved.endTime).toBe("15:15");
  });

  it("move to another date：date 更新、identity/domain 字段保留", () => {
    const moved = calculateMovedStudyBlock(base, "2026-08-14", 9 * 60, 0);
    expect(moved.date).toBe("2026-08-14");
    expect(moved.id).toBe("sb-1");
    expect(moved.title).toBe("数据结构复习");
    expect(moved.assignmentId).toBe("a-9");
    expect(moved.courseId).toBe("c-2");
    expect(moved.source).toBe("manual");
  });

  it("08:00 下界 clamp：07:20 起始被夹到 08:00", () => {
    const moved = calculateMovedStudyBlock(base, "2026-08-10", 7 * 60 + 20, 0);
    expect(moved.startTime).toBe("08:00");
    expect(moved.endTime).toBe("09:00");
  });

  it("21:00 上界 clamp：20:30 起始的 1h 块被夹到 20:00", () => {
    const moved = calculateMovedStudyBlock(base, "2026-08-10", 20 * 60 + 30, 0);
    expect(moved.startTime).toBe("20:00");
    expect(moved.endTime).toBe("21:00");
  });

  it("pointerOffsetMinutes：按住块中部拖动不跳变（offset 保持 grab 位置）", () => {
    // 10:00–11:00 块，按住 10:30（offset=30）；pointer 到 14:30 → start = 14:00
    const moved = calculateMovedStudyBlock(base, "2026-08-10", 14 * 60 + 30, 30);
    expect(moved.startTime).toBe("14:00");
    expect(moved.endTime).toBe("15:00");
  });

  it("isSameStudyBlockPosition：相同位置 true；时间变 false", () => {
    expect(isSameStudyBlockPosition(base, { ...base })).toBe(true);
    expect(
      isSameStudyBlockPosition(base, { ...base, startTime: "14:00", endTime: "15:00" })
    ).toBe(false);
    expect(isSameStudyBlockPosition(base, { ...base, date: "2026-08-11" })).toBe(false);
  });

  it("pure move 不产生 side effect：candidate 是原对象的派生副本（冲突检查由调用方独立进行）", () => {
    const moved = calculateMovedStudyBlock(base, "2026-08-13", 16 * 60, 0);
    expect(moved).not.toBe(base);
    // 原对象未被修改
    expect(base.date).toBe("2026-08-10");
    expect(base.startTime).toBe("10:00");
    expect(base.endTime).toBe("11:00");
    // clamp 独立可用：08:20 保留；21:00 - 1h 上界
    expect(clampStudyBlockStart(500, 60)).toBe(500);
    expect(clampStudyBlockStart(1300, 60)).toBe(1200); // 21:00 - 1h
  });
});

const quickAssignment = { id: "a-1", title: "期中复习提纲整理", courseId: "c-2" };

describe("createQuickStudyBlockCandidate", () => {
  it("14:07 → 14:00–15:00（pointer 代表 start，15min snap）", () => {
    const c = createQuickStudyBlockCandidate({ assignment: quickAssignment, date: "2026-08-13", pointerMinutes: 14 * 60 + 7 });
    expect(c.startTime).toBe("14:00");
    expect(c.endTime).toBe("15:00");
  });

  it("20:50 → 20:00–21:00（21:00 上界 clamp，duration 不缩短）", () => {
    const c = createQuickStudyBlockCandidate({ assignment: quickAssignment, date: "2026-08-13", pointerMinutes: 20 * 60 + 50 });
    expect(c.startTime).toBe("20:00");
    expect(c.endTime).toBe("21:00");
  });

  it("08:02 → 08:00–09:00（08:00 下界 clamp）", () => {
    const c = createQuickStudyBlockCandidate({ assignment: quickAssignment, date: "2026-08-13", pointerMinutes: 8 * 60 + 2 });
    expect(c.startTime).toBe("08:00");
    expect(c.endTime).toBe("09:00");
  });

  it("identity/domain 字段保留：title / assignmentId / courseId / source=manual", () => {
    const c = createQuickStudyBlockCandidate({ assignment: quickAssignment, date: "2026-08-14", pointerMinutes: 10 * 60 });
    expect(c.title).toBe("期中复习提纲整理");
    expect(c.assignmentId).toBe("a-1");
    expect(c.courseId).toBe("c-2");
    expect(c.source).toBe("manual");
    expect(c.date).toBe("2026-08-14");
  });

  it("QUICK_SCHEDULE_DURATION_MINUTES === 60（快速安排固定 1 小时）", () => {
    expect(QUICK_SCHEDULE_DURATION_MINUTES).toBe(60);
    const c = createQuickStudyBlockCandidate({ assignment: quickAssignment, date: "2026-08-13", pointerMinutes: 16 * 60 });
    expect(getStudyBlockDuration(c)).toBe(60);
  });
});
