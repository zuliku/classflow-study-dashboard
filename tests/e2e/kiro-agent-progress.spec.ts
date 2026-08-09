import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Agent 执行反馈 smoke（Task：执行反馈）：
 * 发送后（submitted 空白修复）→「Kiro 正在思考」出现 → 回答流式到达 → Progress 消退。
 */

const AI_SETTINGS = {
  enabled: true,
  provider: "deepseek",
  model: "deepseek-v4-flash",
  custom: { providerName: "", baseURL: "", model: "" },
};

test("发送后立即出现「Kiro 正在思考」，回答到达后消退", async ({ page }) => {
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await page.route("**/api/ai/chat", async (route) => {
    // 延迟 800ms 响应：确保 thinking 状态可观测
    await new Promise((r) => setTimeout(r, 800));
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        JSON.stringify({ type: "start", messageId: "m1" }),
        JSON.stringify({ type: "start-step" }),
        JSON.stringify({ type: "text-start", id: "t1" }),
        JSON.stringify({ type: "text-delta", id: "t1", delta: "这是最近 7 天内的 DDL 情况。" }),
        JSON.stringify({ type: "text-end", id: "t1" }),
        JSON.stringify({ type: "finish-step" }),
        JSON.stringify({ type: "finish", finishReason: "stop" }),
      ]
        .map((l) => `data: ${l}`)
        .join("\n\n") + "\n\n",
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();

  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("查看最近 DDL");
  await composer.getByLabel("发送").click();

  // 约 300ms 后：Agent Progress 出现「Kiro 正在思考」
  const trace = page.getByTestId("kiro-activity-trace");
  await expect(trace).toContainText("Kiro 正在思考", { timeout: 5000 });
  await expect(page.getByText("正在回复", { exact: true })).toHaveCount(0); // 无重复三点 loading

  // 回答到达 → Progress 消退（无工具轮不残留）
  await expect(page.getByTestId("kiro-message").last()).toContainText("DDL 情况", { timeout: 10000 });
  await expect(trace).toHaveCount(0);
});
