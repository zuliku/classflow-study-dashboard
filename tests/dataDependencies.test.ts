import { describe, it, expect } from "vitest";
import { Assignment, CalendarMark, Course, CourseSchedule, GroupProject, Reminder, StudyBlock } from "@/types";
import {
  collectAssignmentDeleteSnapshot,
  collectCourseDeleteCascade,
  removeAssignmentDeleteSnapshot,
  removeCourseDeleteCascade,
  restoreAssignmentDeleteSnapshot,
  DependencyCollections,
} from "@/lib/dataDependencies";

const NOW = "2026-08-10T12:00:00";

function mkAssignment(id: string, courseId = "c1", patch: Partial<Assignment> = {}): Assignment {
  return { id, courseId, title: id, description: "", priority: "medium", status: "todo", progress: 0, tags: [], ...patch };
}
function mkMark(id: string, patch: Partial<CalendarMark> = {}): CalendarMark {
  return { id, date: "2026-08-15", type: "ddl", title: id, ...patch };
}
function mkBlock(id: string, patch: Partial<StudyBlock> = {}): StudyBlock {
  return { id, title: id, date: "2026-08-15", startTime: "19:00", endTime: "20:00", ...patch };
}
function mkReminder(id: string, patch: Partial<Reminder>): Reminder {
  return { id, title: id, targetType: "assignment", targetId: "a1", timingMode: "absolute", triggerAt: NOW, status: "scheduled", source: "manual", createdAt: NOW, updatedAt: NOW, ...patch };
}
function mkCourse(id: string): Course {
  return { id, name: id, code: id, teacher: "", classroom: "", credit: 3, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [] };
}

function baseState(): DependencyCollections {
  return {
    courses: [mkCourse("c1"), mkCourse("c2")],
    schedules: [],
    assignments: [mkAssignment("a1"), mkAssignment("a2", "c2")],
    calendarMarks: [mkMark("m1", { sourceId: "a1" }), mkMark("m2", { sourceId: "a2" }), mkMark("exam", { type: "exam" })],
    groupProjects: [],
    studyBlocks: [mkBlock("b1", { assignmentId: "a1" }), mkBlock("b2", { courseId: "c1" }), mkBlock("b3", { courseId: "c2" })],
    reminders: [],
  };
}

describe("collectAssignmentDeleteSnapshot / remove / restore", () => {
  it("1. Assignment snapshot：Assignment + DDL mark + StudyBlock", () => {
    const state = baseState();
    const s = collectAssignmentDeleteSnapshot(state, "a1")!;
    expect(s.assignment.id).toBe("a1");
    expect(s.calendarMarks.map((m) => m.id)).toEqual(["m1"]);
    expect(s.studyBlocks.map((b) => b.id)).toEqual(["b1"]);
  });

  it("2/3/4. 三类 Reminder 全部进入 snapshot", () => {
    const state = baseState();
    state.reminders = [
      mkReminder("r-assign", { targetType: "assignment", targetId: "a1" }),
      mkReminder("r-block", { targetType: "studyBlock", targetId: "b1" }),
      mkReminder("r-mark", { targetType: "calendarMark", targetId: "m1" }),
    ];
    const s = collectAssignmentDeleteSnapshot(state, "a1")!;
    expect(s.reminders.map((r) => r.id).sort()).toEqual(["r-assign", "r-block", "r-mark"]);
  });

  it("5. Standalone / unrelated Reminder 不进入 snapshot", () => {
    const state = baseState();
    state.reminders = [
      mkReminder("standalone", { targetType: "standalone", targetId: undefined }),
      mkReminder("other-assign", { targetType: "assignment", targetId: "a2" }),
      mkReminder("other-block", { targetType: "studyBlock", targetId: "b3" }),
    ];
    const s = collectAssignmentDeleteSnapshot(state, "a1")!;
    expect(s.reminders).toHaveLength(0);
  });

  it("remove 按 ID 过滤不 mutate 输入；restore 原样插回且幂等", () => {
    const state = baseState();
    const s = collectAssignmentDeleteSnapshot(state, "a1")!;
    const removed = removeAssignmentDeleteSnapshot(state, s);
    expect(removed.assignments.find((a) => a.id === "a1")).toBeUndefined();
    expect(removed.calendarMarks.find((m) => m.id === "m1")).toBeUndefined();
    expect(removed.studyBlocks.find((b) => b.id === "b1")).toBeUndefined();
    expect(state.assignments.find((a) => a.id === "a1")).toBeTruthy(); // 输入不被 mutate

    const restored = restoreAssignmentDeleteSnapshot({ ...state, ...removed }, s);
    expect(restored.assignments.find((a) => a.id === "a1")).toEqual(s.assignment);
    expect(restored.calendarMarks.find((m) => m.id === "m1")).toEqual(s.calendarMarks[0]);
    expect(restored.studyBlocks.find((b) => b.id === "b1")).toEqual(s.studyBlocks[0]);

    // 6. restore 幂等：调用两次不重复
    const again = restoreAssignmentDeleteSnapshot({ ...state, ...restored }, s);
    expect(again.assignments.filter((a) => a.id === "a1")).toHaveLength(1);
    expect(again.studyBlocks.filter((b) => b.id === "b1")).toHaveLength(1);
  });
});

describe("collectCourseDeleteCascade", () => {
  it("7. course cascade：schedule / assignment / groupProject / direct-course StudyBlock / assignment StudyBlock / affected reminders", () => {
    const state: DependencyCollections = {
      courses: [mkCourse("c1"), mkCourse("c2")],
      schedules: [{ id: "s1", courseId: "c1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "", weeks: "1-16周" }],
      assignments: [mkAssignment("a1", "c1"), mkAssignment("a2", "c2")],
      calendarMarks: [mkMark("m1", { sourceId: "a1" }), mkMark("m2", { sourceId: "a2" }), mkMark("exam", { type: "exam" })],
      groupProjects: [{ id: "gp1", courseId: "c1", title: "p", description: "", progress: 0, updatedAt: NOW, members: [], tasks: [] }],
      studyBlocks: [
        mkBlock("b-direct", { courseId: "c1" }),
        mkBlock("b-assign", { assignmentId: "a1" }),
        mkBlock("b-other", { courseId: "c2" }),
      ],
      reminders: [
        mkReminder("r-a", { targetType: "assignment", targetId: "a1" }),
        mkReminder("r-b", { targetType: "studyBlock", targetId: "b-assign" }),
        mkReminder("r-m", { targetType: "calendarMark", targetId: "m1" }),
        mkReminder("r-standalone", { targetType: "standalone", targetId: undefined }),
        mkReminder("r-other", { targetType: "assignment", targetId: "a2" }),
      ],
    };
    const c = collectCourseDeleteCascade(state, "c1")!;
    expect(c.course.id).toBe("c1");
    expect(c.schedules.map((s) => s.id)).toEqual(["s1"]);
    expect(c.assignments.map((a) => a.id)).toEqual(["a1"]);
    expect(c.groupProjects.map((gp) => gp.id)).toEqual(["gp1"]);
    expect(c.calendarMarks.map((m) => m.id)).toEqual(["m1"]); // exam 不动
    expect(c.studyBlocks.map((b) => b.id).sort()).toEqual(["b-assign", "b-direct"]);
    expect(c.reminders.map((r) => r.id).sort()).toEqual(["r-a", "r-b", "r-m"]); // standalone / other 不动

    const removed = removeCourseDeleteCascade(state, c);
    expect(removed.courses.find((x) => x.id === "c1")).toBeUndefined();
    expect(removed.reminders.find((r) => r.id === "r-standalone")).toBeTruthy();
    expect(removed.reminders.find((r) => r.id === "r-other")).toBeTruthy();
    expect(removed.studyBlocks.find((b) => b.id === "b-other")).toBeTruthy();
  });

  it("8. legacy DDL matcher 严格：same-title-wrong-date / same-date-wrong-title 不误删", () => {
    const state: DependencyCollections = {
      courses: [mkCourse("c1")],
      schedules: [],
      assignments: [mkAssignment("a1", "c1", { ddl: "2026-08-15T23:59:00", title: "同名作业" })],
      calendarMarks: [
        mkMark("m-legacy-right", { title: "同名作业", date: "2026-08-15" }), // title AND date 都匹配 → 属于 a1
        mkMark("m-wrong-date", { title: "同名作业", date: "2026-08-16" }),
        mkMark("m-wrong-title", { title: "其它作业", date: "2026-08-15" }),
        mkMark("exam", { type: "exam", title: "同名作业", date: "2026-08-15" }),
      ],
      groupProjects: [],
      studyBlocks: [],
      reminders: [],
    };
    const c = collectCourseDeleteCascade(state, "c1")!;
    expect(c.calendarMarks.map((m) => m.id)).toEqual(["m-legacy-right"]);
  });
});
