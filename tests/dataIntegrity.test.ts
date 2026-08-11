import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore } from "@/store/useAppStore";
import { seedDemoData } from "./demoSeed";
import { findDataIntegrityIssues, classifyIntegrityIssues } from "@/lib/dataIntegrity";
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
    seedDemoData();
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
    seedDemoData();
    useAppStore.getState().setCurrentSemesterWeek(16);
    expect(useAppStore.getState().currentSemesterWeek).toBe(16);

    const data = mkData(); // totalWeeks = 12
    useAppStore.getState().restoreAppData(data);
    const week = useAppStore.getState().currentSemesterWeek;
    expect(week).toBeGreaterThanOrEqual(1);
    expect(week).toBeLessThanOrEqual(12);
  });

  it("clearLearningData 清空业务数据并保留 profile/semester/preferences", () => {
    seedDemoData();
    // 制造脏状态
    useAppStore.setState({
      selectedCourseId: "c_1",
      selectedAssignmentId: "a_1",
      isAddCourseModalOpen: true,
      isImportScheduleModalOpen: true,
      isConflictModalOpen: true,
      isFullTimetableModalOpen: true,
      selectedConflict: { scheduleA: {} as any, scheduleB: {} as any, dayOfWeek: 1, timeRange: "x" },
      assignmentTimeSlice: "overdue",
    });
    const profileBefore = useAppStore.getState().userProfile;
    const semesterBefore = useAppStore.getState().semester;
    const prefsBefore = useAppStore.getState().preferences;

    useAppStore.getState().clearLearningData();
    const s = useAppStore.getState();
    // 业务数据清空
    expect(s.courses).toHaveLength(0);
    expect(s.schedules).toHaveLength(0);
    expect(s.assignments).toHaveLength(0);
    expect(s.calendarMarks).toHaveLength(0);
    expect(s.groupProjects).toHaveLength(0);
    // 保留 profile / semester / preferences
    expect(s.userProfile).toEqual(profileBefore);
    expect(s.semester).toEqual(semesterBefore);
    expect(s.preferences).toEqual(prefsBefore);
    // 瞬时 UI 全部复位
    expect(s.selectedCourseId).toBeNull();
    expect(s.selectedAssignmentId).toBeNull();
    expect(s.selectedConflict).toBeNull();
    expect(s.assignmentSelection).toHaveLength(0);
    expect(s.assignmentPeekId).toBeNull();
    expect(s.isAddCourseModalOpen).toBe(false);
    expect(s.isImportScheduleModalOpen).toBe(false);
    expect(s.isConflictModalOpen).toBe(false);
    expect(s.isFullTimetableModalOpen).toBe(false);
    expect(s.assignmentTimeSlice).toBe("all");
  });

  it("resetEntireApp 回到 First Run 空状态（无演示数据）", () => {
    seedDemoData();
    useAppStore.getState().resetEntireApp();
    const s = useAppStore.getState();
    expect(s.courses).toHaveLength(0);
    expect(s.assignments).toHaveLength(0);
    expect(s.groupProjects).toHaveLength(0);
    expect(s.userProfile.name).toBe("");
    expect(s.assignmentTimeSlice).toBe("all");
    expect(s.selectedCourseId).toBeNull();
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

  it("Task 7G-C：orphan StudyBlock（missing Assignment / missing Course）→ orphan + fatal", () => {
    const data = mkData({
      studyBlocks: [
        { id: "b_miss_assign", title: "无任务", date: "2026-08-14", startTime: "19:00", endTime: "20:00", assignmentId: "a_gone", source: "manual" },
        { id: "b_miss_course", title: "无课程", date: "2026-08-14", startTime: "20:00", endTime: "21:00", courseId: "c_gone", source: "manual" },
        { id: "b_ok", title: "正常", date: "2026-08-14", startTime: "19:00", endTime: "20:00", assignmentId: "a_1", courseId: "c_1", source: "manual" },
      ],
    });
    const issues = findDataIntegrityIssues(data);
    expect(issues.orphanStudyBlocks.map((b) => b.studyBlockId).sort()).toEqual(["b_miss_assign", "b_miss_course"]);
    expect(issues.orphanStudyBlocks.find((b) => b.studyBlockId === "b_miss_assign")!.missingAssignmentId).toBe("a_gone");
    expect(issues.orphanStudyBlocks.find((b) => b.studyBlockId === "b_miss_course")!.missingCourseId).toBe("c_gone");
    
    const classified = classifyIntegrityIssues(issues);
    expect(classified.fatal.some((t) => t.includes("学习计划引用了不存在的课程或任务"))).toBe(true);
  });

  it("Task 7G-C：orphan Reminder target（Assignment / StudyBlock / CalendarMark）→ warning；standalone 不报", () => {
    const data = mkData({
      studyBlocks: [{ id: "b_1", title: "学习", date: "2026-08-14", startTime: "19:00", endTime: "20:00", courseId: "c_1", source: "manual" }],
      reminders: [
        { id: "r_a", title: "任务提醒", targetType: "assignment", targetId: "a_gone", timingMode: "absolute", triggerAt: "2026-08-15T20:00:00", status: "scheduled", source: "manual", createdAt: "2026-08-10T12:00:00", updatedAt: "2026-08-10T12:00:00" },
        { id: "r_b", title: "学习提醒", targetType: "studyBlock", targetId: "b_gone", timingMode: "relative", offsetMinutes: -10, triggerAt: "2026-08-14T18:50:00", status: "scheduled", source: "manual", createdAt: "2026-08-10T12:00:00", updatedAt: "2026-08-10T12:00:00" },
        { id: "r_m", title: "日历提醒", targetType: "calendarMark", targetId: "cm_gone", timingMode: "absolute", triggerAt: "2026-08-15T21:00:00", status: "scheduled", source: "manual", createdAt: "2026-08-10T12:00:00", updatedAt: "2026-08-10T12:00:00" },
        { id: "r_ok", title: "正常提醒", targetType: "assignment", targetId: "a_1", timingMode: "absolute", triggerAt: "2026-08-15T20:00:00", status: "scheduled", source: "manual", createdAt: "2026-08-10T12:00:00", updatedAt: "2026-08-10T12:00:00" },
        { id: "r_solo", title: "独立提醒", targetType: "standalone", timingMode: "absolute", triggerAt: "2026-08-20T09:00:00", status: "scheduled", source: "manual", createdAt: "2026-08-10T12:00:00", updatedAt: "2026-08-10T12:00:00" },
      ],
    });
    const issues = findDataIntegrityIssues(data);
    expect(issues.orphanReminderTargets.map((r) => r.reminderId).sort()).toEqual(["r_a", "r_b", "r_m"]);
    
    const classified = classifyIntegrityIssues(issues);
    expect(classified.warnings.some((t) => t.includes("提醒指向已不存在的目标"))).toBe(true);
    expect(classified.fatal).toHaveLength(0); // 该场景只有 warning
  });

  it("Task 7G-C1：非 standalone Reminder 缺 targetId → 记录为 orphan Reminder target warning", () => {
    const data = mkData({
      reminders: [
        {
          id: "r_missing_target",
          title: "缺失目标",
          targetType: "assignment",
          // 故意无 targetId
          timingMode: "absolute",
          triggerAt: "2026-08-15T20:00:00",
          status: "scheduled",
          source: "manual",
          createdAt: "2026-08-10T12:00:00",
          updatedAt: "2026-08-10T12:00:00",
        },
      ],
    });

    const issues = findDataIntegrityIssues(data);
    const entry = issues.orphanReminderTargets.find((r) => r.reminderId === "r_missing_target");
    expect(entry).toBeTruthy();
    expect(entry!.targetType).toBe("assignment");
    expect(entry!.missingTargetId).toBeUndefined(); // targetId 本身缺失：不伪造占位值

    const classified = classifyIntegrityIssues(issues);
    expect(classified.warnings.some((text) => text.includes("提醒指向已不存在的目标"))).toBe(true);
  });
});
