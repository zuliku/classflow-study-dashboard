import { describe, it, expect, vi, beforeEach } from "vitest";
import { Assignment } from "@/types";

/**
 * Task 7F：completion-driven recurrence Store 行为（真实 Store，seed localStorage）。
 */

const KEY = "classflow-storage-v2";

function dayOffset(offset: number, hour = 23, minute = 59): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(hour)}:${p(minute)}:00`;
}

function seedState() {
  const state = {
    userProfile: { name: "测试", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
    semester: { id: "s", name: "测试学期", startDate: "2026-01-01", totalWeeks: 16 },
    courses: [{ id: "c1", name: "统计学", code: "STAT", teacher: "", classroom: "", credit: 3, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [] }],
    schedules: [],
    assignments: [
      { id: "a-recur", courseId: "c1", title: "每周作业", description: "", ddl: dayOffset(0), priority: "medium", status: "todo", progress: 0, tags: [], recurrence: "weekly", recurrenceSeriesId: "rs_1", subtasks: [{ id: "st1", title: "步骤一", completed: true }] },
      { id: "a-plain", courseId: "c1", title: "普通任务", description: "", ddl: dayOffset(1), priority: "medium", status: "todo", progress: 0, tags: [] },
    ],
    calendarMarks: [
      { id: "cm1", date: dayOffset(0).slice(0, 10), type: "ddl", title: "每周作业", sourceId: "a-recur" },
      { id: "cm2", date: dayOffset(1).slice(0, 10), type: "ddl", title: "普通任务", sourceId: "a-plain" },
    ],
    groupProjects: [],
    studyBlocks: [],
    assignmentTimeSlice: "all",
    preferences: {
      showWeekends: true, ddlWarningDays: 3, defaultDDLTime: "23:59",
      enableScheduleDirectManipulation: true, enableDDLDirectManipulation: true, motionPreference: "system",
      startupView: "overview", defaultTaskPriority: "medium", defaultTaskStatus: "todo",
      enableSingleKeyShortcuts: true, contentDensity: "comfortable",
    },
  };
  localStorage.setItem(KEY, JSON.stringify({ version: 4, state }));
}

async function freshStore() {
  vi.resetModules();
  const mod = await import("@/store/useAppStore");
  return mod.useAppStore;
}

beforeEach(() => {
  localStorage.clear();
});

describe("completion-driven recurrence（Store）", () => {
  it("完成每周任务 → 生成下一次（+7d / todo / progress 0 / subtasks 重置 / series 继承 / 唯一 mark）", async () => {
    seedState();
    const store = await freshStore();
    const before = store.getState().assignments.length;

    store.getState().updateAssignmentStatus("a-recur", "completed");

    const s = store.getState();
    expect(s.assignments).toHaveLength(before + 1);
    expect(s.assignments.find((a: Assignment) => a.id === "a-recur")!.status).toBe("completed");

    const child = s.assignments.find((a: Assignment) => a.recurrenceParentId === "a-recur")!;
    expect(child).toBeTruthy();
    expect(child.ddl).toBe(dayOffset(7));
    expect(child.status).toBe("todo");
    expect(child.progress).toBe(0);
    expect(child.recurrence).toBe("weekly");
    expect(child.recurrenceSeriesId).toBe("rs_1");
    expect(child.subtasks!.map((st) => st.title)).toEqual(["步骤一"]);
    expect(child.subtasks!.every((st) => st.completed === false)).toBe(true);
    expect(child.subtasks![0].id).not.toBe("st1");

    // child 对应唯一 DDL CalendarMark
    const marks = s.calendarMarks.filter((m: any) => m.sourceId === child.id && m.type === "ddl");
    expect(marks).toHaveLength(1);
    expect(marks[0].date).toBe(dayOffset(7).slice(0, 10));
  });

  it("幂等：重复完成同一任务不生成第二个 child", async () => {
    seedState();
    const store = await freshStore();
    store.getState().updateAssignmentStatus("a-recur", "completed");
    const count1 = store.getState().assignments.filter((a: Assignment) => a.recurrenceParentId === "a-recur").length;
    // 重新打开 → 再完成
    store.getState().updateAssignmentStatus("a-recur", "doing");
    store.getState().updateAssignmentStatus("a-recur", "completed");
    const count2 = store.getState().assignments.filter((a: Assignment) => a.recurrenceParentId === "a-recur").length;
    expect(count1).toBe(1);
    expect(count2).toBe(1);
  });

  it("链式：完成 child → 生成 next（parent = child.id）", async () => {
    seedState();
    const store = await freshStore();
    store.getState().updateAssignmentStatus("a-recur", "completed");
    const child = store.getState().assignments.find((a: Assignment) => a.recurrenceParentId === "a-recur")!;
    store.getState().updateAssignmentStatus(child.id, "completed");
    const next = store.getState().assignments.find((a: Assignment) => a.recurrenceParentId === child.id)!;
    expect(next).toBeTruthy();
    expect(next.ddl).toBe(dayOffset(14));
    expect(next.recurrenceSeriesId).toBe("rs_1");
  });

  it("普通任务完成 → 不生成任何新任务", async () => {
    seedState();
    const store = await freshStore();
    const before = store.getState().assignments.length;
    store.getState().updateAssignmentStatus("a-plain", "completed");
    expect(store.getState().assignments).toHaveLength(before);
  });

  it("updateAssignmentPatch(status completed)（Kiro update_assignment 路径）同样 spawn", async () => {
    seedState();
    const store = await freshStore();
    const before = store.getState().assignments.length;
    store.getState().updateAssignmentPatch("a-recur", { status: "completed" });
    expect(store.getState().assignments).toHaveLength(before + 1);
    expect(store.getState().assignments.some((a: Assignment) => a.recurrenceParentId === "a-recur")).toBe(true);
  });

  it("无 DDL 的 recurrence 被 normalize 清洗 → 完成不 spawn", async () => {
    seedState();
    const store = await freshStore();
    // 手动构造非法组合（无 DDL + weekly）→ normalize 清洗
    const s = store.getState();
    s.addAssignment({ courseId: "c1", title: "非法重复", description: "", priority: "medium", status: "todo", progress: 0, tags: [], recurrence: "weekly" as Assignment["recurrence"] });
    const bad = store.getState().assignments.find((a: Assignment) => a.title === "非法重复")!;
    expect(bad.recurrence).toBeUndefined();
    const before = store.getState().assignments.length;
    store.getState().updateAssignmentStatus(bad.id, "completed");
    expect(store.getState().assignments).toHaveLength(before);
  });

  it("完成时 child 的 materialIds 保留", async () => {
    seedState();
    const store = await freshStore();
    store.getState().setAssignmentMaterialIds("a-recur", ["m1"]);
    // c1 无 material → 清洗后为空；补一个 material 再验证
    store.getState().addCourseMaterial("c1", { title: "讲义.pdf", type: "pdf", size: "1 MB" });
    const m = store.getState().courses[0].materials[0];
    store.getState().setAssignmentMaterialIds("a-recur", [m.id]);
    store.getState().updateAssignmentStatus("a-recur", "completed");
    const child = store.getState().assignments.find((a: Assignment) => a.recurrenceParentId === "a-recur")!;
    expect(child.materialIds).toEqual([m.id]);
  });
});
