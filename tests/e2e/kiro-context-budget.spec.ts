import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Task 7 E2E：
 * 1. Turn Context Snapshot 回归：上传 PDF → 发送 → Composer 清空 → Tool Loop 回传请求仍携带 PDF Context
 * 2. 长历史恢复：带 Summary 的旧对话 → 打开 → 旧消息完整 + 「较早对话已压缩」+ 可继续对话
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

async function seedAI(page: Page) {
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
}

test("Turn Snapshot：PDF Context 在 Tool Loop 中保持稳定（Composer 清空后仍在）", async ({ page }) => {
  const { buildMinimalPdf } = require("../fixtures/files");
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/ai/chat", async (route) => {
    const body = route.request().postDataJSON() as { messages?: { role: string; parts?: { type: string; state?: string }[] }[] };
    bodies.push(body);
    const hasToolOutput = (body?.messages ?? []).some(
      (m) => m.role === "assistant" && (m.parts ?? []).some((p) => p.type.startsWith("tool-") && p.state === "output-available")
    );
    if (!hasToolOutput) {
      const chunks = [
        JSON.stringify({ type: "start", messageId: "m1" }),
        JSON.stringify({ type: "start-step" }),
        JSON.stringify({ type: "tool-input-start", toolCallId: "call_1", toolName: "get_upcoming_assignments" }),
        JSON.stringify({ type: "tool-input-delta", toolCallId: "call_1", inputTextDelta: "{}" }),
        JSON.stringify({ type: "tool-input-available", toolCallId: "call_1", toolName: "get_upcoming_assignments", input: {} }),
        JSON.stringify({ type: "finish-step" }),
        JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
      ];
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(chunks.join("\n")) });
      return;
    }
    const chunks = [
      JSON.stringify({ type: "start", messageId: "m1" }),
      JSON.stringify({ type: "start-step" }),
      JSON.stringify({ type: "text-start", id: "t1" }),
      JSON.stringify({ type: "text-delta", id: "t1", delta: "已根据资料与近期任务完成分析。" }),
      JSON.stringify({ type: "text-end", id: "t1" }),
      JSON.stringify({ type: "finish-step" }),
      JSON.stringify({ type: "finish", finishReason: "stop" }),
    ];
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(chunks.join("\n")) });
  });
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();

  // 上传 PDF
  const composer = page.getByTestId("kiro-composer");
  const chooserPromise = page.waitForEvent("filechooser");
  await composer.getByLabel("添加附件").click();
  await page.getByRole("menuitem", { name: "上传文件" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "测试讲义.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(buildMinimalPdf("ClassFlow PDF test document")),
  });
  await expect(page.getByTestId("kiro-attachment-chip")).toContainText("已就绪", { timeout: 15000 });

  // 发送 → 触发 tool loop（两轮请求）
  await composer.getByLabel("Ask Kiro").fill("根据这份资料创建复习计划");
  await composer.getByLabel("发送").click();
  await expect(page.getByTestId("kiro-message").last()).toContainText("已根据资料", { timeout: 15000 });

  // Composer 附件已清空（发送后）
  await expect(page.getByTestId("kiro-attachments")).toHaveCount(0);
  expect(bodies.length).toBe(2);
  // 关键回归：第二轮（tool output 回传）请求仍携带 PDF 正文（Turn Snapshot 冻结）
  const second = bodies[1] as { attachmentsContext?: { text?: string }[] };
  expect(second.attachmentsContext?.[0]?.text).toContain("ClassFlow PDF test document");
});

test("长历史恢复：Summary + 旧消息完整 + 继续对话", async ({ page }) => {
  await page.route("**/api/ai/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sse(
        [
          JSON.stringify({ type: "start", messageId: "m1" }),
          JSON.stringify({ type: "start-step" }),
          JSON.stringify({ type: "text-start", id: "t1" }),
          JSON.stringify({ type: "text-delta", id: "t1", delta: "继续之前的计划，建议先完成统计学作业。" }),
          JSON.stringify({ type: "text-end", id: "t1" }),
          JSON.stringify({ type: "finish-step" }),
          JSON.stringify({ type: "finish", finishReason: "stop" }),
        ].join("\n")
      ),
    });
  });
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  // 直接向 IndexedDB seed 一条带 Summary 的长对话（模拟 Task 7 已压缩的历史）
  await page.evaluate(() => {
    const messages: { id: string; role: "user" | "assistant"; content: string }[] = [];
    for (let i = 0; i < 20; i++) {
      messages.push({ id: `u${i}`, role: "user", content: `第 ${i} 轮问题：帮我看看本周安排` });
      messages.push({ id: `a${i}`, role: "assistant", content: `第 ${i} 轮回答：好的，本周有若干任务。` });
    }
    return new Promise<void>((resolve) => {
      const req = indexedDB.open("classflow-kiro", 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("conversations")) {
          const store = req.result.createObjectStore("conversations", { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt", { unique: false });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("conversations", "readwrite");
        tx.objectStore("conversations").put({
          id: "seed-long-1",
          title: "长对话测试",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-09T10:00:00.000Z",
          provider: "deepseek",
          model: "deepseek-v4-flash",
          messages,
          manualRefs: [],
          entryRefs: [],
          summary: {
            version: 1,
            text: "用户希望规划本周学习；已讨论统计学作业安排（历史事件）。",
            throughMessageId: "a19",
            updatedAt: "2026-08-09T09:59:00.000Z",
          },
        });
        tx.oncomplete = () => resolve();
      };
    });
  });

  // 打开 Kiro → Thread Rail → 打开长对话
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await page.getByLabel("展开对话").click();
  const rail = page.getByRole("dialog", { name: "对话" });
  await expect(rail.getByText("长对话测试")).toBeVisible();
  await rail.getByText("长对话测试").click();
  await expect(rail).toHaveCount(0);

  // UI 旧消息完整（不因 Context 压缩被删）
  await expect(page.getByTestId("kiro-user-message").first()).toContainText("第 0 轮问题");
  await expect(page.getByTestId("kiro-user-message").last()).toContainText("第 19 轮问题");
  // 极轻提示：较早对话已压缩
  await expect(page.getByText("较早对话已压缩")).toBeVisible();

  // 继续对话正常
  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("接着刚才的计划，我今天先完成什么？");
  await composer.getByLabel("发送").click();
  await expect(page.getByTestId("kiro-message").last()).toContainText("建议先完成统计学作业", { timeout: 10000 });

  // History 仍存在（没有被删除）
  await page.getByLabel("展开对话").click();
  await expect(page.getByRole("dialog", { name: "对话" }).getByText("长对话测试")).toBeVisible();
});
