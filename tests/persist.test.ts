import { describe, it, expect, beforeEach, vi } from "vitest";

const KEY = "classflow-storage-v2";

function seedV0(payload: unknown) {
  localStorage.setItem(KEY, JSON.stringify(payload));
}

const v0Payload = {
  userProfile: { name: "旧用户", avatarUrl: "", college: "经管学院", grade: "大三", studentId: "2022001", completedCredits: 10, totalCredits: 20 },
  semester: { id: "sem_old", name: "旧学期", startDate: "2026-02-23", totalWeeks: 16 },
  courses: [{ id: "c_keep_1", name: "保留课程", code: "K-01", teacher: "老师", classroom: "教一", credit: 3, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [] }],
  schedules: [{ id: "s_keep_1", courseId: "c_keep_1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "教一", weeks: "1-16周" }],
  assignments: [{ id: "a_keep_1", courseId: "c_keep_1", title: "保留任务", description: "", ddl: "2026-08-10T23:59:00", priority: "medium", status: "todo", progress: 0, tags: [] }],
  calendarMarks: [{ id: "cm_keep_1", date: "2026-08-10", type: "ddl", title: "保留任务" }],
  groupProjects: [],
  // 历史遗留瞬时 UI 状态（迁移后必须被忽略）
  selectedCourseId: "c_keep_1",
  selectedAssignmentId: "a_keep_1",
  isSearchModalOpen: true,
  isAddCourseModalOpen: true,
  isImportScheduleModalOpen: true,
  isConflictModalOpen: true,
  isFullTimetableModalOpen: true,
  selectedConflict: { scheduleA: {}, scheduleB: {}, dayOfWeek: 1, timeRange: "08:00-09:40" },
  currentSemesterWeek: 99,
};

describe("Zustand persist 边界与迁移", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  async function freshStore() {
    vi.resetModules();
    const mod = await import("@/store/useAppStore");
    return mod.useAppStore;
  }

  it("v0 迁移：业务数据保留且 ID 不变，瞬时 UI 状态被清理，周次被 clamp", async () => {
    seedV0({ version: 0, state: v0Payload });

    const store = await freshStore();
    const s = store.getState();

    // 业务数据保留，ID 不变
    expect(s.courses.map((c) => c.id)).toEqual(["c_keep_1"]);
    expect(s.schedules.map((x) => x.id)).toEqual(["s_keep_1"]);
    expect(s.assignments.map((x) => x.id)).toEqual(["a_keep_1"]);
    expect(s.calendarMarks.map((x) => x.id)).toEqual(["cm_keep_1"]);
    expect(s.semester.startDate).toBe("2026-02-23");
    expect(s.userProfile.name).toBe("旧用户");

    // 瞬时 UI 状态必须干净
    expect(s.selectedCourseId).toBeNull();
    expect(s.selectedAssignmentId).toBeNull();
    expect(s.selectedConflict).toBeNull();
    expect(s.isSearchModalOpen).toBe(false);
    expect(s.isAddCourseModalOpen).toBe(false);
    expect(s.isImportScheduleModalOpen).toBe(false);
    expect(s.isConflictModalOpen).toBe(false);
    expect(s.isFullTimetableModalOpen).toBe(false);

    // 周次：不持久化历史值（99），启动按真实日期计算并 clamp
    expect(s.currentSemesterWeek).toBeGreaterThanOrEqual(1);
    expect(s.currentSemesterWeek).toBeLessThanOrEqual(s.semester.totalWeeks);
    expect(s.currentSemesterWeek).not.toBe(99);
  });

  it("缺失可选字段（assignmentTimeSlice）仍正常，回落 all", async () => {
    seedV0({ state: { courses: v0Payload.courses, schedules: [], assignments: [], calendarMarks: [], groupProjects: [], semester: v0Payload.semester, userProfile: v0Payload.userProfile } });

    const store = await freshStore();
    const s = store.getState();
    expect(s.assignments).toHaveLength(0);
    expect(s.assignmentTimeSlice).toBe("all");
    expect(s.courses.map((c) => c.id)).toEqual(["c_keep_1"]);
  });

  it("无 version 键的旧数据（真实历史场景）：merge 兜底同样清理 UI 状态", async () => {
    seedV0({ state: v0Payload });

    const store = await freshStore();
    const s = store.getState();
    expect(s.courses.map((c) => c.id)).toEqual(["c_keep_1"]);
    expect(s.selectedCourseId).toBeNull();
    expect(s.isFullTimetableModalOpen).toBe(false);
    expect(s.selectedConflict).toBeNull();
  });

  it("迁移后持久化写入走白名单：临时 UI 状态不会进入 localStorage", async () => {
    seedV0({ state: v0Payload });

    const store = await freshStore();
    // 触发一次 set，persist 应只写白名单字段
    store.setState({ isSearchModalOpen: true, selectedCourseId: "x" });
    await new Promise((r) => setTimeout(r, 0));

    const raw = JSON.parse(localStorage.getItem(KEY)!);
    const saved = raw.state;
    expect(saved.isSearchModalOpen).toBeUndefined();
    expect(saved.selectedCourseId).toBeUndefined();
    expect(saved.selectedConflict).toBeUndefined();
    expect(saved.courses).toHaveLength(1);
    expect(saved.assignmentTimeSlice).toBe("all");
    expect(raw.version).toBe(1);
  });

  it("核心数组缺失时回落空数组，不崩溃", async () => {
    seedV0({ state: { userProfile: v0Payload.userProfile, semester: v0Payload.semester } });

    const store = await freshStore();
    const s = store.getState();
    expect(s.courses).toEqual([]);
    expect(s.schedules).toEqual([]);
    expect(s.assignments).toEqual([]);
    expect(s.calendarMarks).toEqual([]);
    expect(s.groupProjects).toEqual([]);
    expect(s.semester.totalWeeks).toBe(16);
  });

  it("空/损坏数据不导致启动崩溃", async () => {
    localStorage.setItem(KEY, "{{{ not json");
    const store = await freshStore();
    const s = store.getState();
    expect(Array.isArray(s.courses)).toBe(true);
    expect(s.selectedCourseId).toBeNull();
  });
});
