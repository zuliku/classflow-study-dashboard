import { expect } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Kiro Subagent E2E：
 * 主 Agent 发出 delegate_subagent → 浏览器独立流式调用 /api/ai/subagent →
 * Worklog 内联卡片实时更新 → 右侧 Inspector 子代理栏目 → Tool Output 回填后主 Agent 继续。
 */
const sse = (lines: string[]) => lines.map((l) => `data: ${l}`).join("\n\n") + "\n\n";

const SUBAGENT_SSE = sse([
  JSON.stringify({ type: "start", messageId: "sub-1" }),
  JSON.stringify({ type: "start-step" }),
  JSON.stringify({ type: "tool-input-start", toolCallId: "sub-tool-1", toolName: "web_search" }),
  JSON.stringify({
    type: "tool-input-available",
    toolCallId: "sub-tool-1",
    toolName: "web_search",
    input: { query: "AI agent frameworks 2026" },
  }),
  JSON.stringify({
    type: "tool-output-available",
    toolCallId: "sub-tool-1",
    output: { ok: true, data: { results: [{ sourceId: "web-1" }, { sourceId: "web-2" }] } },
  }),
  JSON.stringify({ type: "text-start", id: "sub-text" }),
  JSON.stringify({ type: "text-delta", id: "sub-text", delta: "框架 A 更适合学习管理，" }),
  JSON.stringify({ type: "text-delta", id: "sub-text", delta: "但需要额外配置。" }),
  JSON.stringify({ type: "text-end", id: "sub-text" }),
  JSON.stringify({ type: "finish-step" }),
  JSON.stringify({ type: "finish", finishReason: "stop" }),
]);

test("子代理：内联流式输出 + 右侧 Inspector + 主 Agent 继续", async ({ page }) => {
  const subagentBodies: Record<string, unknown>[] = [];
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

  await page.route("**/api/ai/subagent", async (route) => {
    subagentBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: SUBAGENT_SSE,
    });
  });

  await page.route("**/api/ai/chat", async (route) => {
    const body = route.request().postDataJSON() as {
      messages?: { role: string; parts?: { type: string; state?: string; output?: unknown; errorText?: string }[] }[];
    };
    const hasSubagentOutput = (body.messages ?? []).some(
      (m) =>
        m.role === "assistant" &&
        (m.parts ?? []).some(
          (p) => p.type === "tool-delegate_subagent" && p.state === "output-available"
        )
    );
    if (hasSubagentOutput) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sse([
          JSON.stringify({ type: "start", messageId: "main-1" }),
          JSON.stringify({ type: "start-step" }),
          JSON.stringify({ type: "text-start", id: "main-2-text" }),
          JSON.stringify({ type: "text-delta", id: "main-2-text", delta: "已收到研究摘要，继续整理。" }),
          JSON.stringify({ type: "text-end", id: "main-2-text" }),
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
        JSON.stringify({ type: "start", messageId: "main-1" }),
        JSON.stringify({ type: "start-step" }),
        JSON.stringify({ type: "text-start", id: "main-1-text" }),
        JSON.stringify({ type: "text-delta", id: "main-1-text", delta: "我派一个研究员子代理去比较。" }),
        JSON.stringify({ type: "text-end", id: "main-1-text" }),
        JSON.stringify({ type: "tool-input-start", toolCallId: "call_sub", toolName: "delegate_subagent" }),
        JSON.stringify({ type: "tool-input-delta", toolCallId: "call_sub", inputTextDelta: "{}" }),
        JSON.stringify({
          type: "tool-input-available",
          toolCallId: "call_sub",
          toolName: "delegate_subagent",
          input: {
            role: "researcher",
            task: "比较 2026 年主流 agent 框架的学习管理能力",
            context: "用户是大学生，需要在 ClassFlow 中管理课程与 DDL。",
          },
        }),
        JSON.stringify({ type: "finish-step" }),
        JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
      ]),
    });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("帮我比较 agent 框架");
  await composer.getByLabel("发送").click();

  const inline = page.getByTestId("kiro-subagent-inline");
  await expect(inline).toBeVisible({ timeout: 10000 });
  await expect(inline).toHaveCount(1);
  await expect(inline).toContainText("研究员");
  await expect(inline).toContainText("比较 2026 年主流 agent 框架");
  await expect(inline).toContainText("框架 A 更适合学习管理", { timeout: 10000 });

  // 右侧 Inspector 自动打开并显示子代理栏目
  const inspector = page.getByTestId("kiro-inspector-subagents");
  await expect(inspector).toBeVisible({ timeout: 10000 });
  await expect(inspector).toContainText("研究员");
  await expect(inspector).toContainText("已完成", { timeout: 10000 });

  // 主 Agent 收到 Tool Output 后继续
  await expect(page.getByTestId("kiro-message").last()).toContainText("已收到研究摘要", {
    timeout: 10000,
  });

  expect(subagentBodies).toHaveLength(1);
  expect(subagentBodies[0].subagent).toMatchObject({ role: "researcher" });
  expect(subagentBodies[0].webSearchConfig).toMatchObject({ enabled: true });
});
