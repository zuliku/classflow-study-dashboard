import { describe, expect, it } from "vitest";
import { deriveMiniTelemetry } from "@/lib/ai/miniChat/telemetry";
import type { PersistedExecutionPlan } from "@/lib/ai/computer/plans/types";
import type { KiroSourceMeta } from "@/lib/ai/citations/types";

function plan(over: Partial<PersistedExecutionPlan> = {}): PersistedExecutionPlan {
  return {
    planId: "p1",
    conversationId: "c1",
    title: "整理作业",
    status: "approved",
    steps: [
      { id: "s1", title: "读取任务", done: true },
      { id: "s2", title: "整理数据", done: false },
    ],
    proposingToolCallId: "t1",
    proposingMessageId: "m1",
    createdAt: "2026-11-05T10:00:00.000Z",
    updatedAt: "2026-11-05T10:01:00.000Z",
    ...over,
  };
}

describe("deriveMiniTelemetry", () => {
  it("thinking / working / answering 的稳定状态", () => {
    expect(
      deriveMiniTelemetry({
        busy: true,
        streaming: false,
        waitingApproval: false,
        activity: { phase: "thinking", steps: [] },
      }).status?.label
    ).toBe("正在思考");

    const working = deriveMiniTelemetry({
      busy: true,
      streaming: false,
      waitingApproval: false,
      activity: {
        phase: "reading",
        steps: [
          { label: "查看近期 DDL", status: "done" },
          { label: "搜索网络", status: "working" },
        ],
      },
    });
    expect(working.status?.label).toBe("正在搜索网络");
    expect(working.activity).toEqual({ label: "搜索网络", done: 1, total: 2 });

    expect(
      deriveMiniTelemetry({
        busy: true,
        streaming: true,
        answerStarted: true,
        waitingApproval: false,
        activity: { phase: "thinking", steps: [] },
      }).phase
    ).toBe("answering");

    expect(
      deriveMiniTelemetry({
        busy: true,
        streaming: true,
        waitingApproval: false,
        activity: { phase: "done", steps: [] },
      }).phase
    ).toBe("answering");
  });

  it("审批优先；plan 取 live 最新；来源只保留 web metadata", () => {
    const sources: KiroSourceMeta[] = [
      { sourceId: "doc-1", name: "课程讲义", source: "course-material" },
      { sourceId: "web-1", name: "公告", source: "web", domain: "example.edu", url: "https://example.edu/a" },
      { sourceId: "web-2", name: "新闻", source: "web", domain: "news.example" },
    ];
    const result = deriveMiniTelemetry({
      busy: true,
      streaming: false,
      waitingApproval: true,
      plans: [plan()],
      sources,
      suggestionsKind: "assignment",
    });
    expect(result.phase).toBe("waiting-approval");
    expect(result.status?.label).toBe("等待确认");
    expect(result.approval).toEqual({ pending: true });
    expect(result.plan).toMatchObject({
      title: "整理作业",
      completed: 1,
      total: 2,
      currentStep: "整理数据",
    });
    expect(result.sources.map((s) => s.id)).toEqual(["web-1", "web-2"]);
    expect(result.sources[0].url).toBe("https://example.edu/a");
    expect(result.suggestions).toEqual(["拆分这个任务", "制定完成计划", "总结任务要求"]);
  });

  it("无上下文 → 默认快捷 Prompt；idle 无状态", () => {
    const result = deriveMiniTelemetry({
      busy: false,
      streaming: false,
      waitingApproval: false,
      suggestionsKind: null,
    });
    expect(result.phase).toBe("idle");
    expect(result.status).toBeNull();
    expect(result.suggestions).toEqual(["今天要做什么", "这周还有什么 DDL", "总结当前对话"]);
  });
});
