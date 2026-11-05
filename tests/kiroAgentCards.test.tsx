// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { KiroAgentPlanCard } from "@/components/kiro/run/KiroAgentPlanCard";
import { KiroAskUserCard } from "@/components/kiro/run/KiroAskUserCard";
import { KiroSubagentInlineCard } from "@/components/kiro/run/KiroSubagentInlineCard";
import { KiroInspectorSubagents } from "@/components/kiro/inspector/KiroInspectorSubagents";
import { useKiroSubagentStore } from "@/store/useKiroSubagentStore";
import { normalizeAgentPlan } from "@/lib/ai/agent/plan";
import { normalizeUserQuestion } from "@/lib/ai/agent/ask";

const mocks = vi.hoisted(() => ({
  send: vi.fn(async () => true),
}));

vi.mock("@/components/kiro/KiroSessionProvider", () => ({
  useKiroSession: () => ({
    chat: { send: mocks.send, turnInFlight: false },
  }),
  useKiroSessionMeta: () => ({ currentConversationId: "c1" }),
  useOptionalKiroSession: () => ({ currentConversationId: "c1" }),
}));

afterEach(() => {
  cleanup();
  mocks.send.mockClear();
  useKiroSubagentStore.getState().reset();
});

describe("KiroAgentPlanCard", () => {
  it("显示进度、当前步骤；长计划可展开/收起", async () => {
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
    expect(card.textContent).toContain("当前：整理数据");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1");
    expect(screen.queryByText("复盘")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "展开执行计划" }));
    expect(screen.getByText("复盘")).toBeTruthy();
    expect(card.getAttribute("data-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "收起执行计划" }));
    expect(card.getAttribute("data-expanded")).toBe("false");
    await waitFor(() => expect(screen.queryByText("复盘")).toBeNull());
  });

  it("窄容器自动收起，用户手动展开优先", async () => {
    const original = globalThis.ResizeObserver;
    class NarrowResizeObserver {
      constructor(private cb: ResizeObserverCallback) {}
      observe() {
        this.cb([{ contentRect: { width: 320 } }] as ResizeObserverEntry[], {} as ResizeObserver);
      }
      disconnect() {}
      unobserve() {}
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = NarrowResizeObserver;
    try {
      const plan = normalizeAgentPlan({
        title: "准备作业",
        steps: [
          { title: "读要求", status: "completed" },
          { title: "整理数据", status: "in_progress" },
          { title: "写报告", status: "pending" },
          { title: "检查引用", status: "pending" },
        ],
      })!;
      render(<KiroAgentPlanCard plan={plan} running={false} />);
      const card = screen.getByTestId("kiro-agent-plan");
      await waitFor(() => expect(card.getAttribute("data-narrow")).toBe("true"));
      await waitFor(() => expect(card.getAttribute("data-expanded")).toBe("false"));
      fireEvent.click(screen.getByTestId("kiro-agent-plan-toggle"));
      expect(card.getAttribute("data-expanded")).toBe("true");
    } finally {
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = original;
    }
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

describe("Subagent UI", () => {
  it("内联卡片显示角色、任务、流式正文与完成态", () => {
    act(() => {
      useKiroSubagentStore.getState().start({
        id: "sub-1",
        conversationId: "c1",
        role: "researcher",
        task: "比较主流 agent 框架",
        webUsed: true,
      });
    });
    render(
      <KiroSubagentInlineCard
        toolCallId="sub-1"
        fallbackLabel="子代理"
        fallbackStatus="working"
      />
    );
    expect(screen.getByTestId("kiro-subagent-inline").textContent).toContain("研究员");
    expect(screen.getByTestId("kiro-subagent-inline").textContent).toContain("比较主流 agent 框架");
    expect(screen.getByTestId("kiro-subagent-inline").textContent).toContain("运行中");

    act(() => useKiroSubagentStore.getState().appendText("sub-1", "正在比较两个框架。"));
    expect(screen.getByTestId("kiro-subagent-inline").textContent).toContain("正在比较两个框架。");

    act(() => useKiroSubagentStore.getState().complete("sub-1", "框架 A 更适合。", true));
    expect(screen.getByTestId("kiro-subagent-inline").textContent).toContain("已完成");
    expect(screen.getByTestId("kiro-subagent-inline").textContent).toContain("结果已归档");
  });

  it("右侧 Inspector 子代理栏目按会话展示，可展开完整摘要", () => {
    act(() => {
      useKiroSubagentStore.getState().start({
        id: "sub-2",
        conversationId: "c1",
        role: "reviewer",
        task: "审查学习计划",
        webUsed: false,
      });
      useKiroSubagentStore.getState().appendText("sub-2", "缺少周末缓冲。");
      useKiroSubagentStore.getState().complete("sub-2", "建议增加周日复盘。", false);
      useKiroSubagentStore.getState().start({
        id: "sub-3",
        conversationId: "c2",
        role: "planner",
        task: "其他会话",
        webUsed: false,
      });
    });
    render(<KiroInspectorSubagents />);
    expect(screen.getByTestId("kiro-inspector-subagents").textContent).toContain("审查员");
    expect(screen.getByTestId("kiro-inspector-subagents").textContent).not.toContain("其他会话");
    fireEvent.click(screen.getByRole("button", { name: /审查员/ }));
    expect(screen.getByText("建议增加周日复盘。")).toBeTruthy();
  });
});
