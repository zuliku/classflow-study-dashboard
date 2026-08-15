import { describe, it, expect, vi, beforeEach } from "vitest";
import { KiroWriteApi } from "@/lib/ai/tools/write/types";

/**
 * Kiro Task Agent Task V2：optional DDL / estimatedMinutes / StudyBlock 暴露 / scope 语义。
 * 使用真实 Store（seed localStorage → freshModules），与 aiWrite.test 同构。
 */

const KEY = "classflow-storage-v2";

function dayOffsetDate(offset: number, hour = 23, minute = 59): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(hour)}:${p(minute)}:00`;
}

function dayStr(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function seedState() {
  const state = {
    userProfile: { name: "测试", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
    semester: { id: "s", name: "测试学期", startDate: "2026-01-01", totalWeeks: 16 },
    courses: [{ id: "c1", name: "统计学", code: "STAT", teacher: "王老师", classroom: "教101", credit: 3, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [] }],
    schedules: [],
    assignments: [
      // a1：无 DDL（合法状态）
      { id: "a1", courseId: "c1", title: "阅读教材第五章", description: "", priority: "medium", status: "todo", progress: 0, tags: [] },
      // a2：今天截止，无 block
      { id: "a2", courseId: "c1", title: "今天截止作业", description: "", ddl: dayOffsetDate(0), priority: "high", status: "doing", progress: 30, tags: [], estimatedMinutes: 90 },
      // a3：未来 DDL，但今天有 StudyBlock（Do Date ≠ Due Date）
      { id: "a3", courseId: "c1", title: "回归分析整理", description: "", ddl: dayOffsetDate(5), priority: "medium", status: "todo", progress: 0, tags: [], estimatedMinutes: 120 },
      // a4：未来 DDL，无 block
      { id: "a4", courseId: "c1", title: "期末报告", description: "", ddl: dayOffsetDate(9), priority: "low", status: "todo", progress: 0, tags: [] },
    ],
    calendarMarks: [
      { id: "cm2", date: dayStr(0), type: "ddl", title: "今天截止作业", sourceId: "a2" },
      { id: "cm3", date: dayStr(5), type: "ddl", title: "回归分析整理", sourceId: "a3" },
    ],
    groupProjects: [],
    studyBlocks: [
      { id: "b1", title: "回归分析整理", date: dayStr(0), startTime: "19:00", endTime: "20:00", assignmentId: "a3", courseId: "c1", source: "manual" },
      { id: "b2", title: "非法块", date: dayStr(0), startTime: "21:00", endTime: "21:00", assignmentId: "a3", courseId: "c1", source: "manual" },
    ],
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

async function freshModules() {
  vi.resetModules();
  const storeMod = await import("@/store/useAppStore");
  const readMod = await import("@/lib/ai/tools/read/executor");
  const writeMod = await import("@/lib/ai/tools/write/executor");
  return { store: storeMod.useAppStore, read: readMod, write: writeMod };
}

function buildApi(store: { getState: () => any }, undos: Map<string, () => void>): KiroWriteApi {
  const s = () => store.getState();
  return {
    getState: s,
        addAssignmentWithId: (a, id) => id,
    addScheduleOccurrenceOverride: () => ({ ok: true, id: "occ_t" }),
    addScheduleOccurrenceOverrideWithId: (o, id) => ({ ok: true, id }),
    deleteScheduleOccurrenceOverride: () => null,
    restoreScheduleOccurrenceOverride: () => {},
    addAssignment: (a) => store.getState().addAssignment(a),
    updateAssignment: (a) => store.getState().updateAssignment(a),
    updateAssignmentPatch: (id, patch) => store.getState().updateAssignmentPatch(id, patch),
    deleteAssignment: (id) => store.getState().deleteAssignment(id),
    restoreAssignment: (snapshot) => store.getState().restoreAssignment(snapshot),
    updateAssignmentStatus: (id, status) => store.getState().updateAssignmentStatus(id, status),
    updateAssignmentPriority: (id, priority) => store.getState().updateAssignmentPriority(id, priority),
    updateAssignmentProgress: (id, progress) => store.getState().updateAssignmentProgress(id, progress),
    toggleSubtask: (id, subtaskId) => store.getState().toggleSubtask(id, subtaskId),
    addScheduleSlot: (sl) => store.getState().addScheduleSlot(sl),
    updateSchedule: (sc) => store.getState().updateSchedule(sc),
    deleteSchedule: (id) => store.getState().deleteSchedule(id),
    restoreSchedule: (sc) => store.getState().restoreSchedule(sc),
    excludeWeekFromSchedule: (id, week) => store.getState().excludeWeekFromSchedule(id, week),
    addCourseWithSchedule: (c, slots) => store.getState().addCourseWithSchedule(c, slots),
    updateCourse: (c) => store.getState().updateCourse(c),
    addGroupProject: (p) => store.getState().addGroupProject(p),
    updateGroupProject: (id, patch) => store.getState().updateGroupProject(id, patch),
    deleteGroupProject: (id) => store.getState().deleteGroupProject(id),
    addGroupMember: (id, m) => store.getState().addGroupMember(id, m),
    updateGroupMember: (id, m) => store.getState().updateGroupMember(id, m),
    deleteGroupMember: (id, memberId) => store.getState().deleteGroupMember(id, memberId),
    addGroupTask: (id, t) => store.getState().addGroupTask(id, t),
    updateGroupTask: (id, t) => store.getState().updateGroupTask(id, t),
    deleteGroupTask: (id, taskId) => store.getState().deleteGroupTask(id, taskId),
    toggleGroupTask: (id, taskId) => store.getState().toggleGroupTask(id, taskId),
    addReminder: (input) => store.getState().addReminder(input),
    updateReminder: (id, patch) => store.getState().updateReminder(id, patch),
    deleteReminder: (id) => store.getState().deleteReminder(id),
    restoreReminder: (r) => store.getState().restoreReminder(r),
    reconcileTargetReminders: (targetType, targetId) => store.getState().reconcileTargetReminders(targetType, targetId),
    startFocusSession: (input) => store.getState().startFocusSession(input),
    pauseFocusSession: (now) => store.getState().pauseFocusSession(now),
    resumeFocusSession: (now) => store.getState().resumeFocusSession(now),
    finishFocusSession: (now) => store.getState().finishFocusSession(now),
    pushToast: () => {},
    registerUndo: (toolCallId, undo) => undos.set(toolCallId, undo),
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("Kiro Task V2 Read Tools", () => {
  it("get_assignment：无 DDL 任务 deadline=null，hasDeadline=false（合法状态）", async () => {
    seedState();
    const { store, read } = await freshModules();
    const r = read.executeKiroReadTool("get_assignment", { assignmentId: "a1" }, store.getState()) as { ok: true; data: any };
    expect(r.ok).toBe(true);
    expect(r.data.deadline).toBeNull();
    expect(r.data.hasDeadline).toBe(false);
    expect(r.data.estimatedMinutes).toBeNull();
  });

  it("get_assignment：Task 6A linkedMaterials 返回关联资料 metadata（按 materialIds 原序）", async () => {
    seedState();
    const { store, read } = await freshModules();
    // c1（统计学）初始无资料：补两个资料再关联
    store.getState().addCourseMaterial("c1", { title: "讲义.pdf", type: "pdf", size: "1 MB" });
    store.getState().addCourseMaterial("c1", { title: "实验指导.pdf", type: "pdf", size: "2 MB" });
    const c1 = store.getState().courses.find((c: any) => c.id === "c1")!;
    const [mid1, mid2] = c1.materials.map((m: any) => m.id);
    store.getState().setAssignmentMaterialIds("a2", [mid2, mid1]);

    const r = read.executeKiroReadTool("get_assignment", { assignmentId: "a2" }, store.getState()) as { ok: true; data: any };
    expect(r.ok).toBe(true);
    expect(r.data.linkedMaterials.map((m: any) => m.id)).toEqual([mid2, mid1]);
    expect(r.data.linkedMaterials[0].title).toBe("实验指导.pdf");
    // 只返回 metadata，绝不返回 storageKey / url / 正文
    expect(r.data.linkedMaterials[0].storageKey).toBeUndefined();
    expect(r.data.linkedMaterials[0].url).toBeUndefined();
    expect(r.data.linkedMaterials[0]).toHaveProperty("uploadDate");
  });

  it("get_assignment：返回 estimatedMinutes + schedule（scheduledMinutes 累计，非法块跳过）", async () => {
    seedState();
    const { store, read } = await freshModules();
    const r = read.executeKiroReadTool("get_assignment", { assignmentId: "a3" }, store.getState()) as { ok: true; data: any };
    expect(r.data.estimatedMinutes).toBe(120);
    expect(r.data.schedule.scheduledMinutes).toBe(60); // b1 60min；b2 end<=start 跳过
    expect(r.data.schedule.blocks).toHaveLength(1);
    expect(r.data.schedule.blocks[0]).toMatchObject({ id: "b1", date: expect.any(String), startTime: "19:00", endTime: "20:00", source: "manual" });
  });

  it("get_assignment_schedule：只返回安排，不需要遍历日历", async () => {
    seedState();
    const { store, read } = await freshModules();
    const r = read.executeKiroReadTool("get_assignment_schedule", { assignmentId: "a3" }, store.getState()) as { ok: true; data: any };
    expect(r.ok).toBe(true);
    expect(r.data.assignmentTitle).toBe("回归分析整理");
    expect(r.data.scheduledMinutes).toBe(60);
    expect(r.data.blocks).toHaveLength(1);
  });

  it("search_assignments scope=today：今天截止 OR 今天有 StudyBlock（Do Date ≠ Due Date）", async () => {
    seedState();
    const { store, read } = await freshModules();
    const r = read.executeKiroReadTool("search_assignments", { scope: "today" }, store.getState()) as { ok: true; data: { id: string }[] };
    const ids = r.data.map((x) => x.id).sort();
    expect(ids).toEqual(["a2", "a3"]); // a3 DDL 在未来但今天已安排
  });

  it("search_assignments scope=unscheduled：无 StudyBlock 的 active 任务（无 DDL 也在列）", async () => {
    seedState();
    const { store, read } = await freshModules();
    const r = read.executeKiroReadTool("search_assignments", { scope: "unscheduled" }, store.getState()) as { ok: true; data: { id: string }[] };
    const ids = r.data.map((x) => x.id).sort();
    expect(ids).toEqual(["a1", "a2", "a4"]);
  });

  it("search_assignments 旧参数（due）仍兼容", async () => {
    seedState();
    const { store, read } = await freshModules();
    const r = read.executeKiroReadTool("search_assignments", { due: "today" }, store.getState()) as { ok: true; data: { id: string }[] };
    expect(r.data.map((x) => x.id)).toEqual(["a2"]);
  });

  it("search_assignments scope=at-risk：Domain 保留（无 planning → 空列表，不报错）", async () => {
    seedState();
    const { store, read } = await freshModules();
    const r = read.executeKiroReadTool("search_assignments", { scope: "at-risk" }, store.getState()) as { ok: true; data: { id: string }[] };
    expect(r.ok).toBe(true);
    expect(Array.isArray(r.data)).toBe(true);
  });

  it("propose_task_breakdown：合法 Proposal 通过校验并回显（含任务标题/课程）", async () => {
    seedState();
    const { store, read } = await freshModules();
    const r = read.executeKiroReadTool(
      "propose_task_breakdown",
      {
        assignmentId: "a4",
        suggestedEstimatedMinutes: 180,
        subtasks: [
          { title: "明确研究问题", estimatedMinutes: 30 },
          { title: "整理数据", estimatedMinutes: 60 },
          { title: "完成回归与稳健性检验", estimatedMinutes: 60 },
          { title: "撰写结论", estimatedMinutes: 30 },
        ],
        rationale: ["按实证报告流程拆解"],
      },
      store.getState()
    ) as { ok: true; data: { proposal: any } };
    expect(r.ok).toBe(true);
    expect(r.data.proposal.assignmentId).toBe("a4");
    expect(r.data.proposal.assignmentTitle).toBe("期末报告");
    expect(r.data.proposal.courseName).toBe("统计学");
    expect(r.data.proposal.subtasks).toHaveLength(4);
    expect(r.data.proposal.suggestedEstimatedMinutes).toBe(180);
  });

  it("propose_task_breakdown：非法（步骤仅 1 项）→ INVALID_INPUT，不进入 Store", async () => {
    seedState();
    const { store, read } = await freshModules();
    const before = store.getState().assignments;
    const r = read.executeKiroReadTool(
      "propose_task_breakdown",
      { assignmentId: "a4", subtasks: [{ title: "唯一步骤" }] },
      store.getState()
    ) as { ok: false; code: string };
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INVALID_INPUT");
    expect(store.getState().assignments).toEqual(before);
  });

  it("propose_task_breakdown：任务不存在 → NOT_FOUND（不静默通过）", async () => {
    seedState();
    const { store, read } = await freshModules();
    const r = read.executeKiroReadTool(
      "propose_task_breakdown",
      { assignmentId: "nope", suggestedEstimatedMinutes: 60 },
      store.getState()
    ) as { ok: false; code: string };
    expect(r.ok).toBe(false);
    expect(r.code).toBe("NOT_FOUND");
  });

  it("propose_task_breakdown：仅估时（无步骤）合法 → 支持「估计需要多久」", async () => {
    seedState();
    const { store, read } = await freshModules();
    const r = read.executeKiroReadTool(
      "propose_task_breakdown",
      { assignmentId: "a4", suggestedEstimatedMinutes: 45, rationale: ["根据内容量与类型估计"] },
      store.getState()
    ) as { ok: true; data: { proposal: any } };
    expect(r.ok).toBe(true);
    expect(r.data.proposal.subtasks).toEqual([]);
    expect(r.data.proposal.suggestedEstimatedMinutes).toBe(45);
  });
});

describe("Kiro Task V2 Write Tools", () => {
  it("create_assignment 无 DDL 合法；estimatedMinutes=60 写入且不建空 CalendarMark", async () => {
    seedState();
    const { store, write } = await freshModules();
    const undos = new Map<string, () => void>();
    const api = buildApi(store, undos);
    const r = write.executeKiroWriteTool("create_assignment", { courseId: "c1", title: "阅读微观经济学第五章", estimatedMinutes: 60 }, api, "c1");
    expect(r.ok).toBe(true);
    const s = store.getState();
    const created = s.assignments.find((a: any) => a.title === "阅读微观经济学第五章");
    expect(created).toBeTruthy();
    expect(created!.ddl).toBeUndefined();
    expect(created!.estimatedMinutes).toBe(60);
    // 无 DDL → 不创建 linked mark
    expect(s.calendarMarks.some((m: any) => m.sourceId === created!.id)).toBe(false);
  });

  it("update_assignment：estimatedMinutes null 清除预计耗时", async () => {
    seedState();
    const { store, write } = await freshModules();
    const undos = new Map<string, () => void>();
    const api = buildApi(store, undos);
    const r = write.executeKiroWriteTool("update_assignment", { assignmentId: "a2", estimatedMinutes: null }, api, "c1");
    expect(r.ok).toBe(true);
    const s = store.getState();
    expect(s.assignments.find((a: any) => a.id === "a2")!.estimatedMinutes).toBeUndefined();
  });

  it("update_assignment：estimatedMinutes 90 → 90", async () => {
    seedState();
    const { store, write } = await freshModules();
    const undos = new Map<string, () => void>();
    const api = buildApi(store, undos);
    const r = write.executeKiroWriteTool("update_assignment", { assignmentId: "a1", estimatedMinutes: 90 }, api, "c1");
    expect(r.ok).toBe(true);
    expect(store.getState().assignments.find((a: any) => a.id === "a1")!.estimatedMinutes).toBe(90);
  });

  it("set_assignment_ddl ddl=null：清除 DDL，CalendarMark 同步消失", async () => {
    seedState();
    const { store, write } = await freshModules();
    const undos = new Map<string, () => void>();
    const api = buildApi(store, undos);
    // 先确认 mark 存在
    expect(store.getState().calendarMarks.some((m: any) => m.sourceId === "a2")).toBe(true);
    const r = write.executeKiroWriteTool("set_assignment_ddl", { assignmentId: "a2", ddl: null }, api, "c1");
    expect(r.ok).toBe(true);
    const s = store.getState();
    expect(s.assignments.find((a: any) => a.id === "a2")!.ddl).toBeUndefined();
    expect(s.calendarMarks.some((m: any) => m.sourceId === "a2")).toBe(false);
  });

  it("set_assignment_ddl ddl=string：正常设置", async () => {
    seedState();
    const { store, write } = await freshModules();
    const undos = new Map<string, () => void>();
    const api = buildApi(store, undos);
    const newDdl = dayOffsetDate(3, 21, 0);
    const r = write.executeKiroWriteTool("set_assignment_ddl", { assignmentId: "a1", ddl: newDdl }, api, "c1");
    expect(r.ok).toBe(true);
    const s = store.getState();
    expect(s.assignments.find((a: any) => a.id === "a1")!.ddl).toBe(newDdl);
    expect(s.calendarMarks.some((m: any) => m.sourceId === "a1" && m.type === "ddl")).toBe(true);
  });
});

