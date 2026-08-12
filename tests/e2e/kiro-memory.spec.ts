import { expect, test, Page } from "@playwright/test";

/**
 * Kiro Memory（Task 9）E2E：
 * 1) 记忆开关关闭 → save_memory 工具被拒绝（不回传保存、不写入）
 * 2) 保存记忆 → Settings 管理（编辑 / 删除 / 重新保存 / 清空全部）
 * 3) More 菜单 → Kiro 记忆入口打开 Manager
 */

const AI_SETTINGS = {
  enabled: true,
  provider: "deepseek",
  model: "deepseek-v4-flash",
  custom: { providerName: "", baseURL: "", model: "" },
};

function sse(body: string): string {
  return (
    body
      .split("\n")
      .filter(Boolean)
      .map((line) => `data: ${line}`)
      .join("\n\n") + "\n\n"
  );
}

function saveMemoryTurn(content = "我一般晚上学习", category = "study-habit") {
  return sse(
    [
      JSON.stringify({ type: "start", messageId: "mock-mem-1" }),
      JSON.stringify({ type: "start-step" }),
      JSON.stringify({ type: "tool-input-start", toolCallId: "call_m1", toolName: "save_memory" }),
      JSON.stringify({ type: "tool-input-delta", toolCallId: "call_m1", inputTextDelta: JSON.stringify({ content, category }) }),
      JSON.stringify({ type: "tool-input-available", toolCallId: "call_m1", toolName: "save_memory", input: { content, category } }),
      JSON.stringify({ type: "finish-step" }),
      JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
    ].join("\n")
  );
}

function finalTextTurn(text: string) {
  return sse(
    [
      JSON.stringify({ type: "start", messageId: "mock-mem-2" }),
      JSON.stringify({ type: "start-step" }),
      JSON.stringify({ type: "text-start", id: "mem-txt" }),
      JSON.stringify({ type: "text-delta", id: "mem-txt", delta: text }),
      JSON.stringify({ type: "text-end", id: "mem-txt" }),
      JSON.stringify({ type: "finish-step" }),
      JSON.stringify({ type: "finish", finishReason: "stop" }),
    ].join("\n")
  );
}

/**
 * 轮次判定：最后一条消息是 user（新请求）→ 发 save_memory 工具调用；
 * 最后一条 assistant 消息含 output-available 工具输出 → 本轮回最终文本。
 * （ai-sdk 会把同一次流中的 tool 步骤与文本步骤合并进同一条 assistant 消息）
 */
function roundKind(body: { messages?: { role?: string; parts?: { type?: string; state?: string }[] }[] }): "tool" | "final" {
  const msgs = body?.messages ?? [];
  const last = msgs[msgs.length - 1];
  if (!last || last.role === "user") return "tool";
  const toolParts = (last.parts ?? []).filter((p) => p.type?.startsWith("tool-"));
  if (toolParts.length === 0) return "tool";
  return toolParts[toolParts.length - 1].state === "output-available" ? "final" : "tool";
}

async function openKiro(page: Page) {
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await expect(page.getByTestId("kiro-workspace")).toBeVisible();
}

async function openMemoryManagerFromSettings(page: Page) {
  await page.locator("aside").first().getByRole("button", { name: "设置" }).click();
  await page.getByRole("navigation", { name: "设置导航" }).getByRole("button", { name: "Kiro 与 AI" }).click();
  const kiroSection = page.getByTestId("settings-kiro");
  await expect(kiroSection).toBeVisible();
  await kiroSection.getByRole("button", { name: "管理" }).click();
  await expect(page.getByTestId("kiro-memory-manager")).toBeVisible();
}

test("记忆开关关闭：save_memory 被拒绝（错误回传模型）且不写入", async ({ page }) => {
  let rejectedCode = "";
  let rejectedMessage = "";
  await page.route("**/api/ai/chat", async (route) => {
    const body = route.request().postDataJSON() as {
      messages?: { role?: string; parts?: { type?: string; state?: string; output?: { ok?: boolean; code?: string; message?: string } }[] }[];
    };
    if (roundKind(body) === "tool") {
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: saveMemoryTurn() });
      return;
    }
    const toolOutputs = (body?.messages ?? []).flatMap((m) =>
      (m.parts ?? []).filter((p) => p.type?.startsWith("tool-") && p.state === "output-available")
    );
    const failed = toolOutputs.find((p) => p.output?.ok === false);
    rejectedCode = failed?.output?.code ?? "";
    rejectedMessage = failed?.output?.message ?? "";
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: finalTextTurn("好的。") });
  });

  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: { ...settings, memoryEnabled: false } }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await openKiro(page);

  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("记住我一般晚上学习");
  await composer.getByLabel("发送").click();
  await expect(page.getByTestId("kiro-message").last()).toContainText("好的。", { timeout: 10000 });

  // 模型收到了明确的工具错误（而不是成功结果）
  expect(rejectedCode).toBe("MEMORY_DISABLED");
  expect(rejectedMessage).toContain("记忆已关闭");

  // 未写入：Settings 管理中 0 条
  await openMemoryManagerFromSettings(page);
  await expect(page.getByTestId("kiro-memory-manager")).toContainText("暂无记忆");
});

test("保存记忆 → Settings 管理：编辑 / 删除 / 重新保存 / 清空全部", async ({ page }) => {
  let turns = 0;
  await page.route("**/api/ai/chat", async (route) => {
    const body = route.request().postDataJSON() as {
      messages?: { role?: string; parts?: { type?: string; state?: string }[] }[];
    };
    if (roundKind(body) === "tool") {
      turns++;
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: saveMemoryTurn(turns === 1 ? "我一般晚上学习" : "我周末写作业") });
      return;
    }
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: finalTextTurn(turns === 1 ? "好的，以后我都会记得你一般晚上学习。" : "好的，以后周末都提醒你写作业。") });
  });

  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await openKiro(page);

  // 1. 对话中保存记忆
  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("记住我一般晚上学习");
  await composer.getByLabel("发送").click();
  await expect(page.getByTestId("kiro-message").last()).toContainText("晚上学习", { timeout: 10000 });
  await expect(page.getByText("Kiro 已记住：我一般晚上学习").first()).toBeVisible();

  // 2. Settings → 管理 → 列表可见（含分类标签）
  await openMemoryManagerFromSettings(page);
  const manager = page.getByTestId("kiro-memory-manager");
  await expect(manager).toContainText("我一般晚上学习");
  await expect(manager).toContainText("学习习惯 · 全局");

  // 3. 编辑标题并保存
  await manager.getByRole("button", { name: "编辑记忆 我一般晚上学习" }).click();
  const titleInput = manager.getByLabel("记忆标题");
  await titleInput.fill("晚间高效学习");
  await manager.getByRole("button", { name: "保存" }).click();
  await expect(manager).toContainText("晚间高效学习");

  // 4. 删除
  await manager.getByRole("button", { name: "删除记忆 晚间高效学习" }).click();
  await expect(manager).toContainText("暂无记忆");
  await manager.getByRole("button", { name: "关闭记忆" }).click();
  await expect(manager).not.toBeVisible();
  // 关闭设置弹窗
  await page.getByRole("dialog", { name: "设置" }).getByRole("button", { name: "关闭" }).click();
  await expect(page.getByRole("dialog", { name: "设置" })).toHaveCount(0);

  // 5. 重新保存后清空全部（带确认）
  await composer.getByLabel("Ask Kiro").fill("记住我周末写作业");
  await composer.getByLabel("发送").click();
  await expect(page.getByTestId("kiro-message").last()).toContainText("周末都提醒你写作业", { timeout: 10000 });
  await openMemoryManagerFromSettings(page);
  const manager2 = page.getByTestId("kiro-memory-manager");
  await expect(manager2).toContainText("周末写作业");
  await manager2.getByRole("button", { name: "清空全部" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "清空" }).click();
  await expect(manager2).toContainText("暂无记忆");
});

test("More 菜单 → Kiro 记忆入口打开 Manager", async ({ page }) => {
  await page.route("**/api/ai/chat", async (route) => {
    const body = route.request().postDataJSON() as {
      messages?: { role?: string; parts?: { type?: string; state?: string }[] }[];
    };
    if (roundKind(body) === "tool") {
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: saveMemoryTurn() });
      return;
    }
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: finalTextTurn("已记住。") });
  });

  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await openKiro(page);

  // 先保存一条，保证 Manager 有内容
  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("记住我一般晚上学习");
  await composer.getByLabel("发送").click();
  await expect(page.getByText("Kiro 已记住：我一般晚上学习").first()).toBeVisible();

  // More → Kiro 记忆
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "Kiro 记忆" }).click();
  const manager = page.getByTestId("kiro-memory-manager");
  await expect(manager).toBeVisible();
  await expect(manager).toContainText("我一般晚上学习");
  await manager.getByRole("button", { name: "关闭记忆" }).click();
  await expect(manager).not.toBeVisible();
});

test("Task 2C3B：编辑态 Esc 只退出编辑，再 Esc 关闭 Manager", async ({ page }) => {
  await page.route("**/api/ai/chat", async (route) => {
    const body = route.request().postDataJSON() as {
      messages?: { role?: string; parts?: { type?: string; state?: string }[] }[];
    };
    if (roundKind(body) === "tool") {
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: saveMemoryTurn() });
      return;
    }
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: finalTextTurn("已记住。") });
  });

  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await openKiro(page);

  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("记住我一般晚上学习");
  await composer.getByLabel("发送").click();
  await expect(page.getByText("Kiro 已记住：我一般晚上学习").first()).toBeVisible();

  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "Kiro 记忆" }).click();
  const manager = page.getByTestId("kiro-memory-manager");
  await expect(manager).toBeVisible();

  // 进入编辑态 → 第一次 Esc 只退出编辑，Manager 仍在
  await manager.getByRole("button", { name: "编辑记忆 我一般晚上学习" }).click();
  await expect(manager.getByLabel("记忆标题")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(manager.getByLabel("记忆标题")).toHaveCount(0);
  await expect(manager).toBeVisible();

  // 第二次 Esc → Manager 关闭
  await page.keyboard.press("Escape");
  await expect(manager).not.toBeVisible();
});
