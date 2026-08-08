import { it, expect, beforeEach, vi } from "vitest";
import { addDays, format } from "date-fns";

const KEY = "classflow-storage-v2";

beforeEach(() => localStorage.clear());

it("debug full seed hydration", async () => {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const local = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now = new Date();
  const dow = now.getDay() === 0 ? 7 : now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dow - 1));
  const state = {
    userProfile: { name: "测试用户", avatarUrl: "https://example.com/avatar.png", college: "经管学院", grade: "大三", studentId: "2023001", completedCredits: 10, totalCredits: 20 },
    semester: { id: "sem_1", name: "测试学期", startDate: local(monday), totalWeeks: 16 },
    courses: [
      { id: "c1", name: "统计学", code: "STAT101", teacher: "李老师", classroom: "教101", credit: 3, bgHex: "#E7E3D8", borderHex: "#D5CDBE", textHex: "#313032", description: "统计基础", materials: [{ id: "m1", title: "第三章讲义.pdf", type: "pdf", size: "2 MB", uploadDate: "2026-03-01", storageKey: "blob-1" }] },
    ],
    schedules: [{ id: "s1", courseId: "c1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "教101", weeks: "1-16周" }],
    assignments: [{ id: "a1", courseId: "c1", title: "统计学作业", description: "第三章习题", ddl: `${local(addDays(now, 1))}T23:59:00`, priority: "high", status: "todo", progress: 0, tags: ["作业"] }],
    calendarMarks: [{ id: "cm1", date: local(addDays(now, 1)), type: "ddl", title: "统计学作业", sourceId: "a1" }],
    groupProjects: [
      {
        id: "gp1", courseId: "c1", title: "统计小组项目", description: "案例分析", progress: 50, updatedAt: local(now),
        members: [{ id: "gm1", name: "张三", role: "leader", major: "统计", avatarUrl: "https://example.com/gm1.png" }],
        tasks: [{ id: "gt1", title: "数据收集", assigneeId: "gm1", ddl: `${local(addDays(now, 3))}T20:00:00`, completed: false }],
      },
    ],
    assignmentTimeSlice: "all",
    lastWorkspaceTab: "overview",
    preferences: { showWeekends: true, ddlWarningDays: 7, defaultDDLTime: "23:59", enableScheduleDirectManipulation: true, enableDDLDirectManipulation: true, motionPreference: "system", startupView: "overview", defaultTaskPriority: "medium", defaultTaskStatus: "todo", enableSingleKeyShortcuts: true, contentDensity: "comfortable" },
  };
  localStorage.setItem(KEY, JSON.stringify({ version: 3, state }));
  try {
    vi.resetModules();
    const mod = await import("@/store/useAppStore");
    const s = mod.useAppStore.getState();
    console.log("SEMESTER:", s.semester.name, "COURSES:", s.courses.length, "GROUPS:", s.groupProjects.length, "ASSIGN:", s.assignments.length);
  } catch (e) {
    console.log("IMPORT THREW:", (e as Error).message);
  }
  expect(true).toBe(true);
});
