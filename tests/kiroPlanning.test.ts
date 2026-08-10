import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Kiro Task 4A Planning Read Tools：get_assignment_health / get_available_time / propose_study_plan。
 * 使用真实 Store + Read Executor；验证 deterministic 输出且绝不写 Store。
 */

const KEY = "classflow-storage-v2";

function dayStr(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function iso(offset: number, hour = 23, minute = 59): string {
  return `${dayStr(offset)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

function seedState() {
  const state = {
    userProfile: { name: "测试", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
    semester: { id: "s", name: "测试学期", startDate: dayStr(0), totalWeeks: 16 },
    courses: [{ id: "c1", name: "统计学", code: "STAT", teacher: "王老师", classroom: "教101", credit: 3, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [] }],
    schedules: [{ id: "s1", courseId: "c1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "教101", weeks: "1-16周" }],
    assignments: [
      { id: "a1", courseId: "c1", title: "无DDL任务", description: "", priority: "medium", status: "todo", progress: 0, tags: [], estimatedMinutes: 60 },
      { id: "a2", courseId: "c1", title: "已逾期任务", description: "", ddl: iso(-1), priority: "high", status: "doing", progress: 30, tags: [], estimatedMinutes: 90 },
      { id: "a3", courseId: "c1", title: "可安排任务", description: "", ddl: iso(3, 23, 59), priority: "medium", status: "todo", progress: 0, tags: [], estimatedMinutes: 120 },
    ],
    calendarMarks: [
      { id: "cm2", date: dayStr(0), type: "exam", title: "小测", startTime: "14:00", endTime: "16:00" },
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

async function freshRead() {
  vi.resetModules();
  const storeMod = await import("@/store/useAppStore");
  const readMod = await import("@/lib/ai/tools/read/executor");
  return { store: storeMod.useAppStore, read: readMod };
}

beforeEach(() => {
  localStorage.clear();
});

describe("get_assignment_health", () => {
  it("无 DDL → unknown（missing_deadline），不伪造风险", async () => {
    seedState();
    const { store, read } = await freshRead();
    const r = read.executeKiroReadTool("get_assignment_health", { assignmentId: "a1" }, store.getState()) as { ok: true; data: any };
    expect(r.data.state).toBe("unknown");
    expect(r.data.reasons).toContain("missing_deadline");
  });

  it("已逾期 → overdue", async () => {
    seedState();
    const { store, read } = await freshRead();
    const r = read.executeKiroReadTool("get_assignment_health", { assignmentId: "a2" }, store.getState()) as { ok: true; data: any };
    expect(r.data.state).toBe("overdue");
  });

  it("可安排任务（未排任何 StudyBlock）→ unscheduled + 截止前可用时间", async () => {
    seedState();
    const { store, read } = await freshRead();
    const r = read.executeKiroReadTool("get_assignment_health", { assignmentId: "a3" }, store.getState()) as { ok: true; data: any };
    expect(r.data.state).toBe("unscheduled");
    expect(r.data.scheduledMinutesBeforeDeadline).toBe(0);
    expect(r.data.estimatedMinutes).toBe(120);
    expect(typeof r.data.availableMinutesBeforeDeadline).toBe("number");
  });
});

describe("get_available_time", () => {
  it("返回 slots：排除课程（今天 08:00-09:40）与考试（今天 14:00-16:00）", async () => {
    seedState();
    const { store, read } = await freshRead();
    const r = read.executeKiroReadTool(
      "get_available_time",
      { startDate: dayStr(0), endDate: dayStr(1) },
      store.getState()
    ) as { ok: true; data: { slots: { date: string; startTime: string; endTime: string; minutes: number }[] } };
    const todaySlots = r.data.slots.filter((s) => s.date === dayStr(0));
    // 今天窗口从当前时刻起（不返回过去时间）
    for (const s of todaySlots) {
      expect(s.startTime < "09:40" && s.endTime > "08:00").toBe(false);
      expect(s.startTime < "16:00" && s.endTime > "14:00").toBe(false);
    }
    expect(todaySlots.length).toBeGreaterThan(0);
  });

  it("beforeDeadlineOfAssignmentId：Deadline 当天不超过截止时刻", async () => {
    seedState();
    const { store, read } = await freshRead();
    const r = read.executeKiroReadTool(
      "get_available_time",
      { startDate: dayStr(0), endDate: dayStr(3), beforeDeadlineOfAssignmentId: "a3" },
      store.getState()
    ) as { ok: true; data: { slots: { date: string; startTime: string; endTime: string }[] } };
    const dlDaySlots = r.data.slots.filter((s) => s.date === dayStr(3));
    for (const s of dlDaySlots) expect(s.endTime <= "23:59").toBe(true);
    // 全部 slot 都在 Deadline 当天及之前
    for (const s of r.data.slots) expect(s.date <= dayStr(3)).toBe(true);
  });
});

describe("propose_study_plan", () => {
  it("返回确定性 proposal，且绝不写 Store（studyBlocks 保持空）", async () => {
    seedState();
    const { store, read } = await freshRead();
    const before = store.getState().studyBlocks.length;
    const r = read.executeKiroReadTool(
      "propose_study_plan",
      { assignmentIds: ["a3", "a1"], fromDate: dayStr(0), toDate: dayStr(3) },
      store.getState()
    ) as { ok: true; data: { items: any[]; reasons: string[] } };
    expect(r.ok).toBe(true);
    expect(r.data.items.length).toBe(2);
    // overdue (a2) 不被安排
    expect(r.data.items.some((i) => i.assignmentId === "a2")).toBe(false);
    // 每项都有块（或已有安排）
    const a3 = r.data.items.find((i) => i.assignmentId === "a3");
    expect(a3.proposedBlocks.length).toBeGreaterThan(0);
    expect(a3.proposedMinutes).toBeLessThanOrEqual(120);
    // 不写 Store
    expect(store.getState().studyBlocks.length).toBe(before);
    expect(store.getState().assignments.length).toBe(3);
  });

  it("propose 的块不会落在课程时间（下周一 08:00-09:40 除外）", async () => {
    seedState();
    const { store, read } = await freshRead();
    const r = read.executeKiroReadTool(
      "propose_study_plan",
      { assignmentIds: ["a3"], fromDate: dayStr(7), toDate: dayStr(8) },
      store.getState()
    ) as { ok: true; data: { items: any[] } };
    for (const item of r.data.items) {
      for (const b of item.proposedBlocks) {
        if (b.date === dayStr(7)) {
          expect(b.startTime >= "09:40").toBe(true);
        }
      }
    }
  });
});
