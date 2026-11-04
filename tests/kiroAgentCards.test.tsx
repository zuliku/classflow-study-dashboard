// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { KiroAgentPlanCard } from "@/components/kiro/run/KiroAgentPlanCard";
import { KiroAskUserCard } from "@/components/kiro/run/KiroAskUserCard";
import { normalizeAgentPlan } from "@/lib/ai/agent/plan";
import { normalizeUserQuestion } from "@/lib/ai/agent/ask";

const mocks = vi.hoisted(() => ({
  send: vi.fn(async () => true),
}));

vi.mock("@/components/kiro/KiroSessionProvider", () => ({
  useKiroSession: () => ({
    chat: { send: mocks.send, turnInFlight: false },
  }),
}));

afterEach(() => {
  cleanup();
  mocks.send.mockClear();
});

describe("KiroAgentPlanCard", () => {
  it("显示进度、当前步骤；长计划可展开/收起", () => {
    const plan = normalizeAgentPlan({
      title: "准备作业",
      steps: [
        { title: "读要求", status: "completed" },
        { title: "整理数据", status: "in_progress" },
        { title: "写报告", status: "pending" },
        { title: "检查引用", status: "pending" },
        { title: "提交", status: "pending" },
        { title: "复盘", status: "pending" },
      ],
    })!;
    render(<KiroAgentPlanCard plan={plan} running />);
    const card = screen.getByTestId("kiro-agent-plan");
    expect(card.textContent).toContain("准备作业");
    expect(card.textContent).toContain("1/6");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1");
    expect(screen.getByText("整理数据")).toBeTruthy();
    expect(screen.queryByText("复盘")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /展开剩余 3 步/ }));
    expect(screen.getByText("复盘")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /收起计划/ }));
    expect(screen.queryByText("复盘")).toBeNull();
  });
});

describe("KiroAskUserCard", () => {
  const question = normalizeUserQuestion({
    question: "要优先安排哪门课？",
    header: "排期",
    options: [
      { id: "c1", label: "计量经济学" },
      { id: "c2", label: "市场营销", description: "周五截止" },
    ],
    allowFreeform: true,
  })!;

  it("点击选项 → 发送明确答案并禁用", async () => {
    mocks.send.mockClear();
    render(<KiroAskUserCard question={question} answerable />);
    expect(screen.getByTestId("kiro-ask-user").textContent).toContain("要优先安排哪门课？");
    fireEvent.click(screen.getByRole("button", { name: /计量经济学/ }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith("我选择：计量经济学"));
    expect(screen.getByText("已发送，等待 Kiro 继续。")).toBeTruthy();
    expect((screen.getByRole("button", { name: /计量经济学/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("自由输入优先作为下一条 user message", async () => {
    mocks.send.mockClear();
    render(<KiroAskUserCard question={question} answerable />);
    fireEvent.change(screen.getByLabelText("自定义回答"), { target: { value: "周日下午" } });
    fireEvent.click(screen.getByRole("button", { name: "发送回答" }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith("周日下午"));
  });

  it("历史/过期问题只读", () => {
    render(<KiroAskUserCard question={question} answerable={false} />);
    expect(screen.getByText("此问题已回答或已过期。")).toBeTruthy();
    expect((screen.getByRole("button", { name: /计量经济学/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
