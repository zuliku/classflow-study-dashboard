import { describe, it, expect } from "vitest";
import { proposeVisualActionsTool } from "@/lib/ai/tools/read/executor";
import { ReadToolState } from "@/lib/ai/tools/read/executor";
import { buildVisualActionProposal, checkVisualProposalStale } from "@/lib/ai/visual/preflight";
import { executeVisualActionProposal } from "@/lib/ai/visual/executor";
import {
  isClassFlowMutationTool,
  VISUAL_PROPOSAL_REQUIRED_CODE,
} from "@/lib/ai/visual/guard";
import { KiroWriteApi } from "@/lib/ai/tools/write/types";
import { VisualActionProposal } from "@/lib/ai/visual/types";

function makeState() {
  return {
    userProfile: { name: "张三", college: "计科", grade: "2024", completedCredits: 10, totalCredits: 160 },
    semester: { id: "s", name: "测试学期", startDate: "2026-08-03", totalWeeks: 16 },
    currentSemesterWeek: 2,
    activeTab: "dashboard",
    selectedCourseId: null,
    selectedAssignmentId: null,
    highlightedAssignmentId: null,
    courses: [
      { id: "c1", name: "数据结构与算法", materials: [] },
      { id: "c2", name: "计算机网络", materials: [] },
    ],
    schedules: [
      { id: "s1", courseId: "c1", dayOfWeek: 3, startTime: "10:00", endTime: "11:40", location: "教101", weeks: "1-16周" },
      { id: "s2", courseId: "c2", dayOfWeek: 5, startTime: "14:00", endTime: "15:40", location: "教102", weeks: "1-16周" },
    ],
    assignments: [
      { id: "a1", courseId: "c1", title: "实验报告", description: "", ddl: "2026-08-17T22:00:00", priority: "medium", status: "todo", progress: 0, tags: [] },
    ],
    calendarMarks: [],
    groupProjects: [],
    studyBlocks: [],
    reminders: [],
    focusSessions: [],
    scheduleOccurrenceOverrides: [],
    preferences: {
      defaultTaskPriority: "medium",
      defaultTaskStatus: "todo",
      defaultDeadlineReminderMinutes: 30,
      defaultDDLTime: "23:59",
    },
  } as never;
}

type State = ReturnType<typeof makeState>;

const proposalInput = (over?: Partial<Parameters<typeof proposeVisualActionsTool>[1] & object>) => ({
  summary: "从截图整理出 3 项修改",
  attachmentIds: ["att_1"],
  actions: [
    {
      evidence: "实验报告请在下周一晚上10点前提交",
      attachmentId: "att_1",
      kind: "assignment-create",
      displayTitle: "实验报告",
      displaySubtitle: "数据结构与算法 · 8月17日 22:00",
      change: { tool: "create_assignment", input: { courseId: "c1", title: "数据结构实验报告", ddl: "2026-08-17T22:00:00", estimatedMinutes: 90 } },
    },
    {
      evidence: "本周三的数据结构课调到周六下午两点",
      attachmentId: "att_1",
      kind: "schedule-move",
      displayTitle: "临时调课",
      displaySubtitle: "数据结构与算法 · 第 2 周 · 周三 → 周六 14:00",
      change: { tool: "move_schedule_occurrence", input: { scheduleId: "s1", week: 2, dayOfWeek: 6, startTime: "14:00", endTime: "15:40", location: "教101" } },
    },
    {
      evidence: "实验报告提交时间改为 8月20日 23:59",
      attachmentId: "att_1",
      kind: "ddl-update",
      displayTitle: "调整截止时间",
      displaySubtitle: "实验报告 · 8月20日 23:59",
      change: { tool: "set_assignment_ddl", input: { assignmentId: "a1", ddl: "2026-08-20T23:59:00" } },
    },
  ],
  ...over,
});

const toolState = (state: State) => state as unknown as ReadToolState;

/** Fake API：执行现有 domain action 语义（无 setState 覆盖） */
class FakeApi {
  undos = new Map<string, () => void>();
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
  updateAssignmentPatch(id: string, patch: Record<string, unknown>) {
    (this.state as any).assignments = (this.state as any).assignments.map((x: any) => (x.id === id ? { ...x, ...patch } : x));
  }
  updateAssignment(a: Record<string, unknown>) {
    (this.state as any).assignments = (this.state as any).assignments.map((x: any) => (x.id === a.id ? a : x));
  }
  updateSchedule(s: Record<string, unknown>) {
    (this.state as any).schedules = (this.state as any).schedules.map((x: any) => (x.id === s.id ? s : x));
  }
  excludeWeekFromSchedule() {}
  updateCourse(c: Record<string, unknown>) {
    (this.state as any).courses = (this.state as any).courses.map((x: any) => (x.id === c.id ? c : x));
  }
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

describe("Visual Action Proposal：创建", () => {
  it("合法 resolved actions → 生成 Proposal；0 Store mutation", () => {
    const state = makeState();
    const before = JSON.stringify(state);
    const res = proposeVisualActionsTool(toolState(state), proposalInput());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const proposal = (res.data as { proposal: VisualActionProposal }).proposal;
    expect(proposal.actions).toHaveLength(3);
    expect(proposal.sourceAttachmentIds).toEqual(["att_1"]);
    expect(proposal.previewFingerprint.length).toBeGreaterThan(0);
    expect(proposal.reservedIds).toHaveLength(3);
    expect(proposal.actions[0].change.tool).toBe("create_assignment");
    expect(proposal.actions[0].evidence.text).toContain("实验报告");
    expect(JSON.stringify(state)).toBe(before);
  });

  it("unknown courseId → 拒绝（结构化失败，不出 Proposal）", () => {
    const state = makeState();
    const res = proposeVisualActionsTool(
      toolState(state),
      proposalInput({
        actions: [
          {
            evidence: "新任务",
            attachmentId: "att_1",
            kind: "assignment-create",
            displayTitle: "幽灵课任务",
            change: { tool: "create_assignment", input: { courseId: "ghost", title: "幽灵课任务" } },
          },
        ],
      } as never)
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("NOT_FOUND");
  });

  it("delete_assignment → VISUAL_UNSUPPORTED_ACTION", () => {
    const state = makeState();
    const res = proposeVisualActionsTool(
      toolState(state),
      proposalInput({
        actions: [
          {
            evidence: "删除任务",
            attachmentId: "att_1",
            kind: "assignment-update",
            displayTitle: "删除任务",
            change: { tool: "delete_assignment", input: { assignmentId: "a1" } },
          },
        ],
      } as never)
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("VISUAL_UNSUPPORTED_ACTION");
  });

  it("create_course → VISUAL_UNSUPPORTED_ACTION（不自动创建陌生课程）", () => {
    const state = makeState();
    const res = proposeVisualActionsTool(
      toolState(state),
      proposalInput({
        actions: [
          {
            evidence: "新课程",
            attachmentId: "att_1",
            kind: "assignment-update",
            displayTitle: "新课程",
            change: { tool: "create_course", input: { name: "计网实验" } },
          },
        ],
      } as never)
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("VISUAL_UNSUPPORTED_ACTION");
  });

  it("9 项操作 → schema 拒绝（继承 MAX_CHANGE_SET_ACTIONS=8）", () => {
    const state = makeState();
    const res = proposeVisualActionsTool(
      toolState(state),
      proposalInput({
        actions: Array.from({ length: 9 }, (_, i) => ({
          evidence: `任务${i}`,
          attachmentId: "att_1",
          kind: "assignment-create",
          displayTitle: `任务${i}`,
          change: { tool: "create_assignment", input: { courseId: "c1", title: `任务${i}` } },
        })),
      } as never)
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("INVALID_INPUT");
  });

  it("evidence 超过 160 chars → INVALID_INPUT（不保存整张 OCR）", () => {
    const state = makeState();
    const res = proposeVisualActionsTool(
      toolState(state),
      proposalInput({
        actions: [
          {
            evidence: "很长的截图原文".repeat(30),
            attachmentId: "att_1",
            kind: "assignment-create",
            displayTitle: "任务",
            change: { tool: "create_assignment", input: { courseId: "c1", title: "任务" } },
          },
        ],
      } as never)
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("INVALID_INPUT");
  });

  it("重复（course+title+ddl 完全相同）→ VISUAL_DUPLICATE_ASSIGNMENT（改为 update）", () => {
    const state = makeState();
    const res = proposeVisualActionsTool(
      toolState(state),
      proposalInput({
        actions: [
          {
            evidence: "实验报告请在17号交",
            attachmentId: "att_1",
            kind: "assignment-create",
            displayTitle: "实验报告",
            change: { tool: "create_assignment", input: { courseId: "c1", title: "实验报告", ddl: "2026-08-17T22:00:00" } },
          },
        ],
      } as never)
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("VISUAL_DUPLICATE_ASSIGNMENT");
  });

  it("临时调课目标与另一课程冲突 → Proposal 创建即失败（不给不可应用的卡）", () => {
    const state = makeState();
    // s2（c2 计算机网络）移到周六 14:00–15:40 与调课目标冲突
    (state as any).schedules = (state as any).schedules.map((s: any) =>
      s.id === "s2" ? { ...s, dayOfWeek: 6 } : s
    );
    const res = proposeVisualActionsTool(
      toolState(state),
      proposalInput({
        actions: [
          {
            evidence: "调到周六下午两点",
            attachmentId: "att_1",
            kind: "schedule-move",
            displayTitle: "临时调课",
            change: { tool: "move_schedule_occurrence", input: { scheduleId: "s1", week: 2, dayOfWeek: 6, startTime: "14:00", endTime: "15:40" } },
          },
        ],
      } as never)
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("CONFLICT");
  });
});

describe("Visual Action Proposal：fingerprint / stale", () => {
  it("同一状态 → 不 stale；数据变化（DDL 修改）→ stale", () => {
    const state = makeState();
    const built = buildVisualActionProposal(proposalInput() as never, state);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const { proposal } = built;

    const same = checkVisualProposalStale(proposal, state);
    expect(same.stale).toBe(false);

    // 修改 a1 的 DDL（与方案相关的实体）
    const changed = makeState();
    (changed as any).assignments = (changed as any).assignments.map((a: any) =>
      a.id === "a1" ? { ...a, ddl: "2026-09-01T00:00:00" } : a
    );
    const stale = checkVisualProposalStale(proposal, changed);
    expect(stale.stale).toBe(true);
  });

  it("无关实体变化（c2 课程名）→ 不 stale", () => {
    const state = makeState();
    const built = buildVisualActionProposal(proposalInput() as never, state);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const changed = makeState();
    (changed as any).courses = (changed as any).courses.map((c: any) =>
      c.id === "c2" ? { ...c, name: "计算机网络（改名）" } : c
    );
    const stale = checkVisualProposalStale(built.proposal, changed);
    expect(stale.stale).toBe(false);
  });
});

describe("Visual Action Proposal：Apply", () => {
  it("混合方案（create + move occurrence + update ddl）→ 全部原子提交；一次 Undo 全部恢复", async () => {
    const state = makeState();
    const before = JSON.stringify(state);
    const built = buildVisualActionProposal(proposalInput() as never, state);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const api = new FakeApi(state);
    const res = await executeVisualActionProposal({
      proposal: built.proposal,
      state,
      api: api as unknown as KiroWriteApi,
      confirm: async () => true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.applied).toBe(3);
    // 全部提交
    expect((state as any).assignments.some((a: any) => a.title === "数据结构实验报告")).toBe(true);
    expect((state as any).scheduleOccurrenceOverrides).toHaveLength(1);
    expect((state as any).scheduleOccurrenceOverrides[0].kind).toBe("move");
    expect((state as any).assignments.find((a: any) => a.id === "a1").ddl).toBe("2026-08-20T23:59:00");
    // grouped Undo：一次恢复
    expect(api.undos.has(built.proposal.id)).toBe(true);
    api.undos.get(built.proposal.id)!();
    expect(JSON.stringify(state)).toBe(before);
  });

  it("Apply 前数据变化 → stale，0 mutation", async () => {
    const state = makeState();
    const built = buildVisualActionProposal(proposalInput() as never, state);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // Apply 前 a1 的 DDL 被其他途径修改
    const changed = makeState();
    (changed as any).assignments = (changed as any).assignments.map((a: any) =>
      a.id === "a1" ? { ...a, ddl: "2026-09-01T00:00:00" } : a
    );
    const api = new FakeApi(changed);
    const res = await executeVisualActionProposal({
      proposal: built.proposal,
      state: changed,
      api: api as unknown as KiroWriteApi,
      confirm: async () => true,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.stale).toBe(true);
    expect(res.applied).toBe(0);
    expect((changed as any).scheduleOccurrenceOverrides).toHaveLength(0);
    expect((changed as any).assignments.some((a: any) => a.title === "数据结构实验报告")).toBe(false);
  });

  it("Apply 不再次弹 generic confirm（confirm 调用即返回 true；无二次确认 UI）", async () => {
    const state = makeState();
    const built = buildVisualActionProposal(proposalInput() as never, state);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const api = new FakeApi(state);
    let confirmCalls = 0;
    const res = await executeVisualActionProposal({
      proposal: built.proposal,
      state,
      api: api as unknown as KiroWriteApi,
      confirm: async () => {
        confirmCalls += 1;
        return true;
      },
    });
    expect(res.ok).toBe(true);
    // 执行链内部不产生任何 confirm 请求（preapproved-visual-proposal 跳过 generic confirm）
    expect(confirmCalls).toBe(0);
  });
});

describe("Visual Turn Mutation Guard", () => {
  it("图片回合：直接调用写工具 → 必须拒绝（VISUAL_PROPOSAL_REQUIRED）", () => {
    // Guard 由 useKiroChat onToolCall 分支调用 isClassFlowMutationTool + turnHasImageRef；
    // 这里验证 deterministic 判定函数
    expect(isClassFlowMutationTool("create_assignment")).toBe(true);
    expect(isClassFlowMutationTool("move_schedule")).toBe(true);
    expect(isClassFlowMutationTool("apply_change_set")).toBe(true);
    expect(isClassFlowMutationTool("delete_assignment")).toBe(true);
    expect(VISUAL_PROPOSAL_REQUIRED_CODE).toBe("VISUAL_PROPOSAL_REQUIRED");
  });

  it("Guard 不阻止：Read Tools / propose_visual_actions / final answer / Computer 工具", () => {
    expect(isClassFlowMutationTool("get_courses")).toBe(false);
    expect(isClassFlowMutationTool("propose_visual_actions")).toBe(false);
    expect(isClassFlowMutationTool("begin_final_answer")).toBe(false);
    expect(isClassFlowMutationTool("computer_create_text_file")).toBe(false);
    expect(isClassFlowMutationTool("save_memory")).toBe(false);
  });
});
