import { describe, it, expect, beforeEach, vi } from "vitest";
import { addDays } from "date-fns";
import { KiroWriteApi } from "@/lib/ai/tools/write/types";
import { executeKiroWriteTool } from "@/lib/ai/tools/write/executor";
import { getDefaultCourseAppearance } from "@/lib/courseAppearance";

const KEY = "classflow-storage-v2";

function seedStore() {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const local = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now = new Date();
  const dow = now.getDay() === 0 ? 7 : now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dow - 1));
  const startDate = local(monday);

  const state = {
    userProfile: { name: "测试用户", avatarUrl: "", college: "经管学院", grade: "大三", studentId: "2023001", completedCredits: 0, totalCredits: 0 },
    semester: { id: "sem_1", name: "测试学期", startDate, totalWeeks: 16 },
    courses: [
      { id: "c1", name: "统计学", code: "STAT101", teacher: "李老师", classroom: "教101", credit: 3, bgHex: "#E7E3D8", borderHex: "#D5CDBE", textHex: "#313032", description: "统计基础", materials: [] },
      { id: "c2", name: "计量经济学", code: "ECON305", teacher: "王老师", classroom: "教302", credit: 4, bgHex: "#DCE6DC", borderHex: "#C4D6C6", textHex: "#313032", description: "", materials: [] },
    ],
    schedules: [
      { id: "s1", courseId: "c1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "教101", weeks: "1-16周" },
      { id: "s2", courseId: "c2", dayOfWeek: 5, startTime: "15:00", endTime: "16:40", location: "教302", weeks: "1-16周" },
    ],
    assignments: [
      { id: "a1", courseId: "c1", title: "统计学作业", description: "第三章习题", ddl: `${local(now)}T23:59:00`, priority: "medium", status: "todo", progress: 0, tags: ["作业"], subtasks: [{ id: "st1", title: "第一题", completed: false }] },
    ],
    calendarMarks: [{ id: "cm1", date: local(now), type: "ddl", title: "统计学作业", sourceId: "a1" }],
    groupProjects: [
      {
        id: "gp1", courseId: "c1", title: "统计小组项目", description: "", progress: 0, updatedAt: local(now),
        members: [{ id: "gm1", name: "张三", role: "leader", major: "统计" }],
        tasks: [{ id: "gt1", title: "数据收集", assigneeId: "gm1", ddl: `${local(addDays(now, 3))}T20:00:00`, completed: false }],
      },
    ],
    assignmentTimeSlice: "all",
    lastWorkspaceTab: "overview",
    preferences: {
      showWeekends: true, ddlWarningDays: 7, defaultDDLTime: "23:59",
      enableScheduleDirectManipulation: true, enableDDLDirectManipulation: true, motionPreference: "system",
      startupView: "overview", defaultTaskPriority: "high", defaultTaskStatus: "doing",
      enableSingleKeyShortcuts: true, contentDensity: "comfortable",
    },
  };
  localStorage.setItem(KEY, JSON.stringify({ version: 3, state }));
}

async function freshModules() {
  vi.resetModules();
  const storeMod = await import("@/store/useAppStore");
  const execMod = await import("@/lib/ai/tools/write/executor");
  return { store: storeMod.useAppStore, executeKiroWriteTool: execMod.executeKiroWriteTool };
}

/** 真实 Store 之上的受限 api（与 hook 同构；registerUndo 收集到数组便于断言） */
function buildApi(store: ReturnType<typeof useAppStoreLike>, undos: Map<string, () => void>) {
  const s = () => store.getState();
  const api: KiroWriteApi = {
    getState: s,
    addAssignment: (a) => store.getState().addAssignment(a),
    updateAssignment: (a) => store.getState().updateAssignment(a),
    deleteAssignment: (id) => store.getState().deleteAssignment(id),
    restoreAssignment: (a, marks) => store.getState().restoreAssignment(a, marks),
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
    pushToast: () => {},
    registerUndo: (toolCallId, undo) => undos.set(toolCallId, undo),
  };
  return api;
}

type StoreLike = ReturnType<typeof useAppStoreLike>;
function useAppStoreLike() {
  return null as never;
}

beforeEach(() => {
  localStorage.clear();
});

describe("Write Executor — Assignment", () => {
  it("set_assignment_ddl：DDL 修改 + CalendarMark 同步 + Undo 恢复", async () => {
    seedStore();
    const { store, executeKiroWriteTool } = await freshModules();
    const undos = new Map<string, () => void>();
    const api = buildApi(store, undos);
    const next = new Date();
    next.setDate(next.getDate() + 1);
    const newDDL = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}T22:00:00`;

    const r = executeKiroWriteTool("set_assignment_ddl", { assignmentId: "a1", ddl: newDDL }, api, "call_1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.action.before).toEqual({ ddl: expect.stringMatching(/T23:59:00$/) });
    expect(r.action.after).toEqual({ ddl: newDDL });

    const s = store.getState();
    expect(s.assignments.find((a) => a.id === "a1")?.ddl).toBe(newDDL);
    // CalendarMark 同步
    expect(s.calendarMarks.find((m) => m.id === "cm1")?.date).toBe(newDDL.slice(0, 10));
    expect(s.calendarMarks.find((m) => m.id === "cm1")?.sourceId).toBe("a1");

    // Undo 恢复原 DDL + 日历
    expect(undos.has("call_1")).toBe(true);
    undos.get("call_1")!();
    const after = store.getState();
    expect(after.assignments.find((a) => a.id === "a1")?.ddl).toMatch(/T23:59:00$/);
    expect(after.calendarMarks.find((m) => m.id === "cm1")?.date).not.toBe(newDDL.slice(0, 10));
  });

  it("create_assignment：默认优先级/状态来自偏好；返回真实 ID；Undo 删除", async () => {
    seedStore();
    const { store, executeKiroWriteTool } = await freshModules();
    const undos = new Map<string, () => void>();
    const api = buildApi(store, undos);
    const r = executeKiroWriteTool(
      "create_assignment",
      { courseId: "c1", title: "统计学复习", ddl: "2026-09-01T21:00:00" },
      api,
      "call_2"
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = store.getState();
    const created = s.assignments.find((a) => a.id === r.data.id);
    expect(created).toBeTruthy();
    expect(created?.priority).toBe("high"); // 偏好默认
    expect(created?.status).toBe("doing"); // 偏好默认
    expect(created?.title).toBe("统计学复习");
    expect(r.action.canUndo).toBe(true);

    undos.get("call_2")!();
    expect(store.getState().assignments.some((a) => a.id === r.data.id)).toBe(false);
  });

  it("delete_assignment：删除 + CalendarMark 清理 + Undo 完整恢复", async () => {
    seedStore();
    const { store, executeKiroWriteTool } = await freshModules();
    const undos = new Map<string, () => void>();
    const api = buildApi(store, undos);
    const r = executeKiroWriteTool("delete_assignment", { assignmentId: "a1" }, api, "call_3");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    let s = store.getState();
    expect(s.assignments.some((a) => a.id === "a1")).toBe(false);
    expect(s.calendarMarks.some((m) => m.id === "cm1")).toBe(false);

    undos.get("call_3")!();
    s = store.getState();
    expect(s.assignments.find((a) => a.id === "a1")?.title).toBe("统计学作业");
    expect(s.calendarMarks.find((m) => m.id === "cm1")?.sourceId).toBe("a1");
  });

  it("set_assignment_status completed：保留 store 语义（progress=100）", async () => {
    seedStore();
    const { store, executeKiroWriteTool } = await freshModules();
    const undos = new Map();
    const api = buildApi(store, undos);
    const r = executeKiroWriteTool("set_assignment_status", { assignmentId: "a1", status: "completed" }, api, "c");
    expect(r.ok).toBe(true);
    expect(store.getState().assignments.find((a) => a.id === "a1")?.progress).toBe(100);
  });

  it("set_assignment_progress：status 自动同步（100 → completed）", async () => {
    seedStore();
    const { store, executeKiroWriteTool } = await freshModules();
    const undos = new Map();
    const api = buildApi(store, undos);
    const r = executeKiroWriteTool("set_assignment_progress", { assignmentId: "a1", progress: 100 }, api, "c");
    expect(r.ok).toBe(true);
    expect(store.getState().assignments.find((a) => a.id === "a1")?.status).toBe("completed");
  });
});

describe("Write Executor — Schedule", () => {
  it("move_schedule：保持原时长，冲突时拒绝写入（无 mutation）", async () => {
    seedStore();
    const { store, executeKiroWriteTool } = await freshModules();
    const undos = new Map();
    const api = buildApi(store, undos);
    const before = JSON.stringify(store.getState().schedules);

    // 移到周五 15:00（与 s2 计量经济学冲突）→ 拒绝
    const conflictR = executeKiroWriteTool(
      "move_schedule",
      { scheduleId: "s1", dayOfWeek: 5, startTime: "15:00" },
      api,
      "c1"
    ) as { ok: false; code: string; details?: { conflictingCourse?: string } };
    expect(conflictR.ok).toBe(false);
    expect(conflictR.code).toBe("CONFLICT");
    expect(conflictR.details?.conflictingCourse).toBe("计量经济学");
    expect(JSON.stringify(store.getState().schedules)).toBe(before); // 无 mutation

    // 移到周三 10:00（无冲突）→ 成功，时长保持 100 分钟
    const okR = executeKiroWriteTool("move_schedule", { scheduleId: "s1", dayOfWeek: 3, startTime: "10:00" }, api, "c2");
    expect(okR.ok).toBe(true);
    if (!okR.ok) return;
    const moved = store.getState().schedules.find((s) => s.id === "s1")!;
    expect(moved.dayOfWeek).toBe(3);
    expect(moved.startTime).toBe("10:00");
    expect(moved.endTime).toBe("11:40"); // 原 08:00–09:40 时长 100 分钟
    // Undo
    undos.get("c2")!();
    expect(store.getState().schedules.find((s) => s.id === "s1")?.dayOfWeek).toBe(1);
  });

  it("delete_schedule：删除 + Undo 恢复", async () => {
    seedStore();
    const { store, executeKiroWriteTool } = await freshModules();
    const undos = new Map<string, () => void>();
    const api = buildApi(store, undos);
    const r = executeKiroWriteTool("delete_schedule", { scheduleId: "s2" }, api, "c3");
    expect(r.ok).toBe(true);
    expect(store.getState().schedules.some((s) => s.id === "s2")).toBe(false);
    undos.get("c3")!();
    expect(store.getState().schedules.find((s) => s.id === "s2")?.courseId).toBe("c2");
  });
});

describe("Write Executor — Group", () => {
  it("assign_group_task：成员必须属于项目；否则 NOT_FOUND（不猜）", async () => {
    seedStore();
    const { store, executeKiroWriteTool } = await freshModules();
    const undos = new Map();
    const api = buildApi(store, undos);
    const ok = executeKiroWriteTool("assign_group_task", { projectId: "gp1", taskId: "gt1", assigneeId: "gm1" }, api, "c");
    expect(ok.ok).toBe(true);
    const bad = executeKiroWriteTool("assign_group_task", { projectId: "gp1", taskId: "gt1", assigneeId: "ghost" }, api, "c2") as { ok: false; code: string };
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe("NOT_FOUND");
  });

  it("last leader：唯一负责人不能被降级（LAST_LEADER）", async () => {
    seedStore();
    const { store, executeKiroWriteTool } = await freshModules();
    const undos = new Map();
    const api = buildApi(store, undos);
    const r = executeKiroWriteTool("update_group_member", { projectId: "gp1", memberId: "gm1", role: "member" }, api, "c") as { ok: false; code: string };
    expect(r.ok).toBe(false);
    expect(r.code).toBe("LAST_LEADER");
    // 项目不变
    expect(store.getState().groupProjects[0].members[0].role).toBe("leader");

    // 添加第二个 leader 后可降级
    const add = executeKiroWriteTool("add_group_member", { projectId: "gp1", name: "李四", role: "leader" }, api, "c2");
    expect(add.ok).toBe(true);
    const ok = executeKiroWriteTool("update_group_member", { projectId: "gp1", memberId: "gm1", role: "member" }, api, "c3");
    expect(ok.ok).toBe(true);
  });

  it("set_group_task_ddl：本地 wall-clock 原样保存（无 Z / 无时区转换）", async () => {
    seedStore();
    const { store, executeKiroWriteTool } = await freshModules();
    const undos = new Map();
    const api = buildApi(store, undos);
    const r = executeKiroWriteTool("set_group_task_ddl", { projectId: "gp1", taskId: "gt1", ddl: "2026-09-07T18:00:00" }, api, "c");
    expect(r.ok).toBe(true);
    expect(store.getState().groupProjects[0].tasks[0].ddl).toBe("2026-09-07T18:00:00");
    expect(store.getState().groupProjects[0].tasks[0].ddl.endsWith("Z")).toBe(false);
  });

  it("toggle_group_task：切换 + Undo 再次切换恢复", async () => {
    seedStore();
    const { store, executeKiroWriteTool } = await freshModules();
    const undos = new Map<string, () => void>();
    const api = buildApi(store, undos);
    const r = executeKiroWriteTool("toggle_group_task", { projectId: "gp1", taskId: "gt1" }, api, "c");
    expect(r.ok).toBe(true);
    expect(store.getState().groupProjects[0].tasks[0].completed).toBe(true);
    undos.get("c")!();
    expect(store.getState().groupProjects[0].tasks[0].completed).toBe(false);
  });
});

describe("Write Executor — Course", () => {
  it("create_course：使用默认配色；update_course 可撤销", async () => {
    seedStore();
    const { store, executeKiroWriteTool } = await freshModules();
    const undos = new Map<string, () => void>();
    const api = buildApi(store, undos);
    const r = executeKiroWriteTool("create_course", { name: "线性代数", teacher: "赵老师", credit: 4 }, api, "c");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const created = store.getState().courses.find((c) => c.id === r.data.id)!;
    const def = getDefaultCourseAppearance();
    expect(created.bgHex).toBe(def.bgHex);
    expect(created.borderHex).toBe(def.borderHex);
    expect(r.action.canUndo).toBe(false); // V1：不开放级联删除 Undo

    const u = executeKiroWriteTool("update_course", { courseId: r.data.id, name: "线性代数A" }, api, "c2");
    expect(u.ok).toBe(true);
    expect(store.getState().courses.find((c) => c.id === r.data.id)?.name).toBe("线性代数A");
    undos.get("c2")!();
    expect(store.getState().courses.find((c) => c.id === r.data.id)?.name).toBe("线性代数");
  });
});

describe("Write Executor — 安全", () => {
  it("未知工具 → UNSUPPORTED；非法 schema → INVALID_INPUT（不崩溃）", async () => {
    seedStore();
    const { store, executeKiroWriteTool } = await freshModules();
    const undos = new Map();
    const api = buildApi(store, undos);
    const unknown = executeKiroWriteTool("delete_course", {}, api, "c") as { ok: false; code: string };
    expect(unknown.ok).toBe(false);
    expect(unknown.code).toBe("UNSUPPORTED");
    const bad = executeKiroWriteTool("set_assignment_progress", { assignmentId: "a1", progress: 150 }, api, "c2") as { ok: false; code: string };
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe("INVALID_INPUT");
    // 无 mutation
    expect(store.getState().assignments[0].progress).toBe(0);
  });

  it("Preflight 失败（entity 不存在）不产生 mutation", async () => {
    seedStore();
    const { store, executeKiroWriteTool } = await freshModules();
    const undos = new Map();
    const api = buildApi(store, undos);
    const before = JSON.stringify(store.getState().assignments);
    const r = executeKiroWriteTool("set_assignment_ddl", { assignmentId: "ghost", ddl: "2026-09-01T10:00:00" }, api, "c");
    expect(r.ok).toBe(false);
    expect(JSON.stringify(store.getState().assignments)).toBe(before);
  });
});
