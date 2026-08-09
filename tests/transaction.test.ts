import { describe, it, expect } from "vitest";
import { preflightChangeSet, changeSetRequiresConfirm, changeSetConfirmText } from "@/lib/ai/transactions/preflight";
import { executeChangeSet } from "@/lib/ai/transactions/executor";
import { MAX_CHANGE_SET_ACTIONS, ChangeSetActionInput } from "@/lib/ai/transactions/types";
import { messageHasWriteToolCalls } from "@/hooks/useKiroChat";
import { KiroWriteApi } from "@/lib/ai/tools/write/types";

function makeState() {
  return {
    semester: { id: "s", name: "测试学期", startDate: "2026-08-03", totalWeeks: 16 },
    courses: [{ id: "c1", name: "统计学", materials: [] }],
    schedules: [
      { id: "s1", courseId: "c1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "教101", weeks: "1-16周" },
      { id: "s2", courseId: "c1", dayOfWeek: 2, startTime: "10:00", endTime: "11:40", location: "教102", weeks: "1-16周" },
    ],
    assignments: [
      { id: "a1", courseId: "c1", title: "统计作业1", description: "", ddl: "2026-08-10T23:59:00", priority: "medium", status: "todo", progress: 0, tags: [] },
      { id: "a2", courseId: "c1", title: "统计作业2", description: "", ddl: "2026-08-11T23:59:00", priority: "low", status: "todo", progress: 0, tags: [] },
      { id: "a3", courseId: "c1", title: "统计作业3", description: "", ddl: "2026-08-12T23:59:00", priority: "high", status: "doing", progress: 50, tags: [] },
    ],
    calendarMarks: [],
    groupProjects: [
      {
        id: "gp1", courseId: "c1", title: "小组项目", description: "", progress: 0, updatedAt: "2026-08-01T00:00:00Z",
        members: [
          { id: "gm1", name: "张三", role: "leader", major: "统计" },
          { id: "gm2", name: "李四", role: "member", major: "金融" },
        ],
        tasks: [{ id: "gt1", title: "数据收集", assigneeId: "gm1", ddl: "2026-08-20T20:00:00", completed: false }],
      },
    ],
    preferences: { defaultTaskPriority: "medium", defaultTaskStatus: "todo" },
  } as never;
}

type State = ReturnType<typeof makeState>;

/** Fake API：对可变 state 执行现有 domain action 语义（无 setState 覆盖） */
class FakeApi {
  undos = new Map<string, () => void>();
  throwOnUpdateAssignmentId: string | null = null;
  constructor(private state: State) {}
  getState() {
    return this.state as never;
  }
  updateAssignment(a: { id: string } & Record<string, unknown>) {
    if (this.throwOnUpdateAssignmentId === a.id) throw new Error("boom");
    (this.state as any).assignments = (this.state as any).assignments.map((x: any) => (x.id === a.id ? a : x));
  }
  updateAssignmentPriority(id: string, p: string) {
    (this.state as any).assignments = (this.state as any).assignments.map((x: any) => (x.id === id ? { ...x, priority: p } : x));
  }
  updateAssignmentStatus(id: string, s: string) {
    (this.state as any).assignments = (this.state as any).assignments.map((x: any) => (x.id === id ? { ...x, status: s } : x));
  }
  updateAssignmentProgress(id: string, p: number) {
    (this.state as any).assignments = (this.state as any).assignments.map((x: any) => (x.id === id ? { ...x, progress: p } : x));
  }
  toggleSubtask() {}
  deleteAssignment(id: string) {
    const arr: any[] = (this.state as any).assignments;
    const found = arr.find((x) => x.id === id);
    if (!found) return null;
    (this.state as any).assignments = arr.filter((x) => x.id !== id);
    return { assignment: found, marks: [] };
  }
  restoreAssignment(a: unknown) {
    (this.state as any).assignments = [...(this.state as any).assignments, a];
  }
  updateSchedule(s: Record<string, unknown>) {
    (this.state as any).schedules = (this.state as any).schedules.map((x: any) => (x.id === s.id ? s : x));
  }
  deleteSchedule(id: string) {
    const arr: any[] = (this.state as any).schedules;
    const found = arr.find((x) => x.id === id);
    if (!found) return null;
    (this.state as any).schedules = arr.filter((x) => x.id !== id);
    return found;
  }
  restoreSchedule(s: unknown) {
    (this.state as any).schedules = [...(this.state as any).schedules, s];
  }
  excludeWeekFromSchedule() {}
  updateCourse(c: Record<string, unknown>) {
    (this.state as any).courses = (this.state as any).courses.map((x: any) => (x.id === c.id ? c : x));
  }
  updateGroupProject(id: string, patch: Record<string, unknown>) {
    (this.state as any).groupProjects = (this.state as any).groupProjects.map((p: any) => (p.id === id ? { ...p, ...patch } : p));
  }
  updateGroupMember(projectId: string, m: Record<string, unknown>) {
    (this.state as any).groupProjects = (this.state as any).groupProjects.map((p: any) =>
      p.id === projectId ? { ...p, members: p.members.map((x: any) => (x.id === m.id ? m : x)) } : p
    );
  }
  updateGroupTask(projectId: string, t: Record<string, unknown>) {
    (this.state as any).groupProjects = (this.state as any).groupProjects.map((p: any) =>
      p.id === projectId ? { ...p, tasks: p.tasks.map((x: any) => (x.id === t.id ? t : x)) } : p
    );
  }
  toggleGroupTask() {}
  pushToast() {}
  registerUndo(toolCallId: string, undo: () => void) {
    this.undos.set(toolCallId, undo);
  }
}

const ddl = (id: string, d: string) => ({ tool: "set_assignment_ddl" as const, input: { assignmentId: id, ddl: d } });

function run(api: FakeApi, actions: ChangeSetActionInput[], summary?: string) {
  return executeChangeSet({
    actions,
    summary,
    state: api.getState(),
    api: api as never,
    toolCallId: "tc-1",
    confirm: async () => true,
  });
}

describe("Change Set Preflight", () => {
  it("全部成功：3 个 DDL 全部更新", async () => {
    const state = makeState();
    const api = new FakeApi(state);
    const res = await run(api, [
      ddl("a1", "2026-08-11T23:59:00"),
      ddl("a2", "2026-08-12T23:59:00"),
      ddl("a3", "2026-08-13T23:59:00"),
    ]);
    expect(res.ok).toBe(true);
    expect((state as any).assignments.map((a: any) => a.ddl)).toEqual([
      "2026-08-11T23:59:00", "2026-08-12T23:59:00", "2026-08-13T23:59:00",
    ]);
  });

  it("第 2 项 ID 无效 → 0 mutation", async () => {
    const state = makeState();
    const before = JSON.stringify(state);
    const api = new FakeApi(state);
    const res = await run(api, [ddl("a1", "2026-08-11T23:59:00"), ddl("nope", "2026-08-12T23:59:00")]);
    expect(res.ok).toBe(false);
    expect(res.applied).toBe(0);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("课表冲突 → 0 mutation", async () => {
    const state = makeState();
    const before = JSON.stringify(state);
    const api = new FakeApi(state);
    const res = await run(api, [
      { tool: "move_schedule", input: { scheduleId: "s1", dayOfWeek: 2, startTime: "10:00" } },
    ] as never);
    expect(res.ok).toBe(false);
    expect(res.applied).toBe(0);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("Projected State：前序修改对后续预检可见；错误顺序被拒绝", async () => {
    // s1=周一08:00, s2=周二10:00, s3=周三14:00；周一 10:00 空闲
    const state = makeState();
    (state as any).schedules.push({ id: "s3", courseId: "c1", dayOfWeek: 3, startTime: "14:00", endTime: "15:40", location: "教103", weeks: "1-16周" });
    const api = new FakeApi(state);
    // 顺序 1：先移走 s2 → 周一 10:00（空闲）→ 再移 s1 → 周二 10:00（投影后 s2 已离开，合法）
    const res = await run(api, [
      { tool: "move_schedule", input: { scheduleId: "s2", dayOfWeek: 1, startTime: "10:00" } },
      { tool: "move_schedule", input: { scheduleId: "s1", dayOfWeek: 2, startTime: "10:00" } },
    ] as never);
    expect(res.ok).toBe(true);
    expect((state as any).schedules.find((s: any) => s.id === "s1").dayOfWeek).toBe(2);
    // 顺序 2：先占 s2 位置 → 冲突（对初始 Store 逐项检查会误判为通过，投影检查正确拦截）
    const state2 = makeState();
    (state2 as any).schedules.push({ id: "s3", courseId: "c1", dayOfWeek: 3, startTime: "14:00", endTime: "15:40", location: "教103", weeks: "1-16周" });
    const api2 = new FakeApi(state2);
    const res2 = await run(api2, [
      { tool: "move_schedule", input: { scheduleId: "s1", dayOfWeek: 2, startTime: "10:00" } },
      { tool: "move_schedule", input: { scheduleId: "s2", dayOfWeek: 1, startTime: "10:00" } },
    ] as never);
    expect(res2.ok).toBe(false);
    expect((state2 as any).schedules.find((s: any) => s.id === "s1").dayOfWeek).toBe(1); // 未变
  });

  it("Last Leader：Change Set 降级唯一负责人 → 整体拒绝", async () => {
    const state = makeState();
    const before = JSON.stringify(state);
    const api = new FakeApi(state);
    const res = await run(api, [
      { tool: "update_group_member", input: { projectId: "gp1", memberId: "gm1", role: "member" } },
      ddl("a1", "2026-08-11T23:59:00"),
    ] as never);
    expect(res.ok).toBe(false);
    expect(res.applied).toBe(0);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("基线完整性：初始已有 fatal 时，不新增 fatal 的 Change Set 照常通过", async () => {
    const state = makeState();
    (state as any).schedules.push({ id: "orphan", courseId: "ghost", dayOfWeek: 3, startTime: "08:00", endTime: "09:40", location: "", weeks: "1-16周" });
    const preflight = preflightChangeSet({ actions: [ddl("a1", "2026-08-11T23:59:00")] }, state);
    expect(preflight.ok).toBe(true);
  });

  it("9 项操作 → 直接拒绝（写上限）", async () => {
    const state = makeState();
    const actions = Array.from({ length: 9 }, (_, i) => ddl(`a${(i % 3) + 1}`, `2026-08-2${i}T23:59:00`));
    const preflight = preflightChangeSet({ actions: actions as never }, state);
    expect(preflight.ok).toBe(false);
    if (!preflight.ok) expect(preflight.code).toBe("TRANSACTION_TOO_LARGE");
    expect(MAX_CHANGE_SET_ACTIONS).toBe(8);
  });

  it("同实体同字段重复写 → contradictory", async () => {
    const state = makeState();
    const preflight = preflightChangeSet(
      { actions: [ddl("a1", "2026-08-11T23:59:00"), ddl("a1", "2026-08-12T23:59:00")] },
      state
    );
    expect(preflight.ok).toBe(false);
    if (!preflight.ok) expect(preflight.code).toBe("TRANSACTION_CONTRADICTORY");
  });
});

describe("Change Set Executor", () => {
  it("commit 运行时失败 → 自动逆序回滚，Store 与执行前一致", async () => {
    const state = makeState();
    const before = JSON.stringify(state);
    const api = new FakeApi(state);
    api.throwOnUpdateAssignmentId = "a3";
    const res = await run(api, [ddl("a1", "2026-08-11T23:59:00"), ddl("a2", "2026-08-12T23:59:00"), ddl("a3", "2026-08-13T23:59:00")]);
    expect(res.ok).toBe(false);
    expect(res.applied).toBe(0);
    expect(JSON.stringify(state)).toBe(before); // a1/a2 已回滚
  });

  it("成功只注册一个整体 Undo；执行一次全部恢复", async () => {
    const state = makeState();
    const before = JSON.stringify(state);
    const api = new FakeApi(state);
    const res = await run(api, [ddl("a1", "2026-08-11T23:59:00"), ddl("a2", "2026-08-12T23:59:00"), ddl("a3", "2026-08-13T23:59:00")]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.changeSet.count).toBe(3);
    expect(api.undos.size).toBe(1); // 单个 grouped Undo
    api.undos.get("tc-1")!();
    expect(JSON.stringify(state)).toBe(before); // 一次撤销全部恢复
  });

  it("destructive 取消确认 → 0 mutation + USER_CANCELLED", async () => {
    const state = makeState();
    const before = JSON.stringify(state);
    const api = new FakeApi(state);
    const res = await executeChangeSet({
      actions: [{ tool: "delete_assignment", input: { assignmentId: "a1" } }, ddl("a2", "2026-08-12T23:59:00")] as never,
      state: api.getState(),
      api: api as never,
      toolCallId: "tc-2",
      confirm: async () => false,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("USER_CANCELLED");
    expect(res.applied).toBe(0);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("确认期间数据变化 → re-preflight 拦截，0 mutation", async () => {
    const state = makeState();
    const api = new FakeApi(state);
    const res = await executeChangeSet({
      // destructive（删除）→ 必须确认；计划把 s1 移到周三 14:00（初始空闲）
      actions: [
        { tool: "delete_assignment", input: { assignmentId: "a3" } },
        { tool: "move_schedule", input: { scheduleId: "s1", dayOfWeek: 3, startTime: "14:00" } },
      ] as never,
      state: api.getState(),
      api: api as never,
      toolCallId: "tc-3",
      confirm: async () => {
        // 确认期间用户把 s2 也移到了周三 14:00（占用目标时段 → re-preflight 必须失败）
        api.updateSchedule({ ...(state as any).schedules[1], dayOfWeek: 3, startTime: "14:00", endTime: "15:40" });
        return true;
      },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("TRANSACTION_REPREFLIGHT_FAILED");
    expect(res.applied).toBe(0);
    // s1 未被移动；a3 未被删除（0 mutation）
    expect((state as any).schedules.find((s: any) => s.id === "s1").dayOfWeek).toBe(1);
    expect((state as any).assignments.some((a: any) => a.id === "a3")).toBe(true);
  });
});

describe("Risk & Regenerate", () => {
  it("Risk 由 ClassFlow 计算：destructive / bulk / normal", () => {
    const state = makeState();
    const destructive = preflightChangeSet({ actions: [{ tool: "delete_assignment", input: { assignmentId: "a1" } }] as never }, state);
    expect(destructive.ok && destructive.risk).toBe("destructive");
    expect(destructive.ok && changeSetRequiresConfirm(destructive.risk)).toBe(true);
    const bulk = preflightChangeSet(
      {
        actions: [
          ddl("a1", "2026-08-11T23:59:00"),
          ddl("a2", "2026-08-12T23:59:00"),
          ddl("a3", "2026-08-13T23:59:00"),
          { tool: "set_assignment_priority", input: { assignmentId: "a1", priority: "high" } },
          { tool: "set_assignment_priority", input: { assignmentId: "a2", priority: "urgent" } },
        ] as never,
      },
      state
    );
    expect(bulk.ok && bulk.risk).toBe("bulk");
    const normal = preflightChangeSet({ actions: [ddl("a1", "2026-08-11T23:59:00")] }, state);
    expect(normal.ok && normal.risk).toBe("normal");
    expect(normal.ok && changeSetRequiresConfirm(normal.risk)).toBe(false);
  });

  it("确认文案不暴露 tool name / JSON", () => {
    const lines = changeSetConfirmText([
      { entityType: "assignment", operation: "update", tool: "set_assignment_ddl" },
      { entityType: "assignment", operation: "update", tool: "set_assignment_priority" },
      { entityType: "schedule", operation: "update", tool: "move_schedule" },
    ]);
    expect(lines).toEqual(["调整任务截止时间 1 项", "修改任务优先级 1 项", "移动课程 1 项"]);
    expect(JSON.stringify(lines)).not.toContain("set_assignment_ddl");
  });

  it("apply_change_set 属于 Write Turn → 禁止 Regenerate", () => {
    expect(messageHasWriteToolCalls({ parts: [{ type: "tool-apply_change_set" }] } as never)).toBe(true);
  });
});
