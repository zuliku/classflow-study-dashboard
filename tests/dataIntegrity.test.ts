import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore } from "@/store/useAppStore";
import { findDataIntegrityIssues } from "@/lib/dataIntegrity";
import { ClassFlowBackupData } from "@/types";

const KEY = "classflow-storage-v2";

function mkData(over: Partial<ClassFlowBackupData> = {}): ClassFlowBackupData {
  return {
    userProfile: { name: "张同学", avatarUrl: "", college: "经管学院", grade: "大三", studentId: "2022001", completedCredits: 10, totalCredits: 20 },
    semester: { id: "sem_bak", name: "备份学期", startDate: "2026-02-23", totalWeeks: 12 },
    courses: [
      { id: "c_1", name: "微观经济学", code: "ECON-201", teacher: "王教授", classroom: "教二", credit: 3, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [{ id: "m_1", title: "讲义.pdf", type: "pdf", size: "1 MB", uploadDate: "2026-08-01", storageKey: "file_1" }] },
    ],
    schedules: [{ id: "s_1", courseId: "c_1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "教二", weeks: "1-12周" }],
    assignments: [{ id: "a_1", courseId: "c_1", title: "习题", description: "", ddl: "2026-08-10T23:59:00", priority: "medium", status: "todo", progress: 0, tags: [] }],
    calendarMarks: [{ id: "cm_1", date: "2026-08-10", type: "ddl", title: "习题", sourceId: "a_1" }],
    groupProjects: [],
    ...over,
  };
}

async function freshStore() {
  vi.resetModules();
  const mod = await import("@/store/useAppStore");
  return mod.useAppStore;
}

describe("数据完整性回归", () => {
  beforeEach(() => {
    useAppStore.getState().resetAllDataToDefault();
    localStorage.clear();
  });

  it("backup restore 后数据进入 persist，重新加载仍然存在", async () => {
    const data = mkData();
    useAppStore.getState().restoreAppData(data);
    await new Promise((r) => setTimeout(r, 0));

    // persist 已写入（含学期/任务/标记）
    const raw = JSON.parse(localStorage.getItem(KEY)!);
    expect(raw.state.courses.map((c: any) => c.id)).toEqual(["c_1"]);
    expect(raw.state.semester.totalWeeks).toBe(12);

    // 模拟刷新：重新 hydrate
    const store = await freshStore();
    const s = store.getState();
    expect(s.courses).toEqual(data.courses);
    expect(s.schedules).toEqual(data.schedules);
    expect(s.assignments).toEqual(data.assignments);
    expect(s.calendarMarks).toEqual(data.calendarMarks);
    expect(s.semester).toEqual(data.semester);
    expect(s.userProfile).toEqual(data.userProfile);
    expect(s.selectedCourseId).toBeNull();
  });

  it("restore 后 currentSemesterWeek 按新学期 clamp（16 → ≤12）", () => {
    useAppStore.getState().setCurrentSemesterWeek(16);
    expect(useAppStore.getState().currentSemesterWeek).toBe(16);

    const data = mkData(); // totalWeeks = 12
    useAppStore.getState().restoreAppData(data);
    const week = useAppStore.getState().currentSemesterWeek;
    expect(week).toBeGreaterThanOrEqual(1);
    expect(week).toBeLessThanOrEqual(12);
  });

  it("reset 清理业务数据、UI 瞬时状态与筛选偏好，无需 reload", () => {
    // 制造脏状态
    useAppStore.setState({
      selectedCourseId: "c_1",
      selectedAssignmentId: "a_1",
      isSearchModalOpen: true,
      isAddCourseModalOpen: true,
      isImportScheduleModalOpen: true,
      isConflictModalOpen: true,
      isFullTimetableModalOpen: true,
      selectedConflict: { scheduleA: {} as any, scheduleB: {} as any, dayOfWeek: 1, timeRange: "x" },
      assignmentTimeSlice: "overdue",
    });

    useAppStore.getState().resetAllDataToDefault();
    const s = useAppStore.getState();
    // 业务数据回演示默认
    expect(s.courses).toHaveLength(6);
    expect(s.assignments).toHaveLength(6);
    expect(s.currentSemesterWeek).toBe(1);
    // 瞬时 UI 全部复位
    expect(s.selectedCourseId).toBeNull();
    expect(s.selectedAssignmentId).toBeNull();
    expect(s.selectedConflict).toBeNull();
    expect(s.isSearchModalOpen).toBe(false);
    expect(s.isAddCourseModalOpen).toBe(false);
    expect(s.isImportScheduleModalOpen).toBe(false);
    expect(s.isConflictModalOpen).toBe(false);
    expect(s.isFullTimetableModalOpen).toBe(false);
    expect(s.assignmentTimeSlice).toBe("all");
  });

  it("同一毫秒批量创建不产生 ID 冲突（course/schedule/material/assignment/mark）", () => {
    const store = useAppStore.getState();
    // 批量资料
    for (let i = 0; i < 10; i++) {
      store.addCourseMaterial("c_1", { title: `f${i}.pdf`, type: "pdf", size: "1 MB" });
    }
    // 批量时段
    for (let i = 0; i < 6; i++) {
      store.addScheduleSlot({ courseId: "c_1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "x", weeks: "1-16周" });
    }
    // 批量任务（含 CalendarMark）
    for (let i = 0; i < 6; i++) {
      store.addAssignment({ courseId: "c_1", title: `任务${i}`, description: "", ddl: "2026-09-01T23:59:00", priority: "medium", status: "todo", progress: 0, tags: [] });
    }

    const s = useAppStore.getState();
    const matIds = s.courses.find((c) => c.id === "c_1")!.materials.map((m) => m.id);
    const schedIds = s.schedules.filter((x) => x.courseId === "c_1").map((x) => x.id);
    const taskIds = s.assignments.filter((a) => a.courseId === "c_1").map((a) => a.id);
    const markIds = s.calendarMarks.map((m) => m.id);

    expect(new Set(matIds).size).toBe(matIds.length);
    expect(new Set(schedIds).size).toBe(schedIds.length);
    expect(new Set(taskIds).size).toBe(taskIds.length);
    expect(new Set(markIds).size).toBe(markIds.length);
    // 跨类型也不冲突（全部带随机后缀）
    expect(new Set([...matIds, ...schedIds, ...taskIds, ...markIds]).size).toBe(
      matIds.length + schedIds.length + taskIds.length + markIds.length
    );
  });
});

describe("findDataIntegrityIssues", () => {
  it("干净数据无孤儿", () => {
    const issues = findDataIntegrityIssues(mkData());
    expect(issues.orphanSchedules).toHaveLength(0);
    expect(issues.orphanAssignments).toHaveLength(0);
    expect(issues.orphanGroupProjects).toHaveLength(0);
    expect(issues.orphanDDLMarks).toHaveLength(0);
  });

  it("检测孤儿 schedule / assignment / groupProject / DDL mark（只报告，不猜测）", () => {
    const data = mkData({
      schedules: [
        { id: "s_ok", courseId: "c_1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "x", weeks: "1-16周" },
        { id: "s_orphan", courseId: "c_missing", dayOfWeek: 2, startTime: "10:00", endTime: "11:40", location: "x", weeks: "1-16周" },
      ],
      assignments: [
        { id: "a_ok", courseId: "c_1", title: "ok", description: "", ddl: "2026-08-10T23:59:00", priority: "medium", status: "todo", progress: 0, tags: [] },
        { id: "a_orphan", courseId: "c_gone", title: "孤儿", description: "", ddl: "2026-08-11T23:59:00", priority: "medium", status: "todo", progress: 0, tags: [] },
      ],
      calendarMarks: [
        { id: "cm_ok", date: "2026-08-10", type: "ddl", title: "ok", sourceId: "a_ok" },
        { id: "cm_orphan", date: "2026-08-12", type: "ddl", title: "断链", sourceId: "a_deleted" },
        { id: "cm_legacy", date: "2026-08-13", type: "ddl", title: "旧数据" },
      ],
      groupProjects: [
        { id: "gp_orphan", courseId: "c_missing", title: "孤儿项目", description: "", progress: 0, updatedAt: "2026-08-01", members: [], tasks: [] },
      ],
    });

    const issues = findDataIntegrityIssues(data);
    expect(issues.orphanSchedules.map((s) => s.id)).toEqual(["s_orphan"]);
    expect(issues.orphanAssignments.map((a) => a.id)).toEqual(["a_orphan"]);
    expect(issues.orphanGroupProjects.map((g) => g.id)).toEqual(["gp_orphan"]);
    expect(issues.orphanDDLMarks.map((m) => m.id)).toEqual(["cm_orphan"]);
    expect(issues.unlinkedLegacyDDLMarks.map((m) => m.id)).toEqual(["cm_legacy"]);
  });
});
