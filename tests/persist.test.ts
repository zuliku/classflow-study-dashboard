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
    expect(raw.version).toBe(8); // 当前 persist schema version（v7 typography / v8 bell schedule）
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

  it("首次启动（无任何存储数据）：保持 First Run 空状态，不被 merge 覆盖", async () => {
    // localStorage 为空 → zustand 仍会调用 merge(undefined)，
    // 必须原样保留 initial state（生产 First Run = 空工作区），不能把 undefined 清洗成数组
    const store = await freshStore();
    const s = store.getState();
    expect(s.courses).toHaveLength(0);
    expect(s.schedules).toHaveLength(0);
    expect(s.assignments).toHaveLength(0);
    expect(s.calendarMarks).toHaveLength(0);
    expect(s.userProfile.name).toBe("");
    expect(s.selectedCourseId).toBeNull();
    expect(s.activeTab).toBe("overview");
  });

  it("完整旧用户升级：activeTab/选中项/Modal/冲突全部复位到干净初始态", async () => {
    seedV0({
      state: {
        ...v0Payload,
        activeTab: "assignments",
        selectedConflict: { scheduleA: { id: "s1" }, scheduleB: { id: "s2" }, dayOfWeek: 1, timeRange: "08:00-09:40" },
      },
    });

    const store = await freshStore();
    const s = store.getState();
    // 业务数据完整
    expect(s.assignments.map((a) => a.id)).toEqual(["a_keep_1"]);
    expect(s.calendarMarks.map((m) => m.id)).toEqual(["cm_keep_1"]);
    expect(s.semester.totalWeeks).toBe(16);
    // 进入 overview，无选中实体，全部 overlay 关闭
    expect(s.activeTab).toBe("overview");
    expect(s.selectedCourseId).toBeNull();
    expect(s.selectedAssignmentId).toBeNull();
    expect(s.selectedConflict).toBeNull();
    expect(s.isSearchModalOpen).toBe(false);
    expect(s.isAddCourseModalOpen).toBe(false);
    expect(s.isImportScheduleModalOpen).toBe(false);
    expect(s.isConflictModalOpen).toBe(false);
    expect(s.isFullTimetableModalOpen).toBe(false);
  });

  it("v1 round trip：业务数据一致，UI 状态重置", async () => {
    seedV0({
      version: 1,
      state: {
        userProfile: v0Payload.userProfile,
        semester: v0Payload.semester,
        courses: v0Payload.courses,
        schedules: v0Payload.schedules,
        assignments: v0Payload.assignments,
        calendarMarks: [{ ...v0Payload.calendarMarks[0], sourceId: "a_keep_1" }],
        groupProjects: v0Payload.groupProjects,
        assignmentTimeSlice: "7days",
      },
    });

    const store = await freshStore();
    const s = store.getState();
    expect(s.courses).toEqual(v0Payload.courses);
    expect(s.schedules).toEqual(v0Payload.schedules);
    expect(s.assignments).toEqual(v0Payload.assignments);
    expect(s.calendarMarks).toEqual([{ ...v0Payload.calendarMarks[0], sourceId: "a_keep_1" }]);
    expect(s.semester).toEqual(v0Payload.semester);
    expect(s.userProfile).toEqual(v0Payload.userProfile);
    expect(s.assignmentTimeSlice).toBe("7days");
    // UI 状态重置
    expect(s.selectedCourseId).toBeNull();
    expect(s.isSearchModalOpen).toBe(false);
  });

  it("异常形状（state=null / state=字符串 / version=字符串）不崩溃，回落默认", async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: null, version: 0 }));
    let store = await freshStore();
    expect(Array.isArray(store.getState().courses)).toBe(true);

    localStorage.setItem(KEY, JSON.stringify({ state: "garbage", version: 0 }));
    store = await freshStore();
    expect(store.getState().selectedCourseId).toBeNull();

    localStorage.setItem(KEY, JSON.stringify({ state: { courses: v0Payload.courses }, version: "1" }));
    store = await freshStore();
    expect(store.getState().courses.map((c) => c.id)).toEqual(["c_keep_1"]);
    expect(store.getState().selectedCourseId).toBeNull();
  });
});

// ============================================================
// Hydration 失败门禁（稳定性审计 BUG-006 回归）：
// localStorage 损坏 → zustand 静默吞错、Store 留在空态。
// didMainStoreHydrationFail() 必须如实报告，供启动 Blob 对账 fail-closed。
// ============================================================
describe("persist hydration failure gate", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  async function freshModule() {
    vi.resetModules();
    return import("@/store/useAppStore");
  }

  it("损坏 JSON → hydration failed = true（Store 空态但 GC 门禁关闭）", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(KEY, "{{{ not json");
    const mod = await freshModule();
    expect(mod.didMainStoreHydrationFail()).toBe(true);
    // 显式诊断输出（不再无声丢失）
    expect(errSpy.mock.calls.some((args) => String(args[0]).includes("rehydration failed"))).toBe(true);
  });

  it("健康数据 / 空 storage → hydration failed = false", async () => {
    seedV0({ state: v0Payload });
    let mod = await freshModule();
    expect(mod.didMainStoreHydrationFail()).toBe(false);

    localStorage.clear();
    mod = await freshModule();
    expect(mod.didMainStoreHydrationFail()).toBe(false);
  });

  it("page.tsx 启动对账消费该门禁：reconcile 前检查 hydration 失败", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(process.cwd(), "app/page.tsx"), "utf-8");
    expect(src).toContain("didMainStoreHydrationFail");
    // fail-closed：门禁为 true 时直接 return，不执行 reconcile
    expect(src).toMatch(/if \(didMainStoreHydrationFail\(\)\) return;/);
  });
});

// ============================================================
// Hydration sanitize 加固（稳定性审计 BUG-007 回归）：
// 1) status / priority 枚举白名单（垃圾值 → 默认值，不再透传）
// 2) deleteCourse 对缺 materials 数组的部分持久化数据不再 TypeError
// ============================================================
describe("hydration sanitization hardening", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  async function freshModule() {
    vi.resetModules();
    return import("@/store/useAppStore");
  }

  it("垃圾 status/priority → 回落 todo/medium（不进入业务态）", async () => {
    localStorage.setItem(KEY, JSON.stringify({
      state: {
        semester: v0Payload.semester,
        assignments: [
          { id: "a_bad", courseId: "", title: "坏数据任务", description: "", priority: 123, status: "banana", progress: 0, tags: [] },
          { id: "a_ok", courseId: "", title: "好数据任务", description: "", priority: "high", status: "doing", progress: 0, tags: [] },
        ],
      },
      version: 8,
    }));
    const mod = await freshModule();
    const s = mod.useAppStore.getState();
    const bad = s.assignments.find((a) => a.id === "a_bad")!;
    expect(bad.status).toBe("todo");
    expect(bad.priority).toBe("medium");
    const ok = s.assignments.find((a) => a.id === "a_ok")!;
    expect(ok.status).toBe("doing");
    expect(ok.priority).toBe("high");
  });

  it("course 缺 materials 数组 → deleteCourse 不抛错且级联完成", async () => {
    localStorage.setItem(KEY, JSON.stringify({
      state: {
        semester: v0Payload.semester,
        // 故意缺 materials 字段（cast-only hydration 的历史风险形状）
        courses: [{ id: "c_fragile", name: "脆弱课程", code: "F-01" }],
        schedules: [{ id: "s_f", courseId: "c_fragile", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "", weeks: "1-16周" }],
        assignments: [{ id: "a_fragile", courseId: "c_fragile", title: "脆弱任务", description: "", ddl: "2026-09-01T23:59:00", priority: "medium", status: "todo", progress: 0, tags: [] }],
      },
      version: 8,
    }));
    const mod = await freshModule();
    expect(() => mod.useAppStore.getState().deleteCourse("c_fragile")).not.toThrow();
    const s = mod.useAppStore.getState();
    expect(s.courses.find((c) => c.id === "c_fragile")).toBeUndefined();
    expect(s.assignments.find((a) => a.id === "a_fragile")).toBeUndefined();
    expect(s.schedules.find((x) => x.id === "s_f")).toBeUndefined();
  });
});
