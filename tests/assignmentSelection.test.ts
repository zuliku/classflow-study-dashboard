import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "@/store/useAppStore";
import { seedDemoData } from "./demoSeed";
import { Assignment } from "@/types";
import { getLocalDDLDate, getLocalDDLTime, parseLocalDDL } from "@/lib/ddl";
import {
  toggleSelection,
  rangeSelection,
  selectAllVisible,
  sanitizeSelection,
  sanitizeHighlight,
  bulkApplyDDLDate,
  bulkApplyStatus,
  bulkApplyPriority,
  bulkShiftDDL,
  localDateStr,
} from "@/lib/assignmentSelection";
import { createAssignmentActions } from "@/lib/assignmentActions";

const a = (id: string, ddl: string, extra: Partial<Assignment> = {}): Assignment => ({
  id,
  courseId: "c1",
  title: `任务${id}`,
  description: "",
  ddl,
  priority: "medium",
  status: "todo",
  progress: 0,
  tags: [],
  ...extra,
});

describe("selection 纯逻辑", () => {
  it("toggle：加入与移除", () => {
    expect(toggleSelection([], "a1")).toEqual(["a1"]);
    expect(toggleSelection(["a1", "a2"], "a1")).toEqual(["a2"]);
  });

  it("range：正序闭区间", () => {
    expect(rangeSelection(["a1", "a2", "a3", "a4"], "a2", "a4")).toEqual(["a2", "a3", "a4"]);
  });

  it("range：倒序（anchor 在后）仍为闭区间", () => {
    expect(rangeSelection(["a1", "a2", "a3", "a4"], "a4", "a2")).toEqual(["a2", "a3", "a4"]);
  });

  it("range：anchor 不在可见列表时退化为仅 target", () => {
    expect(rangeSelection(["a1", "a2", "a3"], "gone", "a3")).toEqual(["a3"]);
  });

  it("selectAllVisible：返回当前可见集合", () => {
    expect(selectAllVisible(["a1", "a2", "a3"])).toEqual(["a1", "a2", "a3"]);
  });

  it("筛选变化：隐藏项被清理，可见项保留", () => {
    expect(sanitizeSelection(["a1", "a2", "a3"], ["a2", "a3", "a4"])).toEqual(["a2", "a3"]);
    expect(sanitizeSelection(["a1"], ["a2"])).toEqual([]);
  });

  it("highlight 清理：隐藏回退到第一项，空列表置空", () => {
    expect(sanitizeHighlight("a1", ["a2", "a3"])).toBe("a2");
    expect(sanitizeHighlight("a1", ["a1"])).toBe("a1");
    expect(sanitizeHighlight("a1", [])).toBeNull();
  });
});

describe("bulk DDL：只改日期，保留原时间", () => {
  it("23:59 与 21:00 均保留墙钟时间（无 UTC 漂移）", () => {
    const result = bulkApplyDDLDate(
      [a("a1", "2026-08-12T23:59:00"), a("a2", "2026-08-13T21:00:00")],
      "2026-09-01"
    );
    expect(result[0].ddl).toBe("2026-09-01T23:59:00");
    expect(result[1].ddl).toBe("2026-09-01T21:00:00");
    expect(getLocalDDLDate(result[0].ddl)).toBe("2026-09-01");
    expect(getLocalDDLTime(result[0].ddl)).toBe("23:59");
    expect(getLocalDDLTime(result[1].ddl)).toBe("21:00");
  });

  it("非 DDL 字段保持不变", () => {
    const src = a("a1", "2026-08-12T23:59:00", { status: "doing", progress: 40, tags: ["t"] });
    const [moved] = bulkApplyDDLDate([src], "2026-09-01");
    expect(moved.status).toBe("doing");
    expect(moved.progress).toBe(40);
    expect(moved.tags).toEqual(["t"]);
  });
});

describe("bulk status / priority", () => {
  it("标记完成时 progress 置 100；设为进行中不动 progress", () => {
    const [done] = bulkApplyStatus([a("a1", "2026-08-12T23:59:00", { progress: 20 })], "completed");
    expect(done.status).toBe("completed");
    expect(done.progress).toBe(100);
    const [doing] = bulkApplyStatus([a("a1", "2026-08-12T23:59:00", { progress: 20 })], "doing");
    expect(doing.status).toBe("doing");
    expect(doing.progress).toBe(20);
  });

  it("批量优先级", () => {
    const [p] = bulkApplyPriority([a("a1", "2026-08-12T23:59:00")], "urgent");
    expect(p.priority).toBe("urgent");
  });
});

describe("bulkShiftDDL：整体平移（Task 3）", () => {
  it("延后 2 天：各日期分别平移，相对差保持，HH:mm 保留", () => {
    const src = [
      a("a1", "2026-08-10T18:00:00"),
      a("a2", "2026-08-11T23:59:00"),
      a("a3", "2026-08-13T09:30:00"),
    ];
    const moved = bulkShiftDDL(src, 2);
    expect(moved.map((x) => getLocalDDLDate(x.ddl))).toEqual([
      "2026-08-12",
      "2026-08-13",
      "2026-08-15",
    ]);
    expect(moved.map((x) => getLocalDDLTime(x.ddl))).toEqual(["18:00", "23:59", "09:30"]);
  });

  it("提前 1 天（负值）正常，跨月进位正确", () => {
    const moved = bulkShiftDDL([a("a1", "2026-09-01T08:00:00")], -1);
    expect(getLocalDDLDate(moved[0].ddl)).toBe("2026-08-31");
    expect(getLocalDDLTime(moved[0].ddl)).toBe("08:00");
  });

  it("延后跨月正确（8月31日 +1 → 9月1日）", () => {
    const moved = bulkShiftDDL([a("a1", "2026-08-31T23:59:00")], 1);
    expect(getLocalDDLDate(moved[0].ddl)).toBe("2026-09-01");
    expect(getLocalDDLTime(moved[0].ddl)).toBe("23:59");
  });

  it("本地 23:59 平移后仍是 23:59（无 UTC 漂移，不会变成次日 07:59）", () => {
    const moved = bulkShiftDDL([a("a1", "2026-08-12T23:59:00")], 3);
    expect(getLocalDDLTime(moved[0].ddl)).toBe("23:59");
    const d = parseLocalDDL(moved[0].ddl)!;
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
    expect(d.getDate()).toBe(15);
  });

  it("非法 DDL 安全原样保留，不 throw", () => {
    const bad = a("a1", "not-a-date");
    const moved = bulkShiftDDL([bad], 2);
    expect(moved[0]).toEqual(bad);
  });

  it("保留非日期字段，且不 mutate 原数组", () => {
    const src = a("a1", "2026-08-12T23:59:00", { status: "doing", progress: 40, tags: ["t"] });
    const moved = bulkShiftDDL([src], 1);
    expect(moved[0].status).toBe("doing");
    expect(moved[0].progress).toBe(40);
    expect(moved[0].tags).toEqual(["t"]);
    expect(src.ddl).toBe("2026-08-12T23:59:00");
  });

  it("localDateStr 不使用 toISOString（时区安全）", () => {
    const d = new Date(2026, 7, 12, 23, 59); // 本地 8月12日 23:59
    expect(localDateStr(d)).toBe("2026-08-12");
  });
});

describe("bulk delete + undo（store 集成）", () => {
  beforeEach(() => {
    seedDemoData();
  });

  it("删除两项 → Toast 撤销 → 完整恢复（Assignment + CalendarMark + sourceId）", () => {
    const store = useAppStore.getState();
    const a1 = store.assignments.find((x) => x.id === "a1")!;
    const a2 = store.assignments.find((x) => x.id === "a2")!;
    const cm1 = store.calendarMarks.find((m) => m.id === "cm1")!;
    const cm2 = store.calendarMarks.find((m) => m.id === "cm2")!;
    expect(cm1.sourceId).toBe("a1");
    expect(cm2.sourceId).toBe("a2");

    let undoAction: (() => void) | null = null;
    const actions = createAssignmentActions({
      getAssignments: () => useAppStore.getState().assignments,
      updateAssignment: (x) => useAppStore.getState().updateAssignment(x),
      setSelectedAssignmentId: () => {},
      deleteAssignment: (id) => useAppStore.getState().deleteAssignment(id),
      restoreAssignment: (x, marks) => useAppStore.getState().restoreAssignment(x, marks),
      pushToast: (t) => {
        undoAction = t.onAction ?? null;
      },
    });

    actions.remove(["a1", "a2"]);
    expect(undoAction).not.toBeNull();
    // 删除后消失
    expect(useAppStore.getState().assignments.find((x) => x.id === "a1")).toBeUndefined();
    expect(useAppStore.getState().calendarMarks.find((m) => m.id === "cm1")).toBeUndefined();
    expect(useAppStore.getState().calendarMarks.find((m) => m.id === "cm2")).toBeUndefined();

    undoAction!();
    const after = useAppStore.getState();
    expect(after.assignments.find((x) => x.id === "a1")).toEqual(a1);
    expect(after.assignments.find((x) => x.id === "a2")).toEqual(a2);
    expect(after.calendarMarks.find((m) => m.id === "cm1")).toEqual(cm1);
    expect(after.calendarMarks.find((m) => m.id === "cm2")).toEqual(cm2);
    // 不重复
    expect(after.calendarMarks.filter((m) => m.sourceId === "a1")).toHaveLength(1);
  });

  it("批量状态/优先级/DDL 通过 updateAssignment 逐项生效且 ID 不变", () => {
    const actions = createAssignmentActions({
      getAssignments: () => useAppStore.getState().assignments,
      updateAssignment: (x) => useAppStore.getState().updateAssignment(x),
      setSelectedAssignmentId: () => {},
      deleteAssignment: () => null,
      restoreAssignment: () => {},
      pushToast: () => {},
    });

    const a3before = useAppStore.getState().assignments.find((x) => x.id === "a3")!;
    const a3OrigTime = getLocalDDLTime(a3before.ddl);

    actions.markCompleted(["a1", "a2"]);
    actions.setPriority(["a1"], "urgent");
    actions.setDDLDate(["a3"], "2026-12-25");

    const after = useAppStore.getState();
    expect(after.assignments.find((x) => x.id === "a1")!.status).toBe("completed");
    expect(after.assignments.find((x) => x.id === "a2")!.status).toBe("completed");
    expect(after.assignments.find((x) => x.id === "a1")!.priority).toBe("urgent");
    const a3 = after.assignments.find((x) => x.id === "a3")!;
    expect(getLocalDDLDate(a3.ddl)).toBe("2026-12-25");
    expect(getLocalDDLTime(a3.ddl)).toBe(a3OrigTime);
    // CalendarMark 同步
    expect(after.calendarMarks.find((m) => m.sourceId === "a3")?.date).toBe("2026-12-25");
  });

  it("bulk shift / set date 后 undo：Assignment + CalendarMark 完整恢复", () => {
    const beforeA1 = useAppStore.getState().assignments.find((x) => x.id === "a1")!;
    const beforeA2 = useAppStore.getState().assignments.find((x) => x.id === "a2")!;
    const beforeCm1 = useAppStore.getState().calendarMarks.find((m) => m.id === "cm1")!;
    const beforeCm2 = useAppStore.getState().calendarMarks.find((m) => m.id === "cm2")!;

    let undoAction: (() => void) | null = null;
    const actions = createAssignmentActions({
      getAssignments: () => useAppStore.getState().assignments,
      updateAssignment: (x) => useAppStore.getState().updateAssignment(x),
      setSelectedAssignmentId: () => {},
      deleteAssignment: () => null,
      restoreAssignment: () => {},
      pushToast: (t) => {
        undoAction = t.onAction ?? null;
      },
    });

    // shift +2 天
    actions.shiftDDL(["a1", "a2"], 2);
    expect(undoAction).not.toBeNull();
    const shifted = useAppStore.getState().assignments.find((x) => x.id === "a1")!;
    expect(getLocalDDLDate(shifted.ddl)).not.toBe(getLocalDDLDate(beforeA1.ddl));
    undoAction!();
    // undo 后原 ddl 与 mark 日期恢复（sourceId 保留、无重复 mark）
    const restored = useAppStore.getState();
    expect(restored.assignments.find((x) => x.id === "a1")).toEqual(beforeA1);
    expect(restored.assignments.find((x) => x.id === "a2")).toEqual(beforeA2);
    expect(restored.calendarMarks.find((m) => m.id === "cm1")).toEqual(beforeCm1);
    expect(restored.calendarMarks.find((m) => m.id === "cm2")).toEqual(beforeCm2);
    expect(restored.calendarMarks.filter((m) => m.sourceId === "a1")).toHaveLength(1);

    // set date 的 undo 同样恢复
    undoAction = null;
    actions.setDDLDate(["a1"], "2027-01-01");
    expect(undoAction).not.toBeNull();
    undoAction!();
    expect(useAppStore.getState().assignments.find((x) => x.id === "a1")).toEqual(beforeA1);
    expect(useAppStore.getState().calendarMarks.find((m) => m.id === "cm1")).toEqual(beforeCm1);
  });
});
