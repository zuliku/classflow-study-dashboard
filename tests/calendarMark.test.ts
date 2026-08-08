import { describe, it, expect, beforeEach } from "vitest";
import {
  isLegacyDDLMarkForAssignment,
  isDDLMarkForAssignment,
  linkLegacyDDLMarks,
} from "@/lib/calendarMark";
import { useAppStore } from "@/store/useAppStore";
import { seedDemoData } from "./demoSeed";
import { Assignment, CalendarMark } from "@/types";

const mkAssignment = (over: Partial<Assignment> & { id: string; title: string; ddl: string }): Assignment => ({
  courseId: "c_1",
  description: "",
  priority: "medium",
  status: "todo",
  progress: 0,
  tags: [],
  ...over,
});

const mkMark = (over: Partial<CalendarMark> & { id: string; title: string; date: string }): CalendarMark => ({
  type: "ddl",
  ...over,
});

describe("isLegacyDDLMarkForAssignment（title AND date 严格匹配）", () => {
  const a = mkAssignment({ id: "a1", title: "微观经济学论文", ddl: "2026-08-10T23:59:00" });

  it("title 与 date 同时匹配 → true", () => {
    const m = mkMark({ id: "m1", title: "微观经济学论文", date: "2026-08-10" });
    expect(isLegacyDDLMarkForAssignment(m, a)).toBe(true);
  });

  it("同 date 不同 title → false（任务 A/B 同天不误删）", () => {
    const m = mkMark({ id: "m2", title: "高数作业", date: "2026-08-10" });
    expect(isLegacyDDLMarkForAssignment(m, a)).toBe(false);
  });

  it("同 title 不同 date → false", () => {
    const m = mkMark({ id: "m3", title: "微观经济学论文", date: "2026-08-11" });
    expect(isLegacyDDLMarkForAssignment(m, a)).toBe(false);
  });

  it("已带 sourceId 的 mark 不走 legacy 匹配", () => {
    const m = mkMark({ id: "m4", title: "微观经济学论文", date: "2026-08-10", sourceId: "a_other" });
    expect(isLegacyDDLMarkForAssignment(m, a)).toBe(false);
  });

  it("exam/activity 即使 title+date 相同也永不匹配", () => {
    const exam = mkMark({ id: "e1", title: "微观经济学论文", date: "2026-08-10", type: "exam" });
    const activity = mkMark({ id: "ac1", title: "微观经济学论文", date: "2026-08-10", type: "activity" });
    expect(isLegacyDDLMarkForAssignment(exam, a)).toBe(false);
    expect(isLegacyDDLMarkForAssignment(activity, a)).toBe(false);
  });
});

describe("isDDLMarkForAssignment（Level 1 sourceId 优先）", () => {
  const a = mkAssignment({ id: "a1", title: "论文", ddl: "2026-08-10T23:59:00" });

  it("sourceId 精确匹配（即使 title/date 不同）→ true", () => {
    const m = mkMark({ id: "m1", title: "已改名", date: "2026-09-01", sourceId: "a1" });
    expect(isDDLMarkForAssignment(m, a)).toBe(true);
  });

  it("sourceId 指向其他任务 → false（不落入 legacy）", () => {
    const m = mkMark({ id: "m2", title: "论文", date: "2026-08-10", sourceId: "a_other" });
    expect(isDDLMarkForAssignment(m, a)).toBe(false);
  });

  it("无 sourceId 时走 legacy title AND date", () => {
    const m = mkMark({ id: "m3", title: "论文", date: "2026-08-10" });
    expect(isDDLMarkForAssignment(m, a)).toBe(true);
  });
});

describe("linkLegacyDDLMarks（唯一确定才补 sourceId）", () => {
  it("唯一 title+date 配对自动补 sourceId，exam 不动", () => {
    const a = mkAssignment({ id: "a1", title: "论文", ddl: "2026-08-10T23:59:00" });
    const marks = [
      mkMark({ id: "m1", title: "论文", date: "2026-08-10" }),
      mkMark({ id: "e1", title: "论文", date: "2026-08-10", type: "exam" }),
      mkMark({ id: "m2", title: "论文", date: "2026-08-10", sourceId: "a_keep" }),
    ];
    const result = linkLegacyDDLMarks([a], marks);
    expect(result[0].sourceId).toBe("a1");
    expect(result[1].sourceId).toBeUndefined(); // exam 不动
    expect(result[2].sourceId).toBe("a_keep"); // 已有 sourceId 不动
  });

  it("两个 Assignment title+date 完全相同 → 不猜测，保持不动", () => {
    const a1 = mkAssignment({ id: "a1", title: "同名作业", ddl: "2026-08-10T23:59:00" });
    const a2 = mkAssignment({ id: "a2", title: "同名作业", ddl: "2026-08-10T23:59:00" });
    const marks = [mkMark({ id: "m1", title: "同名作业", date: "2026-08-10" })];
    const result = linkLegacyDDLMarks([a1, a2], marks);
    expect(result[0].sourceId).toBeUndefined();
  });
});

describe("store 层：legacy collision 不误删", () => {
  beforeEach(() => {
    seedDemoData();
  });

  function seedCollision() {
    useAppStore.setState((s) => ({
      assignments: [
        ...s.assignments,
        mkAssignment({ id: "a_A", title: "微观经济学论文", ddl: "2026-08-10T23:59:00", courseId: "c_1" }),
        mkAssignment({ id: "a_B", title: "高数作业", ddl: "2026-08-10T23:59:00", courseId: "c_1" }),
      ],
      calendarMarks: [
        ...s.calendarMarks,
        mkMark({ id: "cm_A", title: "微观经济学论文", date: "2026-08-10" }),
        mkMark({ id: "cm_B", title: "高数作业", date: "2026-08-10" }),
      ],
    }));
  }

  it("同 date 不同 title：删除 A 只删 A mark，B mark 保留", () => {
    seedCollision();
    useAppStore.getState().deleteAssignment("a_A");
    const after = useAppStore.getState();
    expect(after.calendarMarks.find((m) => m.id === "cm_A")).toBeUndefined();
    expect(after.calendarMarks.find((m) => m.id === "cm_B")).toBeTruthy();
  });

  it("同 title 不同 date：不误删", () => {
    useAppStore.setState((s) => ({
      assignments: [
        ...s.assignments,
        mkAssignment({ id: "a_A", title: "同名任务", ddl: "2026-08-10T23:59:00", courseId: "c_1" }),
        mkAssignment({ id: "a_B", title: "同名任务", ddl: "2026-08-12T23:59:00", courseId: "c_1" }),
      ],
      calendarMarks: [
        ...s.calendarMarks,
        mkMark({ id: "cm_A", title: "同名任务", date: "2026-08-10" }),
        mkMark({ id: "cm_B", title: "同名任务", date: "2026-08-12" }),
      ],
    }));
    useAppStore.getState().deleteAssignment("a_A");
    const after = useAppStore.getState();
    expect(after.calendarMarks.find((m) => m.id === "cm_A")).toBeUndefined();
    expect(after.calendarMarks.find((m) => m.id === "cm_B")).toBeTruthy();
  });

  it("删除 + 撤销：legacy mark 正确恢复且不误删其他 mark", () => {
    seedCollision();
    const removed = useAppStore.getState().deleteAssignment("a_A");
    expect(removed!.marks.map((m) => m.id)).toEqual(["cm_A"]);
    useAppStore.getState().restoreAssignment(removed!.assignment, removed!.marks);
    const after = useAppStore.getState();
    expect(after.calendarMarks.find((m) => m.id === "cm_A")).toBeTruthy();
    expect(after.calendarMarks.find((m) => m.id === "cm_B")).toBeTruthy();
    expect(after.assignments.find((a) => a.id === "a_A")).toBeTruthy();
  });

  it("updateAssignment：legacy mark 更新后自动写入 sourceId（结构升级）", () => {
    useAppStore.setState((s) => ({
      assignments: [
        ...s.assignments,
        mkAssignment({ id: "a_A", title: "旧标题", ddl: "2026-08-10T23:59:00", courseId: "c_1" }),
      ],
      calendarMarks: [...s.calendarMarks, mkMark({ id: "cm_A", title: "旧标题", date: "2026-08-10" })],
    }));
    const target = useAppStore.getState().assignments.find((a) => a.id === "a_A")!;
    useAppStore.getState().updateAssignment({ ...target, title: "新标题", ddl: "2026-08-15T23:59:00" });
    const after = useAppStore.getState();
    const mark = after.calendarMarks.find((m) => m.id === "cm_A")!;
    expect(mark.sourceId).toBe("a_A");
    expect(mark.title).toBe("新标题");
    expect(mark.date).toBe("2026-08-15");
  });

  it("deleteCourse：仅匹配被删课程任务的 legacy mark，其他课程同日不同标题 mark 保留", () => {
    // c_1 与 c_6 各有一个同日 legacy mark（标题不同，可区分归属）
    useAppStore.setState((s) => ({
      assignments: [
        ...s.assignments,
        mkAssignment({ id: "a_X", title: "微观经济学论文", ddl: "2026-08-10T23:59:00", courseId: "c_1" }),
        mkAssignment({ id: "a_Y", title: "高数作业", ddl: "2026-08-10T23:59:00", courseId: "c_6" }),
      ],
      calendarMarks: [
        ...s.calendarMarks,
        mkMark({ id: "cm_X", title: "微观经济学论文", date: "2026-08-10" }),
        mkMark({ id: "cm_Y", title: "高数作业", date: "2026-08-10" }),
      ],
    }));
    useAppStore.getState().deleteCourse("c_1");
    const after = useAppStore.getState();
    expect(after.calendarMarks.find((m) => m.id === "cm_X")).toBeUndefined(); // 被删课程任务的 legacy mark
    expect(after.calendarMarks.find((m) => m.id === "cm_Y")).toBeTruthy(); // 其他课程同日 mark 保留
  });
});
