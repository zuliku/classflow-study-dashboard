import { describe, it, expect } from "vitest";
import { preflightChangeSet, reserveCreateIds } from "@/lib/ai/transactions/preflight";
import { executeChangeSet } from "@/lib/ai/transactions/executor";
import { ChangeSetActionInput } from "@/lib/ai/transactions/types";
import { KiroWriteApi } from "@/lib/ai/tools/write/types";

function makeState() {
  return {
    semester: { id: "s", name: "测试学期", startDate: "2026-08-03", totalWeeks: 16 },
    courses: [{ id: "c1", name: "数据结构", materials: [] }],
    schedules: [
      { id: "s1", courseId: "c1", dayOfWeek: 3, startTime: "10:00", endTime: "11:40", location: "教101", weeks: "1-16周" },
      { id: "s2", courseId: "c1", dayOfWeek: 4, startTime: "10:00", endTime: "11:40", location: "教102", weeks: "1-16周" },
    ],
    assignments: [
      { id: "a1", courseId: "c1", title: "作业1", description: "", ddl: "2026-08-10T23:59:00", priority: "medium", status: "todo", progress: 0, tags: [] },
    ],
    calendarMarks: [],
    groupProjects: [],
    studyBlocks: [],
    scheduleOccurrenceOverrides: [],
    reminders: [],
    preferences: {
      defaultTaskPriority: "medium",
      defaultTaskStatus: "todo",
      defaultDeadlineReminderMinutes: 30,
      defaultDDLTime: "23:59",
    },
  } as never;
}

type State = ReturnType<typeof makeState>;

class FakeApi {
  undos = new Map<string, () => void>();
  confirmCalls: string[] = [];
  constructor(private state: State) {}
  getState() {
    return this.state as never;
  }
  addAssignmentWithId(a: Record<string, unknown>, id: string) {
    (this.state as any).assignments = [{ ...a, id }, ...(this.state as any).assignments];
    return id;
  }
  addScheduleOccurrenceOverrideWithId(o: Record<string, unknown>, id: string) {
    (this.state as any).scheduleOccurrenceOverrides = [
      ...(this.state as any).scheduleOccurrenceOverrides,
      { ...o, id },
    ];
    return { ok: true, id };
  }
  addScheduleOccurrenceOverride() {
    return { ok: false as const, code: "UNSUPPORTED", message: "test stub" };
  }
  deleteScheduleOccurrenceOverride(id: string) {
    const found = (this.state as any).scheduleOccurrenceOverrides.find((o: any) => o.id === id);
    (this.state as any).scheduleOccurrenceOverrides = (this.state as any).scheduleOccurrenceOverrides.filter((o: any) => o.id !== id);
    return found ?? null;
  }
  restoreScheduleOccurrenceOverride(o: unknown) {
    (this.state as any).scheduleOccurrenceOverrides = [...(this.state as any).scheduleOccurrenceOverrides, o];
  }
  deleteAssignment(id: string) {
    const found = (this.state as any).assignments.find((x: any) => x.id === id);
    if (!found) return null;
    (this.state as any).assignments = (this.state as any).assignments.filter((x: any) => x.id !== id);
    return { assignment: found, marks: [], studyBlocks: [], reminders: [] };
  }
  restoreAssignment(a: unknown) {
    (this.state as any).assignments = [...(this.state as any).assignments, a];
  }
  updateAssignment(a: Record<string, unknown>) {
    (this.state as any).assignments = (this.state as any).assignments.map((x: any) => (x.id === a.id ? a : x));
  }
  updateAssignmentPatch(id: string, patch: Record<string, unknown>) {
    (this.state as any).assignments = (this.state as any).assignments.map((x: any) => (x.id === id ? { ...x, ...patch } : x));
  }
  updateSchedule(s: Record<string, unknown>) {
    (this.state as any).schedules = (this.state as any).schedules.map((x: any) => (x.id === s.id ? s : x));
  }
  updateCourse(c: Record<string, unknown>) {
    (this.state as any).courses = (this.state as any).courses.map((x: any) => (x.id === c.id ? c : x));
  }
  excludeWeekFromSchedule() {}
  updateGroupProject() {}
  updateGroupMember() {}
  updateGroupTask() {}
  assignGroupTask() {}
  setGroupTaskDDL() {}
  toggleGroupTask() {}
  updateAssignmentPriority() {}
  updateAssignmentStatus() {}
  updateAssignmentProgress() {}
  toggleSubtask() {}
  addReminder() { return null; }
  updateReminder() {}
  deleteReminder() {}
  restoreReminder() {}
  reconcileTargetReminders() {}
  addScheduleSlot() { return ""; }
  deleteSchedule() { return null; }
  restoreSchedule() {}
  addCourseWithSchedule() { return ""; }
  addGroupProject() { return ""; }
  deleteGroupProject() {}
  addGroupMember() { return ""; }
  deleteGroupMember() { return { ok: true }; }
  addGroupTask() { return ""; }
  deleteGroupTask() {}
  startFocusSession() { return { ok: true as const, session: null }; }
  pauseFocusSession() { return { ok: true as const, session: null }; }
  resumeFocusSession() { return { ok: true as const, session: null }; }
  finishFocusSession() { return { ok: true as const, session: { actualActiveMs: 0 } }; }
  pushToast() {}
  registerUndo(toolCallId: string, undo: () => void) {
    this.undos.set(toolCallId, undo);
  }
}

function run(api: FakeApi, actions: ChangeSetActionInput[], confirm = async () => true) {
  return executeChangeSet({
    actions,
    state: api.getState(),
    api: api as unknown as KiroWriteApi,
    toolCallId: "tc-v2",
    confirm,
  });
}

describe("Change Set V2：create actions（reserved-ID 事务化）", () => {
  it("混合成功：create_assignment + move_schedule_occurrence + set_assignment_ddl 全部原子写入", async () => {
    const state = makeState();
    const api = new FakeApi(state);
    const res = await run(api, [
      {
        tool: "create_assignment",
        input: { courseId: "c1", title: "期中报告", ddl: "2026-08-20T23:59:00", estimatedMinutes: 90 },
      },
      {
        tool: "move_schedule_occurrence",
        input: { scheduleId: "s1", week: 6, dayOfWeek: 6, startTime: "14:00", endTime: "15:40" },
      },
      { tool: "set_assignment_ddl", input: { assignmentId: "a1", ddl: "2026-08-15T23:59:00" } },
    ] as never);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.applied).toBe(3);
    // 任务已创建（reserved id）
    expect((state as any).assignments.some((a: any) => a.title === "期中报告")).toBe(true);
    // override 已创建（move）
    const overrides = (state as any).scheduleOccurrenceOverrides;
    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toMatchObject({ kind: "move", week: 6, dayOfWeek: 6, startTime: "14:00" });
    // a1 DDL 已更新
    expect((state as any).assignments.find((a: any) => a.id === "a1").ddl).toBe("2026-08-15T23:59:00");
    // preview 中的 create action 提供 reservedId
    const createView = res.changeSet.actions.find((v) => v.tool === "create_assignment");
    expect(createView?.entityId).toMatch(/^a_/);
    expect(createView?.operation).toBe("create");
  });

  it("中间某一项无效 → 0 mutation（create 不部分写入）", async () => {
    const state = makeState();
    const before = JSON.stringify(state);
    const api = new FakeApi(state);
    const res = await run(api, [
      { tool: "create_assignment", input: { courseId: "c1", title: "报告" } },
      // 无效：move 到与 s2（周四 10:00–11:40）冲突的时间
      { tool: "move_schedule_occurrence", input: { scheduleId: "s1", week: 6, dayOfWeek: 4, startTime: "10:00", endTime: "11:40" } },
    ] as never);
    expect(res.ok).toBe(false);
    expect(res.applied).toBe(0);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("Preflight → Re-preflight：同一批 reservedIds 时 create 的实体 ID 完全一致", async () => {
    const state = makeState();
    const actions = [
      { tool: "create_assignment", input: { courseId: "c1", title: "报告" } },
      { tool: "move_schedule_occurrence", input: { scheduleId: "s1", week: 6, dayOfWeek: 5, startTime: "14:00", endTime: "15:40" } },
    ] as never;
    const reservedIds = reserveCreateIds(actions);
    const p1 = preflightChangeSet({ actions, reservedIds }, state);
    const p2 = preflightChangeSet({ actions, reservedIds }, state);
    expect(p1.ok && p2.ok).toBe(true);
    if (!p1.ok || !p2.ok) return;
    expect(p1.preview.map((v) => `${v.tool}:${v.entityId}`)).toEqual(
      p2.preview.map((v) => `${v.tool}:${v.entityId}`)
    );
  });

  it("Commit 使用 preflight 预留的同一 ID（view.entityId === 落库实体 id）", async () => {
    const state = makeState();
    const api = new FakeApi(state);
    const res = await run(api, [
      { tool: "create_assignment", input: { courseId: "c1", title: "报告" } },
      { tool: "create_extra_schedule_occurrence", input: { courseId: "c1", week: 7, dayOfWeek: 7, startTime: "19:00", endTime: "20:00" } },
    ] as never);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const createView = res.changeSet.actions.find((v) => v.tool === "create_assignment");
    expect(createView?.operation).toBe("create");
    expect((state as any).assignments.some((a: any) => a.id === createView?.entityId && a.title === "报告")).toBe(true);
    const occView = res.changeSet.actions.find((v) => v.tool === "create_extra_schedule_occurrence");
    expect((state as any).scheduleOccurrenceOverrides.some((o: any) => o.id === occView?.entityId && o.kind === "extra")).toBe(true);
  });

  it("Grouped Undo：一次撤销恢复创建（任务删除 + override 删除 + DDL 回退）", async () => {
    const state = makeState();
    const before = JSON.stringify(state);
    const api = new FakeApi(state);
    const res = await run(api, [
      { tool: "create_assignment", input: { courseId: "c1", title: "报告", ddl: "2026-08-20T23:59:00" } },
      { tool: "create_extra_schedule_occurrence", input: { courseId: "c1", week: 7, dayOfWeek: 7, startTime: "19:00", endTime: "20:00" } },
      { tool: "set_assignment_ddl", input: { assignmentId: "a1", ddl: "2026-08-15T23:59:00" } },
    ] as never);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(api.undos.size).toBe(1);
    api.undos.get("tc-v2")!();
    // 任务 + override 全被撤销；DDL 回退
    expect(JSON.stringify(state)).toBe(before);
  });

  it("preapproved-visual-proposal：normal/bulk 不弹 generic confirm 直接执行", async () => {
    const state = makeState();
    const api = new FakeApi(state);
    let confirmCalled = false;
    const res = await executeChangeSet({
      actions: [
        { tool: "create_assignment", input: { courseId: "c1", title: "视觉提案任务" } },
        { tool: "set_assignment_ddl", input: { assignmentId: "a1", ddl: "2026-08-14T23:59:00" } },
        { tool: "set_assignment_priority", input: { assignmentId: "a1", priority: "high" } },
        { tool: "set_assignment_status", input: { assignmentId: "a1", status: "doing" } },
        { tool: "set_assignment_progress", input: { assignmentId: "a1", progress: 10 } },
      ] as never,
      state: api.getState(),
      api: api as unknown as KiroWriteApi,
      toolCallId: "tc-visual",
      confirm: async () => {
        confirmCalled = true;
        return true;
      },
      confirmationMode: "preapproved-visual-proposal",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(confirmCalled).toBe(false); // 不重复确认
    expect((state as any).assignments.some((a: any) => a.title === "视觉提案任务")).toBe(true);
  });

  it("preapproved-visual-proposal + destructive → 拒绝", async () => {
    const state = makeState();
    const api = new FakeApi(state);
    const res = await executeChangeSet({
      actions: [
        { tool: "delete_assignment", input: { assignmentId: "a1" } },
      ] as never,
      state: api.getState(),
      api: api as unknown as KiroWriteApi,
      toolCallId: "tc-visual2",
      confirm: async () => true,
      confirmationMode: "preapproved-visual-proposal",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.applied).toBe(0);
    expect((state as any).assignments.some((a: any) => a.id === "a1")).toBe(true);
  });
});
