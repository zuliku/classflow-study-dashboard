import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Task 8 E2E：
 * A. apply_change_set 批量成功 → 全部修改 + 单个 Change Set Card + 单个 Undo
 * B. 课表冲突 → preflight 失败 → 0 mutation + 自然说明
 */

const AI_SETTINGS = {
  enabled: true,
  provider: "deepseek",
  model: "deepseek-v4-flash",
  custom: { providerName: "", baseURL: "", model: "" },
};

function sse(body: string): string {
  return body
    .split("\n")
    .filter(Boolean)
    .map((line) => `data: ${line}`)
    .join("\n\n") + "\n\n";
}

function toolCallSSE(toolName: string, input: unknown): string {
  return sse(
    [
      JSON.stringify({ type: "start", messageId: "m1" }),
      JSON.stringify({ type: "start-step" }),
      JSON.stringify({ type: "tool-input-start", toolCallId: "cs_1", toolName }),
      JSON.stringify({ type: "tool-input-delta", toolCallId: "cs_1", inputTextDelta: JSON.stringify(input) }),
      JSON.stringify({ type: "tool-input-available", toolCallId: "cs_1", toolName, input }),
      JSON.stringify({ type: "finish-step" }),
      JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
    ].join("\n")
  );
}

function textSSE(content: string): string {
  return sse(
    [
      JSON.stringify({ type: "start", messageId: "m1" }),
      JSON.stringify({ type: "start-step" }),
      JSON.stringify({ type: "text-start", id: "t1" }),
      JSON.stringify({ type: "text-delta", id: "t1", delta: content }),
      JSON.stringify({ type: "text-end", id: "t1" }),
      JSON.stringify({ type: "finish-step" }),
      JSON.stringify({ type: "finish", finishReason: "stop" }),
    ].join("\n")
  );
}

async function seedAI(page: Page) {
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
}

async function openWorkspace(page: Page) {
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await expect(page.getByTestId("kiro-workspace")).toBeVisible();
}

async function sendMessage(page: Page, text: string) {
  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill(text);
  await composer.getByLabel("发送").click();
}

test("E2E A：Change Set 批量成功 → 全部修改 + 单个 Card + 单个 Undo", async ({ page }) => {
  await page.route("**/api/ai/chat", async (route) => {
    const body = route.request().postDataJSON() as { messages?: { role: string; parts?: { type: string; state?: string }[] }[] };
    const hasToolOutput = (body?.messages ?? []).some(
      (m) => m.role === "assistant" && (m.parts ?? []).some((p) => p.type.startsWith("tool-") && p.state === "output-available")
    );
    if (!hasToolOutput) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallSSE("apply_change_set", {
          summary: "推迟三个作业并提高优先级",
          actions: [
            { tool: "set_assignment_ddl", input: { assignmentId: "a1", ddl: "2026-08-20T22:00:00" } },
            { tool: "set_assignment_ddl", input: { assignmentId: "a2", ddl: "2026-08-21T22:00:00" } },
            { tool: "set_assignment_ddl", input: { assignmentId: "a3", ddl: "2026-08-22T22:00:00" } },
            { tool: "set_assignment_priority", input: { assignmentId: "a1", priority: "high" } },
          ],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: textSSE("已将这组修改作为一个整体执行完成。"),
    });
  });
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page);

  await sendMessage(page, "把这三个作业都推迟一天，并把第一个的优先级改成高");
  await expect(page.getByTestId("kiro-message").last()).toContainText("整体执行完成", { timeout: 15000 });

  // 全部修改已生效（Store 即 localStorage）
  const stored = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("classflow-storage-v2")!).state;
    const a1 = s.assignments.find((a: any) => a.id === "a1");
    const a2 = s.assignments.find((a: any) => a.id === "a2");
    const a3 = s.assignments.find((a: any) => a.id === "a3");
    return { a1, a2, a3 };
  });
  expect(stored.a1.ddl).toBe("2026-08-20T22:00:00");
  expect(stored.a2.ddl).toBe("2026-08-21T22:00:00");
  expect(stored.a3.ddl).toBe("2026-08-22T22:00:00");
  expect(stored.a1.priority).toBe("high");

  // 单个 Change Set Card（不生成 4 张 Card）
  const cards = page.getByTestId("kiro-action-card");
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("已完成 4 项修改");
  await expect(cards).toContainText("撤销");

  // 单个 Undo：一次撤销全部恢复
  await cards.getByRole("button", { name: "撤销" }).click();
  await page.waitForTimeout(400);
  const afterUndo = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("classflow-storage-v2")!).state;
    return s.assignments.map((a: any) => a.ddl);
  });
  expect(afterUndo).not.toContain("2026-08-20T22:00:00");
});

test("E2E B：课表冲突 → preflight 失败 → 0 mutation + 自然说明", async ({ page }) => {
  await page.route("**/api/ai/chat", async (route) => {
    const body = route.request().postDataJSON() as { messages?: { role: string; parts?: { type: string; state?: string }[] }[] };
    const hasToolOutput = (body?.messages ?? []).some(
      (m) => m.role === "assistant" && (m.parts ?? []).some((p) => p.type.startsWith("tool-") && p.state === "output-available")
    );
    if (!hasToolOutput) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallSSE("apply_change_set", {
          summary: "调整两节课的时间",
          actions: [
            { tool: "move_schedule", input: { scheduleId: "s1", dayOfWeek: 1, startTime: "10:00" } },
            { tool: "move_schedule", input: { scheduleId: "s3", dayOfWeek: 2, startTime: "08:00" } },
          ],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: textSSE("其中一节课程与现有课表时间冲突，这组修改没有任何一项被执行。"),
    });
  });
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page);

  const before = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("classflow-storage-v2")!).state;
    return JSON.stringify(s.schedules);
  });

  await sendMessage(page, "把这两节课调一下时间");
  await expect(page.getByTestId("kiro-message").last()).toContainText("没有任何一项被执行", { timeout: 15000 });

  // 0 mutation：课表与执行前完全一致；无 Action Card
  const after = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("classflow-storage-v2")!).state;
    return JSON.stringify(s.schedules);
  });
  expect(after).toBe(before);
  await expect(page.getByTestId("kiro-action-card")).toHaveCount(0);
});
