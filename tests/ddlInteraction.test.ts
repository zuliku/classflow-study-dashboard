import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "@/store/useAppStore";
import { seedDemoData } from "./demoSeed";
import { Assignment } from "@/types";
import { getLocalDDLDate, getLocalDDLTime, parseLocalDDL } from "@/lib/ddl";
import {
  isValidDDL,
  isValidDDLTime,
  moveAssignmentDDL,
  editAssignmentDDLTime,
} from "@/lib/ddlInteraction";

const base = (overrides: Partial<Assignment> = {}): Assignment => ({
  id: "a9",
  courseId: "c2",
  title: "DDL拖动测试任务",
  description: "",
  ddl: "2026-08-12T23:59:00",
  priority: "high",
  status: "todo",
  progress: 0,
  tags: [],
  ...overrides,
});

describe("DDL 拖动纯逻辑", () => {
  it("8月12日 23:59 拖到 8月18日 → 2026-08-18T23:59:00（保留原截止时间）", () => {
    const result = moveAssignmentDDL(base(), "2026-08-18");
    expect(result).not.toBeNull();
    expect(result!.assignment.ddl).toBe("2026-08-18T23:59:00");
    expect(result!.assignment.id).toBe("a9");
  });

  it("本地时间无 UTC 漂移：解析出的墙钟时间与原一致", () => {
    const result = moveAssignmentDDL(base(), "2026-08-18")!;
    expect(getLocalDDLDate(result.assignment.ddl)).toBe("2026-08-18");
    expect(getLocalDDLTime(result.assignment.ddl)).toBe("23:59");
    const d = parseLocalDDL(result.assignment.ddl)!;
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
  });

  it("同日期 drop → null（不产生 mutation）", () => {
    expect(moveAssignmentDDL(base(), "2026-08-12")).toBeNull();
  });

  it("无法解析的 DDL → null（禁止拖动）", () => {
    expect(moveAssignmentDDL(base({ ddl: "not-a-date" }), "2026-08-18")).toBeNull();
  });

  it("completed 任务同样允许调整日期", () => {
    const result = moveAssignmentDDL(base({ status: "completed", progress: 100 }), "2026-08-18");
    expect(result).not.toBeNull();
    expect(result!.assignment.status).toBe("completed");
  });

  it("只改日期，其他字段（priority/status/subtasks/description）原样", () => {
    const a = base({ description: "x", tags: ["t1"], subtasks: [{ id: "st1", title: "s", completed: true }] });
    const result = moveAssignmentDDL(a, "2026-08-18")!.assignment;
    expect(result.title).toBe(a.title);
    expect(result.priority).toBe(a.priority);
    expect(result.status).toBe(a.status);
    expect(result.description).toBe("x");
    expect(result.tags).toEqual(["t1"]);
    expect(result.subtasks).toEqual(a.subtasks);
  });
});

describe("快速修改时间", () => {
  it("23:59 → 21:30，保持新日期", () => {
    const result = editAssignmentDDLTime(base(), "2026-08-18", "21:30");
    expect(result).not.toBeNull();
    expect(result!.assignment.ddl).toBe("2026-08-18T21:30:00");
    expect(getLocalDDLTime(result!.assignment.ddl)).toBe("21:30");
  });

  it("非法时间 → null", () => {
    expect(editAssignmentDDLTime(base(), "2026-08-18", "25:99")).toBeNull();
    expect(editAssignmentDDLTime(base(), "2026-08-18", "")).toBeNull();
  });

  it("日期与时间都没变 → null", () => {
    expect(editAssignmentDDLTime(base(), "2026-08-12", "23:59")).toBeNull();
  });

  it("时间校验", () => {
    expect(isValidDDLTime("21:30")).toBe(true);
    expect(isValidDDLTime("09:05")).toBe(true);
    expect(isValidDDLTime("9:5")).toBe(false);
    expect(isValidDDLTime("21:60")).toBe(false);
  });
});

describe("数据回归：updateAssignment 链路", () => {
  beforeEach(() => {
    seedDemoData();
  });

  it("Drop 后 Assignment ID 不变，CalendarMark sourceId 关联仍有效且日期同步", () => {
    const store = useAppStore.getState();
    const a1 = store.assignments.find((a) => a.id === "a1")!;
    const markBefore = store.calendarMarks.find((m) => m.id === "cm1")!;
    expect(markBefore.sourceId).toBe("a1");
    expect(markBefore.date).toBe(getLocalDDLDate(a1.ddl));

    const result = moveAssignmentDDL(a1, "2026-12-20");
    expect(result).not.toBeNull();
    store.updateAssignment(result!.assignment);

    const after = useAppStore.getState();
    const moved = after.assignments.find((a) => a.id === "a1")!;
    expect(moved.id).toBe("a1");
    expect(moved.ddl).toBe("2026-12-20" + "T" + getLocalDDLTime(a1.ddl) + ":00");
    // CalendarMark：id/sourceId 不变，date 同步到新 DDL
    const markAfter = after.calendarMarks.find((m) => m.id === "cm1")!;
    expect(markAfter.id).toBe("cm1");
    expect(markAfter.sourceId).toBe("a1");
    expect(markAfter.date).toBe("2026-12-20");
    // 不产生多余标记
    expect(after.calendarMarks.filter((m) => m.sourceId === "a1")).toHaveLength(1);
  });

  it("Undo：updateAssignment(original) 精确恢复原 DDL 与标记日期", () => {
    const store = useAppStore.getState();
    const original = store.assignments.find((a) => a.id === "a1")!;
    const result = moveAssignmentDDL(original, "2026-12-20")!;
    store.updateAssignment(result.assignment);
    expect(getLocalDDLDate(useAppStore.getState().assignments.find((a) => a.id === "a1")!.ddl)).toBe("2026-12-20");

    // 撤销 = 恢复原 assignment 对象
    store.updateAssignment(original);
    const restored = useAppStore.getState().assignments.find((a) => a.id === "a1")!;
    expect(restored).toEqual(original);
    expect(restored.ddl).toBe(original.ddl);
    const mark = useAppStore.getState().calendarMarks.find((m) => m.id === "cm1")!;
    expect(mark.date).toBe(getLocalDDLDate(original.ddl));
    expect(mark.sourceId).toBe("a1");
  });

  it("同日期 drop 不产生任何 Store mutation", () => {
    const store = useAppStore.getState();
    const before = store.assignments.find((a) => a.id === "a1")!;
    const result = moveAssignmentDDL(before, getLocalDDLDate(before.ddl));
    expect(result).toBeNull();
    expect(useAppStore.getState().assignments.find((a) => a.id === "a1")).toEqual(before);
  });

  it("isValidDDL 识别脏数据", () => {
    expect(isValidDDL("2026-08-12T23:59:00")).toBe(true);
    expect(isValidDDL("garbage")).toBe(false);
    expect(isValidDDL("")).toBe(false);
  });
});
