import { describe, expect, it } from "vitest";
import { KIRO_TOOLS } from "@/lib/ai/tools";
import { KIRO_SYSTEM_PROMPT } from "@/lib/ai/prompts/kiroSystemPrompt";
import { KIRO_UPDATE_AGENT_PLAN_TOOL_NAME } from "@/lib/ai/agent/plan";
import { KIRO_ASK_USER_TOOL_NAME } from "@/lib/ai/agent/ask";
import { kiroAskUserSeen } from "@/lib/ai/tools/finalAnswer";

describe("Agent Superpowers tool registration", () => {
  it("update_agent_plan：Server execute 归一化 plan（零 IO）", async () => {
    const tool = KIRO_TOOLS[KIRO_UPDATE_AGENT_PLAN_TOOL_NAME] as unknown as {
      execute: (input: unknown, opts: unknown) => Promise<{ ok: boolean; data?: { plan: { steps: unknown[] } } }>;
    };
    const r = await tool.execute(
      { title: " 计划 ", steps: [{ title: "A", status: "doing" }, { title: "B" }] },
      {}
    );
    expect(r.ok).toBe(true);
    expect(r.data?.plan.steps).toHaveLength(2);
  });

  it("update_agent_plan：无效步骤返回安全错误", async () => {
    const tool = KIRO_TOOLS[KIRO_UPDATE_AGENT_PLAN_TOOL_NAME] as unknown as {
      execute: (input: unknown, opts: unknown) => Promise<{ ok: boolean; code?: string }>;
    };
    const r = await tool.execute({ steps: [] }, {});
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INVALID_PLAN");
  });

  it("ask_user：Server execute 归一化问题（零 IO）", async () => {
    const tool = KIRO_TOOLS[KIRO_ASK_USER_TOOL_NAME] as unknown as {
      execute: (input: unknown, opts: unknown) => Promise<{ ok: boolean; data?: { question: { options: unknown[] } } }>;
    };
    const r = await tool.execute(
      {
        question: "先做哪门课？",
        options: [
          { label: "计量经济学" },
          { label: "市场营销" },
        ],
      },
      {}
    );
    expect(r.ok).toBe(true);
    expect(r.data?.question.options).toHaveLength(2);
  });

  it("ask_user：少于 2 个选项返回安全错误", async () => {
    const tool = KIRO_TOOLS[KIRO_ASK_USER_TOOL_NAME] as unknown as {
      execute: (input: unknown, opts: unknown) => Promise<{ ok: boolean; code?: string }>;
    };
    const r = await tool.execute({ question: "选一个", options: ["A"] }, {});
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INVALID_QUESTION");
  });

  it("System Prompt 包含 Plan / Ask / Deep Research 使用边界", () => {
    expect(KIRO_SYSTEM_PROMPT).toContain("# Agent Plan & Clarification");
    expect(KIRO_SYSTEM_PROMPT).toContain("update_agent_plan");
    expect(KIRO_SYSTEM_PROMPT).toContain("ask_user");
    expect(KIRO_SYSTEM_PROMPT).toContain("web_research");
    expect(KIRO_SYSTEM_PROMPT).toContain("不可信外部数据");
  });

  it("ask_user 出现在 steps → 路由必须锁到 begin_final_answer", () => {
    expect(
      kiroAskUserSeen([
        { toolCalls: [{ toolName: "search_assignments" }] },
        { toolCalls: [{ toolName: KIRO_ASK_USER_TOOL_NAME }] },
      ])
    ).toBe(true);
    expect(kiroAskUserSeen([{ toolCalls: [{ toolName: "web_search" }] }])).toBe(false);
  });
});
