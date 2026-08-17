import { describe, it, expect, beforeEach, vi } from "vitest";
import { Course, CourseSchedule, Semester } from "@/types";
import {
  buildCourseCreatedEvent,
  buildCourseDeletedEvent,
  buildCourseUpdatedEvent,
  buildScheduleCreatedEvent,
  buildScheduleDeletedEvent,
  buildScheduleUpdatedEvent,
  buildSemesterUpdatedEvent,
} from "@/lib/history/courseScheduleEvents";
import { resolveLearningMutationContext, flushLearningHistoryQueue } from "@/lib/history/recorder";
import { clearLearningHistoryStorage } from "@/lib/history/store";

const SEMESTER = { id: "sem1", name: "测试学期", startDate: "2026-08-10", totalWeeks: 16 };
const ENV = { semester: SEMESTER };
const CTX = resolveLearningMutationContext({ source: "manual" });

function mkCourse(patch: Partial<Course>): Course {
  return {
    id: "c1",
    name: "统计学",
    code: "STAT101",
    teacher: "张老师",
    classroom: "A101",
    credit: 3,
    bgHex: "#E3E6E0",
    borderHex: "#D0D5CC",
    textHex: "#313032",
    description: "",
    materials: [],
    ...patch,
  } as Course;
}

function mkSchedule(patch: Partial<CourseSchedule>): CourseSchedule {
  return {
    id: "s1",
    courseId: "c1",
    dayOfWeek: 1,
    startTime: "08:00",
    endTime: "09:40",
    location: "A101",
    weeks: "1-16周",
    ...patch,
  } as CourseSchedule;
}

beforeEach(async () => {
  await clearLearningHistoryStorage();
});

describe("Course / Schedule History Events", () => {
  it("course.created：name/code/credit", () => {
    const event = buildCourseCreatedEvent({ course: mkCourse({}), context: CTX, environment: ENV });
    expect(event.type).toBe("course.created");
    expect((event as { data: { name: string; code: string; credit: number } }).data).toEqual({
      name: "统计学",
      code: "STAT101",
      credit: 3,
    });
  });

  it("course.updated：只记录 name/code/teacher/classroom/credit；description 变化不记录；no-op → null", () => {
    const changed = buildCourseUpdatedEvent({
      before: mkCourse({}),
      after: mkCourse({ name: "高级统计学", teacher: "李老师" }),
      context: CTX,
      environment: ENV,
    });
    expect(changed).not.toBeNull();
    expect((changed as { data: { before: object; after: object } }).data).toEqual({
      before: { name: "统计学", teacher: "张老师" },
      after: { name: "高级统计学", teacher: "李老师" },
    });
    const descOnly = buildCourseUpdatedEvent({
      before: mkCourse({}),
      after: mkCourse({ description: "新描述" }),
      context: CTX,
      environment: ENV,
    });
    expect(descOnly).toBeNull();
    const noop = buildCourseUpdatedEvent({
      before: mkCourse({}),
      after: mkCourse({}),
      context: CTX,
      environment: ENV,
    });
    expect(noop).toBeNull();
  });

  it("course.deleted：name/code/credit", () => {
    const event = buildCourseDeletedEvent({ course: mkCourse({}), context: CTX, environment: ENV });
    expect(event.type).toBe("course.deleted");
  });

  it("schedule.created/updated/deleted：payload 含 dayOfWeek/startTime/endTime/location/weeks/excludedWeeks", () => {
    const created = buildScheduleCreatedEvent({ schedule: mkSchedule({}), context: CTX, environment: ENV });
    expect((created as { data: { dayOfWeek: number; startTime: string } }).data).toMatchObject({
      dayOfWeek: 1,
      startTime: "08:00",
      location: "A101",
    });
    const updated = buildScheduleUpdatedEvent({
      schedule: mkSchedule({ excludedWeeks: [5] }),
      context: CTX,
      environment: ENV,
    });
    expect((updated as { data: { excludedWeeks: number[] } }).data.excludedWeeks).toEqual([5]);
    const deleted = buildScheduleDeletedEvent({ schedule: mkSchedule({}), context: CTX, environment: ENV });
    expect(deleted.type).toBe("schedule.deleted");
  });

  it("schedule.created restored=true（restoreSchedule）", () => {
    const event = buildScheduleCreatedEvent({
      schedule: mkSchedule({}),
      context: CTX,
      environment: ENV,
      restored: true,
    });
    expect((event as { data: { restored?: boolean } }).data.restored).toBe(true);
  });

  it("semester.updated：实际变化记录 before/after；完全相同不记录", () => {
    const changed = buildSemesterUpdatedEvent({
      before: SEMESTER,
      after: { ...SEMESTER, totalWeeks: 20 },
      context: CTX,
      environment: ENV,
    });
    expect(changed).not.toBeNull();
    expect((changed as { data: { before: Semester; after: Semester } }).data.after.totalWeeks).toBe(20);
    const noop = buildSemesterUpdatedEvent({
      before: SEMESTER,
      after: { ...SEMESTER },
      context: CTX,
      environment: ENV,
    });
    expect(noop).toBeNull();
  });
});

const KEY = "classflow-storage-v2";

function seedState() {
  const state = {
    userProfile: { name: "测试", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
    semester: { id: "s", name: "测试学期", startDate: "2026-08-10", totalWeeks: 16 },
    courses: [],
    schedules: [],
    assignments: [],
    calendarMarks: [],
    groupProjects: [],
    studyBlocks: [],
    assignmentTimeSlice: "all",
    preferences: {
      showWeekends: true, ddlWarningDays: 3, defaultDDLTime: "23:59",
      enableScheduleDirectManipulation: true, enableDDLDirectManipulation: true, motionPreference: "system",
      startupView: "overview", defaultTaskPriority: "medium", defaultTaskStatus: "todo",
      enableSingleKeyShortcuts: true, contentDensity: "comfortable",
      defaultTaskWorkspaceView: "focus", defaultDeadlineReminderMinutes: 1440,
    },
    reminders: [],
    focusSessions: [],
  };
  localStorage.setItem(KEY, JSON.stringify({ version: 6, state }));
}

async function freshStore() {
  vi.resetModules();
  const mod = await import("@/store/useAppStore");
  return mod.useAppStore;
}

async function readEventTypes(): Promise<string[]> {
  const db = await import("@/lib/history/store").then((m) => m.openLearningHistoryDB());
  const events = await new Promise<{ type: string }[]>((resolve, reject) => {
    const tx = db.transaction("events", "readonly");
    const req = tx.objectStore("events").index("occurredAt").getAll();
    req.onsuccess = () => resolve(req.result as { type: string }[]);
    req.onerror = () => reject(req.error);
  });
  return events.map((e) => e.type);
}

describe("Course / Schedule Store Integration", () => {
  it("addCourseWithSchedule → course.created + schedule.created；updateCourse → updated；deleteCourse cascade → course/schedule/assignment/study_block deleted", async () => {
    seedState();
    const store = await freshStore();
    // 准备 cascade 材料：course + schedule + assignment + study block
    const courseId = store.getState().addCourseWithSchedule(
      { name: "统计学", code: "STAT101", teacher: "张", classroom: "A101", credit: 3, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "" },
      [{ dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "A101", weeks: "1-16周" }]
    );
    const assignmentId = store.getState().addAssignment({
      courseId, title: "作业", description: "", priority: "medium", status: "todo", progress: 0, tags: [],
    });
    store.getState().addStudyBlock({ title: "学习", date: "2026-08-15", startTime: "10:00", endTime: "11:00", courseId });
    const course = store.getState().courses.find((c: Course) => c.id === courseId)!;
    store.getState().updateCourse({ ...course, name: "高级统计学" });
    store.getState().deleteCourse(courseId);
    await (await import("@/lib/history/recorder")).flushLearningHistoryQueue();
    const types = await readEventTypes();
    expect(types).toContain("course.created");
    expect(types).toContain("schedule.created");
    expect(types).toContain("course.updated");
    expect(types.filter((t) => t === "course.deleted")).toHaveLength(1);
    expect(types.filter((t) => t === "schedule.deleted")).toHaveLength(1);
    expect(types.filter((t) => t === "assignment.deleted")).toHaveLength(1);
    expect(types.filter((t) => t === "study_block.deleted")).toHaveLength(1);
  });

  it("excludeWeekFromSchedule → schedule.updated；importSchedules → source=import course/schedule created", async () => {
    seedState();
    const store = await freshStore();
    const scheduleId = store.getState().addScheduleSlot({ courseId: "c1", dayOfWeek: 2, startTime: "10:00", endTime: "11:40", location: "B201", weeks: "1-8周" });
    store.getState().excludeWeekFromSchedule(scheduleId, 5);
    store.getState().importSchedules(
      [
        { id: "c-imp", name: "导入课", code: "IMP1", teacher: "", classroom: "", credit: 2, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [] },
      ],
      [{ id: "s-imp", courseId: "c-imp", dayOfWeek: 3, startTime: "14:00", endTime: "15:40", location: "C", weeks: "1-16周" }]
    );
    await (await import("@/lib/history/recorder")).flushLearningHistoryQueue();
    const db = await import("@/lib/history/store").then((m) => m.openLearningHistoryDB());
    const events = await new Promise<{ type: string; source: string }[]>((resolve, reject) => {
      const tx = db.transaction("events", "readonly");
      const req = tx.objectStore("events").index("occurredAt").getAll();
      req.onsuccess = () => resolve(req.result as { type: string; source: string }[]);
      req.onerror = () => reject(req.error);
    });
    expect(events.filter((e) => e.type === "schedule.updated")).toHaveLength(1);
    const imported = events.filter((e) => e.type === "course.created" && e.source === "import");
    expect(imported).toHaveLength(1);
    expect(events.filter((e) => e.type === "schedule.created" && e.source === "import")).toHaveLength(1);
  });

  it("setSemester 变化 → semester.updated；相同 → 不记录", async () => {
    seedState();
    const store = await freshStore();
    store.getState().setSemester({ id: "s", name: "新学期", startDate: "2026-09-01", totalWeeks: 20 });
    const same = store.getState().semester;
    store.getState().setSemester({ ...same });
    await (await import("@/lib/history/recorder")).flushLearningHistoryQueue();
    const types = await readEventTypes();
    expect(types.filter((t) => t === "semester.updated")).toHaveLength(1);
  });

  it("restoreSchedule → schedule.created restored=true", async () => {
    seedState();
    const store = await freshStore();
    const scheduleId = store.getState().addScheduleSlot({ courseId: "c1", dayOfWeek: 2, startTime: "10:00", endTime: "11:40", location: "B201", weeks: "1-8周" });
    store.getState().deleteSchedule(scheduleId);
    const target = { id: scheduleId, courseId: "c1", dayOfWeek: 2, startTime: "10:00", endTime: "11:40", location: "B201", weeks: "1-8周" };
    store.getState().restoreSchedule(target);
    await (await import("@/lib/history/recorder")).flushLearningHistoryQueue();
    const db = await import("@/lib/history/store").then((m) => m.openLearningHistoryDB());
    const events = await new Promise<{ type: string; entityId: string; data: { restored?: boolean }; sequence: number }[]>((resolve, reject) => {
      const tx = db.transaction("events", "readonly");
      const req = tx.objectStore("events").index("occurredAt").getAll();
      req.onsuccess = () => resolve(req.result as { type: string; entityId: string; data: { restored?: boolean }; sequence: number }[]);
      req.onerror = () => reject(req.error);
    });
    // 只按本 schedule 的 entityId 过滤（避免与其他并行测试共享 DB 的全局 count 竞态）
    const created = events
      .filter((e) => e.type === "schedule.created" && e.entityId === scheduleId)
      .sort((a, b) => a.sequence - b.sequence);
    expect(created).toHaveLength(2);
    expect(created[1].data.restored).toBe(true);
  });
});
