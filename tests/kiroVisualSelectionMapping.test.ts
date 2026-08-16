// @vitest-environment jsdom
/**
 * Visual Action Intake V1.5：VISUAL_SELECTION_DEPENDENCY_CHANGED 的 executor 映射。
 * 依赖分支由 buildVisualProposalExecutionPlan 的 subset-vs-full 行比较触发；
 * 这里 stub plan 返回该 code，验证 executor 完整映射 + 0 mutation + 不注册 undo。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  plan: vi.fn(),
}));

vi.mock("@/lib/ai/visual/executionPlan", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ai/visual/executionPlan")>();
  return {
    ...original,
    buildVisualProposalExecutionPlan: mocks.plan,
  };
});

import { executeVisualActionProposal } from "@/lib/ai/visual/executor";
import { VISUAL_SELECTION_DEPENDENCY_CHANGED_CODE } from "@/lib/ai/visual/executionPlan";
import { KiroWriteApi } from "@/lib/ai/tools/write/types";

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
    ],
    assignments: [],
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

const proposal = {
  id: "vprop-sel-1",
  sourceAttachmentIds: ["att-1"],
  summary: "从截图整理出 2 项",
  actions: [
    {
      id: "pa-1",
      change: { tool: "create_assignment", input: { courseId: "c1", title: "任务A" } },
      evidence: { text: "创建任务A" },
      display: { kind: "assignment-create" as const, title: "任务A" },
    },
    {
      id: "pa-2",
      change: { tool: "set_assignment_ddl", input: { assignmentId: "a1", ddl: "2026-08-20T23:59:00" } },
      evidence: { text: "改截止" },
      display: { kind: "ddl-update" as const, title: "调整截止时间" },
    },
  ],
  pendingItems: [],
  createdAt: 1,
  reservedIds: ["a_reserved_1", undefined],
};

describe("executor：VISUAL_SELECTION_DEPENDENCY_CHANGED 映射", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("plan 返回依赖失败 → executor 透传 code + 用户文案；0 mutation；不调用 executeChangeSet（无 undo 注册）", async () => {
    const state = makeState();
    mocks.plan.mockReturnValue({
      ok: false,
      code: VISUAL_SELECTION_DEPENDENCY_CHANGED_CODE,
      message: "所选修改无法脱离其它修改安全执行，请重新选择或重新分析方案。",
    });
    let registerUndoCalled = false;
    const api = {
      getState: () => state,
      registerUndo: () => {
        registerUndoCalled = true;
      },
      pushToast: () => {},
      onCancelOutput: () => {},
    } as unknown as KiroWriteApi;
    const res = await executeVisualActionProposal({ proposal: proposal as never, state, api });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.stale).not.toBe(true);
    expect(res.code).toBe(VISUAL_SELECTION_DEPENDENCY_CHANGED_CODE);
    expect(res.message).toContain("无法脱离其它修改安全执行");
    expect(res.applied).toBe(0);
    expect(registerUndoCalled).toBe(false);
  });

  it("plan stale → executor 仍映射为 stale（0 mutation）", async () => {
    const state = makeState();
    mocks.plan.mockReturnValue({ ok: false, code: "VISUAL_PROPOSAL_STALE", message: "数据已变化" });
    const res = await executeVisualActionProposal({ proposal: proposal as never, state });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.stale).toBe(true);
    expect(res.code).toBe("VISUAL_PROPOSAL_STALE");
    expect(res.applied).toBe(0);
  });

  it("plan 空选择 → VISUAL_SELECTION_EMPTY 文案；0 mutation", async () => {
    const state = makeState();
    mocks.plan.mockReturnValue({ ok: false, code: "VISUAL_SELECTION_EMPTY", message: "请选择至少一项要应用的修改。" });
    const res = await executeVisualActionProposal({ proposal: proposal as never, state });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("VISUAL_SELECTION_EMPTY");
    expect(res.applied).toBe(0);
  });
});
