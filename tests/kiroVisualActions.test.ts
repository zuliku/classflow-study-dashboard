import { describe, it, expect } from "vitest";
import { proposeVisualActionsTool } from "@/lib/ai/tools/read/executor";
import { ReadToolState } from "@/lib/ai/tools/read/executor";
import { buildVisualActionProposal, checkVisualProposalStale } from "@/lib/ai/visual/preflight";
import { executeVisualActionProposal } from "@/lib/ai/visual/executor";
import {
  isClassFlowMutationTool,
  visualProposalRequired,
  VISUAL_PROPOSAL_REQUIRED_CODE,
} from "@/lib/ai/visual/guard";
import {
  buildVisualPendingContinuation,
  isVisualPendingCancel,
  normalizeVisualPendingContinuation,
} from "@/lib/ai/visual/continuation";
import { proposeVisualActionsInputSchema } from "@/lib/ai/visual/schemas";
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
  actions: [
    {
      evidence: "实验报告请在下周一晚上10点前提交",
      change: { tool: "create_assignment", input: { courseId: "c1", title: "数据结构实验报告", ddl: "2026-08-17T22:00:00", estimatedMinutes: 90 } },
    },
    {
      evidence: "本周三的数据结构课调到周六下午两点",
      change: { tool: "move_schedule_occurrence", input: { scheduleId: "s1", week: 2, dayOfWeek: 6, startTime: "14:00", endTime: "15:40", location: "教101" } },
    },
    {
      evidence: "实验报告提交时间改为 8月20日 23:59",
      change: { tool: "set_assignment_ddl", input: { assignmentId: "a1", ddl: "2026-08-20T23:59:00" } },
    },
  ],
  ...over,
});

/** V1.1：propose_visual_actions 必须带 Runtime trusted source（frozen turn image IDs） */
const SOURCE = { visualSourceAttachmentIds: ["att-real-1"] as const };

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
    const res = proposeVisualActionsTool(toolState(state), proposalInput(), SOURCE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const proposal = (res.data as { proposal: VisualActionProposal }).proposal;
    expect(proposal.actions).toHaveLength(3);
    expect(proposal.sourceAttachmentIds).toEqual(["att-real-1"]);
    expect(proposal.previewFingerprint?.length ?? 0).toBeGreaterThan(0);
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
            change: { tool: "create_assignment", input: { courseId: "ghost", title: "幽灵课任务" } },
          },
        ],
      } as never),
      SOURCE
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
            change: { tool: "delete_assignment", input: { assignmentId: "a1" } },
          },
        ],
      } as never),
      SOURCE
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
            change: { tool: "create_course", input: { name: "计网实验" } },
          },
        ],
      } as never),
      SOURCE
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
          change: { tool: "create_assignment", input: { courseId: "c1", title: `任务${i}` } },
        })),
      } as never),
      SOURCE
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
            change: { tool: "create_assignment", input: { courseId: "c1", title: "任务" } },
          },
        ],
      } as never),
      SOURCE
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
            change: { tool: "create_assignment", input: { courseId: "c1", title: "实验报告", ddl: "2026-08-17T22:00:00" } },
          },
        ],
      } as never),
      SOURCE
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
            change: { tool: "move_schedule_occurrence", input: { scheduleId: "s1", week: 2, dayOfWeek: 6, startTime: "14:00", endTime: "15:40" } },
          },
        ],
      } as never),
      SOURCE
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("CONFLICT");
  });
});

describe("Visual Action Proposal：fingerprint / stale", () => {
  it("同一状态 → 不 stale；数据变化（DDL 修改）→ stale", () => {
    const state = makeState();
    const built = buildVisualActionProposal(proposalInput() as never, state, { sourceAttachmentIds: ["att-real-1"] });
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
    const built = buildVisualActionProposal(proposalInput() as never, state, { sourceAttachmentIds: ["att-real-1"] });
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
    const built = buildVisualActionProposal(proposalInput() as never, state, { sourceAttachmentIds: ["att-real-1"] });
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
    const built = buildVisualActionProposal(proposalInput() as never, state, { sourceAttachmentIds: ["att-real-1"] });
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
    const built = buildVisualActionProposal(proposalInput() as never, state, { sourceAttachmentIds: ["att-real-1"] });
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
    // Guard 由 useKiroChat onToolCall 分支按 turnImageAttachmentIdsRef.length > 0 触发；
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

describe("V1.1 Trusted Visual Source", () => {
  it("无 trusted source → VISUAL_SOURCE_REQUIRED，0 Proposal", () => {
    const state = makeState();
    const res = proposeVisualActionsTool(toolState(state), proposalInput(), {});
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("VISUAL_SOURCE_REQUIRED");
    expect(res.message).toContain("没有可用的图片来源");
  });

  it("模型不能 spoof attachment：schema 中不存在 attachmentIds/attachmentId → strict 拒绝", () => {
    const state = makeState();
    const spoofed = {
      summary: "从截图整理出 3 项修改",
      attachmentIds: ["att-spoof"],
      actions: [
        {
          evidence: "实验报告请在下周一晚上10点前提交",
          attachmentId: "att-spoof",
          change: { tool: "create_assignment", input: { courseId: "c1", title: "任务" } },
        },
      ],
    };
    const res = proposeVisualActionsTool(toolState(state), spoofed as never, SOURCE);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("INVALID_INPUT");
  });

  it("模型不能提供 kind/displayTitle/displaySubtitle：strict 拒绝", () => {
    const state = makeState();
    const spoofed = {
      summary: "从截图整理出 1 项修改",
      actions: [
        {
          evidence: "事实",
          kind: "schedule-cancel",
          displayTitle: "伪造标题",
          displaySubtitle: "伪造副标题",
          change: { tool: "cancel_schedule_occurrence", input: { scheduleId: "s1", week: 3 } },
        },
      ],
    };
    const res = proposeVisualActionsTool(toolState(state), spoofed as never, SOURCE);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("INVALID_INPUT");
  });

  it("Proposal source = Runtime 冻结 IDs（模型无输入渠道）", () => {
    const state = makeState();
    const res = proposeVisualActionsTool(
      toolState(state),
      proposalInput(),
      { visualSourceAttachmentIds: ["att_real_1", "att_real_2", "att_real_3"] }
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const proposal = (res.data as { proposal: VisualActionProposal }).proposal;
    expect(proposal.sourceAttachmentIds).toEqual(["att_real_1", "att_real_2", "att_real_3"]);
  });
});

describe("V1.1 Preflight-Owned Fact UI", () => {
  it("create_assignment display 完全来自真实 Preview（title/course/DDL）", () => {
    const state = makeState();
    const res = proposeVisualActionsTool(toolState(state), proposalInput(), SOURCE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const proposal = (res.data as { proposal: VisualActionProposal }).proposal;
    const create = proposal.actions.find((a) => a.change.tool === "create_assignment");
    expect(create?.display.kind).toBe("assignment-create");
    expect(create?.display.title).toBe("数据结构实验报告");
    // 模型没有任何字段可以把 DDL 写成别的
    expect(create?.display.subtitle).toContain("数据结构与算法");
    expect(create?.display.subtitle).toContain("8月17日 22:00");
  });

  it("move_schedule_occurrence display：第 N 周 · 周三 10:00 → 周六 14:00（与真实 mutation 一致）", () => {
    const state = makeState();
    const res = proposeVisualActionsTool(toolState(state), proposalInput(), SOURCE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const proposal = (res.data as { proposal: VisualActionProposal }).proposal;
    const move = proposal.actions.find((a) => a.change.tool === "move_schedule_occurrence");
    expect(move?.display.kind).toBe("schedule-move");
    expect(move?.display.title).toBe("数据结构与算法");
    expect(move?.display.subtitle).toBe("第 2 周 · 周三 10:00 → 周六 14:00");
  });

  it("set_assignment_ddl display：before → after（真实新旧 DDL）", () => {
    const state = makeState();
    const res = proposeVisualActionsTool(toolState(state), proposalInput(), SOURCE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const proposal = (res.data as { proposal: VisualActionProposal }).proposal;
    const ddl = proposal.actions.find((a) => a.change.tool === "set_assignment_ddl");
    expect(ddl?.display.kind).toBe("ddl-update");
    expect(ddl?.display.title).toBe("实验报告");
    expect(ddl?.display.subtitle).toBe("8月17日 22:00 → 8月20日 23:59");
  });

  it("cancel / extra / permanent display 语义正确（永久调整明确标注）", () => {
    const state = makeState();
    const res = proposeVisualActionsTool(
      toolState(state),
      {
        summary: "从截图整理出 3 项修改",
        actions: [
          { evidence: "本周三停课", change: { tool: "cancel_schedule_occurrence", input: { scheduleId: "s1", week: 3 } } },
          { evidence: "周日补课", change: { tool: "create_extra_schedule_occurrence", input: { courseId: "c2", week: 6, dayOfWeek: 7, startTime: "19:00", endTime: "20:40" } } },
          { evidence: "以后都改到周五下午", change: { tool: "move_schedule", input: { scheduleId: "s1", dayOfWeek: 5, startTime: "16:00" } } },
        ],
      } as never,
      SOURCE
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const proposal = (res.data as { proposal: VisualActionProposal }).proposal;
    const cancel = proposal.actions[0];
    expect(cancel.display.kind).toBe("schedule-cancel");
    expect(cancel.display.subtitle).toContain("第 3 周 · 周三 10:00–11:40 · 停课");
    const extra = proposal.actions[1];
    expect(extra.display.kind).toBe("schedule-extra");
    expect(extra.display.subtitle).toContain("第 6 周 · 周日 19:00–20:40 · 临时补课");
    const permanent = proposal.actions[2];
    expect(permanent.display.kind).toBe("schedule-permanent-update");
    expect(permanent.display.subtitle).toContain("永久调整排课");
    expect(permanent.display.subtitle).toContain("周三 10:00 → 周五 16:00");
  });

  it("evidence 仍来自模型（Vision extraction），且只描述原因", () => {
    const state = makeState();
    const res = proposeVisualActionsTool(toolState(state), proposalInput(), SOURCE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const proposal = (res.data as { proposal: VisualActionProposal }).proposal;
    expect(proposal.actions[0].evidence.text).toBe("实验报告请在下周一晚上10点前提交");
  });
});

/** V1.2：mixed 输入（2 executable + 1 ambiguous + 1 unsupported） */
const mixedInput = () => ({
  summary: "从截图整理出 3 项",
  actions: [proposalInput().actions[0], proposalInput().actions[1]],
  pendingItems: [
    { reason: "ambiguous-entity" as const, evidence: "王老师那门课改到周六下午", description: "无法唯一确定对应课程" },
    { reason: "unsupported-action" as const, evidence: "把通知转发到班群", description: "当前不支持发送外部消息" },
  ],
});

describe("V1.2 Partial Proposals：schema", () => {
  const base = (over: object) => ({ summary: "从截图整理出", actions: [], ...over });

  it("executable only（actions=2, pending=0）→ valid", () => {
    const parsed = proposeVisualActionsInputSchema.safeParse(
      base({ actions: [proposalInput().actions[0], proposalInput().actions[1]] })
    );
    expect(parsed.success).toBe(true);
  });

  it("mixed（actions=2, pending=1）→ valid", () => {
    const parsed = proposeVisualActionsInputSchema.safeParse(
      base({
        actions: [proposalInput().actions[0], proposalInput().actions[1]],
        pendingItems: [{ reason: "ambiguous-entity", evidence: "王老师那门课改到周六下午", description: "无法唯一确定对应课程" }],
      })
    );
    expect(parsed.success).toBe(true);
  });

  it("pending only（actions=0, pending=2）→ valid", () => {
    const parsed = proposeVisualActionsInputSchema.safeParse(
      base({
        pendingItems: [
          { reason: "ambiguous-entity", evidence: "英语作业周三交", description: "无法唯一确定对应课程" },
          { reason: "unsupported-action", evidence: "把通知转发到班群", description: "当前不支持发送外部消息" },
        ],
      })
    );
    expect(parsed.success).toBe(true);
  });

  it("empty（actions=0, pending=0）→ invalid（refinement）", () => {
    const parsed = proposeVisualActionsInputSchema.safeParse(base({}));
    expect(parsed.success).toBe(false);
  });

  it("pending 携带 change/tool/input → strict reject；unknown reason → reject", () => {
    const withChange = proposeVisualActionsInputSchema.safeParse(
      base({
        pendingItems: [{ reason: "ambiguous-entity", evidence: "x", description: "y", change: { tool: "create_assignment", input: {} } }],
      })
    );
    expect(withChange.success).toBe(false);
    const unknownReason = proposeVisualActionsInputSchema.safeParse(
      base({ pendingItems: [{ reason: "low-confidence", evidence: "x", description: "y" }] })
    );
    expect(unknownReason.success).toBe(false);
  });
});

describe("V1.2 Partial Proposals：Runtime", () => {
  it("mixed build：actions=2 / pending=2；reservedIds+fingerprint 只来自 executable", () => {
    const state = makeState();
    const res = proposeVisualActionsTool(toolState(state), mixedInput() as never, SOURCE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const proposal = (res.data as { proposal: VisualActionProposal }).proposal;
    expect(proposal.actions).toHaveLength(2);
    expect(proposal.pendingItems).toHaveLength(2);
    expect(proposal.pendingItems[0].reason).toBe("ambiguous-entity");
    expect(proposal.pendingItems[1].reason).toBe("unsupported-action");
    expect(proposal.pendingItems[0].evidence.text).toContain("王老师");
    expect(proposal.pendingItems[0].description).toContain("无法唯一确定");
    expect(proposal.pendingItems[0].id).toMatch(/^vpending_/);
    // pending 不参与 reservedIds / fingerprint
    expect(proposal.reservedIds).toHaveLength(2);
    expect(proposal.previewFingerprint).toBeTruthy();
  });

  it("pending-only build：Proposal 可生成；无 fingerprint；executor 拒绝 Apply", async () => {
    const state = makeState();
    const res = proposeVisualActionsTool(
      toolState(state),
      {
        summary: "从截图发现 2 项需要确认",
        actions: [],
        pendingItems: [
          { reason: "missing-information", evidence: "周六下午补课", description: "截图中没有看到具体时间" },
        ],
      } as never,
      SOURCE
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const proposal = (res.data as { proposal: VisualActionProposal }).proposal;
    expect(proposal.actions).toHaveLength(0);
    expect(proposal.pendingItems).toHaveLength(1);
    expect(proposal.previewFingerprint).toBeUndefined();
    expect(proposal.reservedIds).toHaveLength(0);
    // Apply 防御：pending-only 不可执行
    const api = new FakeApi(state);
    const exec = await executeVisualActionProposal({
      proposal,
      state,
      api: api as unknown as KiroWriteApi,
      confirm: async () => true,
    });
    expect(exec.ok).toBe(false);
    if (exec.ok) return;
    expect(exec.code).toBe("VISUAL_PROPOSAL_EMPTY");
    expect(exec.applied).toBe(0);
  });

  it("mixed Apply：只执行 actions；pending 0 mutation", async () => {
    const state = makeState();
    const built = buildVisualActionProposal(mixedInput() as never, state, { sourceAttachmentIds: ["att-real-1"] });
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
    expect(res.applied).toBe(2);
    // actions 已写入
    expect((state as any).assignments.some((a: any) => a.title === "数据结构实验报告")).toBe(true);
    expect((state as any).scheduleOccurrenceOverrides).toHaveLength(1);
    // pending 永远不会产生写操作：Store 中没有与 pending 相关的变化
    expect((state as any).reminders).toHaveLength(0);
    expect((state as any).groupProjects).toHaveLength(0);
    expect((state as any).courses).toHaveLength(2);
  });

  it("Atomic Failure：2 executable + 1 pending，其中 executable 硬冲突 → 整体 preflight 失败（不保留 A）", () => {
    const state = makeState();
    // 把 s2 移到周六 14:00 制造与 move_schedule_occurrence 目标的硬冲突
    (state as any).schedules = (state as any).schedules.map((s: any) =>
      s.id === "s2" ? { ...s, dayOfWeek: 6 } : s
    );
    const res = proposeVisualActionsTool(
      toolState(state),
      {
        summary: "mixed",
        actions: [proposalInput().actions[0], proposalInput().actions[1]],
        pendingItems: [{ reason: "ambiguous-entity", evidence: "x", description: "y" }],
      } as never,
      SOURCE
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("CONFLICT");
  });

  it("unsupported mixed：2 executable + 1 unsupported → Apply 正常", async () => {
    const state = makeState();
    const res = proposeVisualActionsTool(
      toolState(state),
      {
        summary: "mixed",
        actions: [proposalInput().actions[0], proposalInput().actions[1]],
        pendingItems: [{ reason: "unsupported-action", evidence: "把通知转发到班群", description: "当前不支持发送外部消息" }],
      } as never,
      SOURCE
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const api = new FakeApi(state);
    const exec = await executeVisualActionProposal({
      proposal: (res.data as { proposal: VisualActionProposal }).proposal,
      state,
      api: api as unknown as KiroWriteApi,
      confirm: async () => true,
    });
    expect(exec.ok).toBe(true);
    expect(exec.applied).toBe(2);
  });

  it("Undo 只撤销 actions；pending 保持不变（proposal 对象不变）", async () => {
    const state = makeState();
    const before = JSON.stringify(state);
    const built = buildVisualActionProposal(mixedInput() as never, state, { sourceAttachmentIds: ["att-real-1"] });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const pendingSnapshot = JSON.stringify(built.proposal.pendingItems);
    const api = new FakeApi(state);
    const res = await executeVisualActionProposal({
      proposal: built.proposal,
      state,
      api: api as unknown as KiroWriteApi,
      confirm: async () => true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    api.undos.get(built.proposal.id)!();
    expect(JSON.stringify(state)).toBe(before);
    expect(JSON.stringify(built.proposal.pendingItems)).toBe(pendingSnapshot);
  });
});

describe("V1.2 Visual Pending Continuation", () => {
  it("buildVisualPendingContinuation：过滤 unsupported；携带 sourceProposalId + pending facts", () => {
    const built = buildVisualActionProposal(mixedInput() as never, makeState(), { sourceAttachmentIds: ["att-real-1"] });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const continuation = buildVisualPendingContinuation(built.proposal);
    expect(continuation).not.toBeNull();
    expect(continuation?.sourceProposalId).toBe(built.proposal.id);
    expect(continuation?.pendingItems).toHaveLength(1); // 只留 ambiguous-entity
    expect(continuation?.pendingItems[0].reason).toBe("ambiguous-entity");
    expect(continuation?.pendingItems[0].evidence).toContain("王老师");
  });

  it("unsupported-only → 无可澄清项 → null", () => {
    const res = proposeVisualActionsTool(
      toolState(makeState()),
      {
        summary: "unsupported only",
        actions: [],
        pendingItems: [{ reason: "unsupported-action", evidence: "把通知转发到班群", description: "当前不支持" }],
      } as never,
      SOURCE
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const continuation = buildVisualPendingContinuation((res.data as { proposal: VisualActionProposal }).proposal);
    expect(continuation).toBeNull();
  });

  it("normalizeVisualPendingContinuation：bounds / enum / 丢弃未知字段", () => {
    const norm = normalizeVisualPendingContinuation({
      sourceProposalId: "vprop_1",
      pendingItemIds: ["a", "b"],
      pendingItems: [
        { id: "vp_1", reason: "ambiguous-entity", evidence: "x", description: "y", change: { tool: "create_assignment" } },
        { id: "vp_2", reason: "low-confidence", evidence: "x", description: "y" },
        { id: "vp_3", reason: "missing-information", evidence: "z", description: "w" },
      ],
    });
    expect(norm).not.toBeNull();
    expect(norm?.pendingItems).toHaveLength(2); // 非法 reason 被丢弃
    expect((norm?.pendingItems[0] as any).change).toBeUndefined();
  });

  it("isVisualPendingCancel：放弃表达识别；普通文本不受影响", () => {
    expect(isVisualPendingCancel("算了，不处理这个了")).toBe(true);
    expect(isVisualPendingCancel("先不处理了吧")).toBe(true);
    expect(isVisualPendingCancel("帮我创建一个明晚的复习任务")).toBe(false);
  });

  it("visualProposalRequired：image IDs 或 continuation 任一成立 → 需要 Proposal", () => {
    expect(visualProposalRequired([], false)).toBe(false); // 普通文字 Turn
    expect(visualProposalRequired(["att_1"], false)).toBe(true); // 图片 Turn
    expect(visualProposalRequired([], true)).toBe(true); // 澄清链 Turn（无新图片）
  });

  it("澄清链 Turn 无图片也可 propose（visualContinuationActive 通过）", () => {
    const state = makeState();
    const res = proposeVisualActionsTool(
      toolState(state),
      {
        summary: "澄清后的方案",
        actions: [proposalInput().actions[1]],
      } as never,
      { visualContinuationActive: true }
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const proposal = (res.data as { proposal: VisualActionProposal }).proposal;
    expect(proposal.sourceAttachmentIds).toEqual([]); // 无新图片 → source 为空
    expect(proposal.actions).toHaveLength(1);
  });
});
