import { describe, expect, it } from "vitest";
import { deriveKiroAssistantTurn } from "@/lib/ai/presentation/liveTurnPresentation";

const PLAN = {
  title: "准备作业",
  steps: [
    { id: "a", title: "读要求", status: "completed" },
    { id: "b", title: "整理数据", status: "in_progress" },
    { id: "c", title: "写报告", status: "pending" },
  ],
};

const QUESTION = {
  question: "要优先安排哪门课？",
  options: [
    { id: "c1", label: "计量经济学" },
    { id: "c2", label: "市场营销" },
  ],
};

function planPart(plan: unknown, id = "plan-1") {
  return {
    type: "tool-update_agent_plan",
    toolCallId: id,
    state: "output-available",
    input: plan,
    output: { ok: true, data: { plan } },
  };
}

describe("Agent Superpowers presentation", () => {
  it("从 parts 提取 plan/question，且不进入 Worklog", () => {
    const turn = deriveKiroAssistantTurn(
      [
        { type: "text", text: "我先拆一下步骤。", state: "done" },
        planPart(PLAN),
        {
          type: "tool-ask_user",
          toolCallId: "ask-1",
          state: "output-available",
          input: QUESTION,
          output: { ok: true, data: { question: QUESTION } },
        },
        { type: "tool-begin_final_answer", toolCallId: "final-1", state: "output-available", output: { ok: true } },
        { type: "text", text: "请选择优先课程。", state: "done" },
      ],
      false
    );

    expect(turn.plan?.steps[1]).toMatchObject({ id: "b", title: "整理数据", status: "in_progress" });
    expect(turn.question?.question).toBe("要优先安排哪门课？");
    expect(turn.answer).toContain("请选择优先课程");
    expect(turn.worklog.some((b) => b.kind === "tool")).toBe(false);
  });

  it("live 阶段 output 未到 → 先用 input 展示 plan", () => {
    const turn = deriveKiroAssistantTurn(
      [
        {
          type: "tool-update_agent_plan",
          toolCallId: "plan-live",
          state: "input-available",
          input: PLAN,
        },
      ],
      true
    );
    expect(turn.plan?.title).toBe("准备作业");
    expect(turn.worklog).toHaveLength(0);
  });

  it("同一消息多次 plan → 最新一次覆盖", () => {
    const nextPlan = {
      title: "更新后的计划",
      steps: [{ id: "x", title: "重新核对", status: "in_progress" }],
    };
    const turn = deriveKiroAssistantTurn([planPart(PLAN, "p1"), planPart(nextPlan, "p2")], false);
    expect(turn.plan?.title).toBe("更新后的计划");
    expect(turn.plan?.steps).toHaveLength(1);
  });

  it("无效 plan/question 不渲染半截卡片", () => {
    const turn = deriveKiroAssistantTurn(
      [
        planPart({ steps: [] }),
        {
          type: "tool-ask_user",
          toolCallId: "ask-bad",
          state: "output-available",
          output: { ok: true, data: { question: { question: "只有一个选项", options: ["A"] } } },
        },
      ],
      false
    );
    expect(turn.plan).toBeUndefined();
    expect(turn.question).toBeUndefined();
  });
});
