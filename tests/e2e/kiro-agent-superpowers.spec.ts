import { expect } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Kiro Agent Superpowers V1 — Plan + Ask UI 集成：
 * - Server 控制工具（update_agent_plan / ask_user）经真实 UI message stream 到达；
 * - Plan Card 不进入 Worklog，显示进度；
 * - Ask Card 在本轮结算后可回答，点击选项发出下一条 user message。
 *
 * 控制工具是 server-executed：mock 必须带 providerExecuted=true，
 * 否则 useChat 会把它当成 client tool 等待回填，turnInFlight 永不结算。
 */
const sse = (lines: string[]) => lines.map((l) => `data: ${l}`).join("\n\n") + "\n\n";

const PLAN = {
  title: "准备计量经济学作业",
  steps: [
    { id: "a", title: "读取任务要求", status: "completed" },
    { id: "b", title: "整理数据", status: "in_progress" },
    { id: "c", title: "写报告", status: "pending" },
    { id: "d", title: "检查引用", status: "pending" },
  ],
};

const QUESTION = {
  question: "先处理哪一部分？",
  header: "下一步",
  options: [
    { id: "o1", label: "先整理数据", description: "需要 Excel 与课程数据" },
    { id: "o2", label: "先写报告框架" },
  ],
  allowFreeform: true,
};

test("Agent Superpowers：Plan Card 进度 + Ask Card 选择作为下一轮输入", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "classflow-ai-settings-v1",
      JSON.stringify({
        version: 0,
        state: {
          enabled: true,
          provider: "deepseek",
          model: "deepseek-flash",
          custom: { providerName: "", baseURL: "", model: "" },
        },
      })
    );
    sessionStorage.setItem("classflow-ai-key:deepseek", "sk-test-key");
  });

  await page.route("**/api/ai/chat", async (route) => {
    const body = route.request().postDataJSON() as {
      messages?: { role: string; parts?: { type: string }[] }[];
    };
    const hasToolOutput = (body.messages ?? []).some(
      (m) =>
        m.role === "assistant" &&
        (m.parts ?? []).some((p) => p.type.startsWith("tool-") && p.type !== "tool-begin_final_answer")
    );
    // 用户已点选 → 第二轮简单回答
    if (hasToolOutput) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sse([
          JSON.stringify({ type: "start", messageId: "m2" }),
          JSON.stringify({ type: "start-step" }),
          JSON.stringify({ type: "text-start", id: "t2" }),
          JSON.stringify({ type: "text-delta", id: "t2", delta: "好的，按你的选择继续。" }),
          JSON.stringify({ type: "text-end", id: "t2" }),
          JSON.stringify({ type: "finish-step" }),
          JSON.stringify({ type: "finish", finishReason: "stop" }),
        ]),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sse([
        JSON.stringify({ type: "start", messageId: "m1" }),
        JSON.stringify({ type: "start-step" }),
        JSON.stringify({ type: "text-start", id: "t0" }),
        JSON.stringify({ type: "text-delta", id: "t0", delta: "我先拆一下步骤。" }),
        JSON.stringify({ type: "text-end", id: "t0" }),
        JSON.stringify({ type: "tool-input-start", toolCallId: "plan-1", toolName: "update_agent_plan" }),
        JSON.stringify({ type: "tool-input-delta", toolCallId: "plan-1", inputTextDelta: "{}" }),
        JSON.stringify({
          type: "tool-input-available",
          toolCallId: "plan-1",
          toolName: "update_agent_plan",
          providerExecuted: true,
          input: PLAN,
        }),
        JSON.stringify({
          type: "tool-output-available",
          toolCallId: "plan-1",
          providerExecuted: true,
          output: { ok: true, data: { plan: PLAN } },
        }),
        JSON.stringify({ type: "tool-input-start", toolCallId: "ask-1", toolName: "ask_user" }),
        JSON.stringify({ type: "tool-input-delta", toolCallId: "ask-1", inputTextDelta: "{}" }),
        JSON.stringify({
          type: "tool-input-available",
          toolCallId: "ask-1",
          toolName: "ask_user",
          providerExecuted: true,
          input: QUESTION,
        }),
        JSON.stringify({
          type: "tool-output-available",
          toolCallId: "ask-1",
          providerExecuted: true,
          output: { ok: true, data: { question: QUESTION } },
        }),
        JSON.stringify({ type: "tool-input-start", toolCallId: "final-1", toolName: "begin_final_answer" }),
        JSON.stringify({ type: "tool-input-delta", toolCallId: "final-1", inputTextDelta: "{}" }),
        JSON.stringify({
          type: "tool-input-available",
          toolCallId: "final-1",
          toolName: "begin_final_answer",
          input: {},
        }),
        JSON.stringify({ type: "tool-output-available", toolCallId: "final-1", output: { ok: true, data: {} } }),
        JSON.stringify({ type: "finish-step" }),
        JSON.stringify({ type: "start-step" }),
        JSON.stringify({ type: "text-start", id: "t1" }),
        JSON.stringify({ type: "text-delta", id: "t1", delta: "请选择一个方向，我继续执行。" }),
        JSON.stringify({ type: "text-end", id: "t1" }),
        JSON.stringify({ type: "finish-step" }),
        JSON.stringify({ type: "finish", finishReason: "stop" }),
      ]),
    });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("帮我准备计量经济学作业");
  await composer.getByLabel("发送").click();

  const plan = page.getByTestId("kiro-agent-plan");
  const ask = page.getByTestId("kiro-ask-user");
  await expect(plan).toBeVisible({ timeout: 10000 });
  await expect(ask).toBeVisible({ timeout: 10000 });
  await expect(plan).toContainText("准备计量经济学作业");
  await expect(plan).toContainText("1/4");
  await expect(plan.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  // Plan / Ask 是独立卡片，不进入 Worklog Tool Row
  await expect(page.getByTestId("kiro-worklog").getByText("update_agent_plan")).toHaveCount(0);

  const option = ask.getByRole("button", { name: /先整理数据/ });
  await expect(option).toBeEnabled({ timeout: 10000 });
  await option.click();
  await expect(page.getByTestId("kiro-user-message").last()).toContainText("我选择：先整理数据");
  await expect(page.getByTestId("kiro-message").last()).toContainText("按你的选择继续", { timeout: 10000 });
});
