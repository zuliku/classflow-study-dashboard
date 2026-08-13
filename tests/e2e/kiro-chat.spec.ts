import { expect, test } from "@playwright/test";

/**
 * Kiro Chat 核心 E2E（Task 1）：mock /api/ai/chat，
 * 验证：进入 Kiro → 输入 → user message → assistant 流式/最终 response。
 * 同时验证错误路径（INVALID_API_KEY → 错误提示 + 重试/设置入口）。
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

function chatSSE(content: string): string {
  return sse(
    [
      JSON.stringify({ type: "start", messageId: "mock-msg-1" }),
      JSON.stringify({ type: "text-start", id: "mock-text" }),
      ...content.split(/(?<=。)/).map((seg) =>
        seg ? JSON.stringify({ type: "text-delta", id: "mock-text", delta: seg }) : null
      ).filter(Boolean),
      JSON.stringify({ type: "text-end", id: "mock-text" }),
      JSON.stringify({ type: "finish", finishReason: "stop" }),
    ].join("\n")
  );
}

test("Kiro Chat：输入消息 → 流式回复最终渲染；错误路径显示归一化提示", async ({ page }) => {
  let chatCalls = 0;
  await page.route("**/api/ai/chat", async (route) => {
    chatCalls++;
    const body = route.request().postDataJSON() as { apiKey?: string; messages?: unknown[] };
    // 安全断言：API Key 必须通过请求体转发（服务端代理模式），且本测试用 mock key
    if (body?.apiKey !== "sk-test-key") {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ code: "INVALID_API_KEY", message: "缺少 API Key。" }),
      });
      return;
    }
    if (chatCalls === 2) {
      // 第二次请求：模拟 API Key 无效
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sse(JSON.stringify({ type: "error", errorText: JSON.stringify({ code: "INVALID_API_KEY", message: "API Key 无效，请在设置中检查。" }) })),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: chatSSE("你好！我是 Kiro。这是来自模拟服务的流式回复，用于验证真实聊天链路。"),
    });
  });

  // 配置 AI（localStorage 设置 + sessionStorage API Key）
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await expect(page.getByTestId("kiro-workspace")).toBeVisible();

  // 输入并发送
  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("什么是工具变量？");
  await composer.getByLabel("发送").click();

  // user message 出现
  await expect(page.getByTestId("kiro-user-message")).toContainText("什么是工具变量？");
  // assistant 最终 response 出现（含 mock 文本）
  await expect(page.getByTestId("kiro-message").last()).toContainText("流式回复", { timeout: 10000 });
  await expect(chatCalls).toBe(1);

  // 错误路径：再发一条 → INVALID_API_KEY → 错误提示 + 重试/设置按钮
  await composer.getByLabel("Ask Kiro").fill("再问一个问题");
  await composer.getByLabel("发送").click();
  await expect(page.getByTestId("kiro-error")).toContainText("Kiro 暂时没有完成回复", { timeout: 10000 });
  await expect(page.getByTestId("kiro-error")).toContainText("API Key 无效");
  await expect(page.getByTestId("kiro-error").getByRole("button", { name: "重试" })).toBeVisible();
  await expect(page.getByTestId("kiro-error").getByRole("button", { name: "打开设置" })).toBeVisible();
});

test("Kiro Chat：streaming 时 Send 变为 Stop，点击停止生成", async ({ page }) => {
  await page.route("**/api/ai/chat", async (route) => {
    // 延迟响应：让请求保持 in-flight（submitted/streaming），Stop 按钮可观测
    await new Promise((r) => setTimeout(r, 3000));
    const chunks = [
      JSON.stringify({ type: "start", messageId: "mock-msg-1" }),
      JSON.stringify({ type: "text-start", id: "mock-text" }),
      JSON.stringify({ type: "text-delta", id: "mock-text", delta: "正在生成" }),
      JSON.stringify({ type: "text-end", id: "mock-text" }),
      JSON.stringify({ type: "finish", finishReason: "stop" }),
    ];
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sse(chunks.join("\n")),
    });
  });

  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();

  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("开始生成");
  await composer.getByLabel("发送").click();

  // 请求进行中：Send 变为 Stop，点击后立即停止并恢复 Send
  const stopBtn = composer.getByLabel("停止生成");
  await expect(stopBtn).toBeVisible({ timeout: 5000 });
  await stopBtn.click();
  await expect(composer.getByLabel("发送")).toBeVisible({ timeout: 5000 });
});

test("Kiro Read Tool：tool call → 客户端执行 → 自动继续 → 最终回答 + Worklog", async ({ page }) => {
  let requests = 0;
  let releaseFinal!: () => void;
  const finalGate = new Promise<void>((resolve) => {
    releaseFinal = resolve;
  });
  await page.route("**/api/ai/chat", async (route) => {
    requests++;
    const body = route.request().postDataJSON() as { messages: { role: string; parts?: { type: string; state?: string }[] }[] };
    const hasToolOutput = (body?.messages ?? []).some(
      (m) =>
        m.role === "assistant" &&
        (m.parts ?? []).some((p) => p.type.startsWith("tool-") && p.state === "output-available")
    );

    if (!hasToolOutput) {
      // 第一轮：模型发出 get_upcoming_assignments tool call（含 step 边界，与真实 server 一致）
      const chunks = [
        JSON.stringify({ type: "start", messageId: "mock-msg-1" }),
        JSON.stringify({ type: "start-step" }),
        JSON.stringify({ type: "tool-input-start", toolCallId: "call_1", toolName: "get_upcoming_assignments" }),
        JSON.stringify({ type: "tool-input-delta", toolCallId: "call_1", inputTextDelta: '{"days":7}' }),
        JSON.stringify({ type: "tool-input-available", toolCallId: "call_1", toolName: "get_upcoming_assignments", input: { days: 7 } }),
        JSON.stringify({ type: "finish-step" }),
        JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
      ];
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(chunks.join("\n")) });
      return;
    }
    // 第二轮：客户端已执行工具并回传 output → 最终回答（新的 step，无 tool call）
    await finalGate;
    const chunks = [
      JSON.stringify({ type: "start", messageId: "mock-msg-1" }),
      JSON.stringify({ type: "start-step" }),
      JSON.stringify({ type: "text-start", id: "mock-text-2" }),
      JSON.stringify({ type: "text-delta", id: "mock-text-2", delta: "你最近的 DDL 是统计学作业，明天 23:59 截止。我可以帮你分析，但目前只能读取、不能修改。" }),
      JSON.stringify({ type: "text-end", id: "mock-text-2" }),
      JSON.stringify({ type: "finish-step" }),
      JSON.stringify({ type: "finish", finishReason: "stop" }),
    ];
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(chunks.join("\n")) });
  });

  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();

  // 发送问题 → 第一轮 tool call
  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("我最近有什么 DDL？");
  await composer.getByLabel("发送").click();
  await expect(page.getByTestId("kiro-user-message")).toContainText("我最近有什么 DDL？");

  // 工具已完成、最终文本尚未到达：折叠摘要也明确进入 compose 阶段，并由 live region 播报。
  const worklog = page.getByTestId("kiro-worklog");
  await expect(worklog.getByRole("status")).toHaveText("正在整理回答", { timeout: 10000 });
  releaseFinal();

  // 客户端执行工具并自动继续：最终回答出现
  await expect(page.getByTestId("kiro-message").last()).toContainText("你最近的 DDL 是统计学作业", { timeout: 10000 });
  // 第二轮回传包含 tool output（客户端确实执行并回传了）
  expect(requests).toBe(2);

  // Agent Worklog：完成后保持低噪声摘要；不泄漏原始工具名/JSON。
  await expect(worklog).toContainText("已完成 1 个步骤");
  await expect(worklog.getByText("get_upcoming_assignments")).toHaveCount(0);

  // Worklog disclosure（IM2B）：进入 answering 自动折叠 → summary aria-expanded=false；
  // 点击展开 → true + tool row 真实详情可见（expandable 才有 Chevron/disclosure）
  const summary = worklog.getByRole("button").first();
  await expect(summary).toHaveAttribute("aria-expanded", "false");
  await summary.click();
  await expect(summary).toHaveAttribute("aria-expanded", "true");

  const toolRow = worklog.getByRole("button").nth(1);
  await expect(toolRow).toHaveAttribute("aria-expanded", "false");
  await toolRow.click();
  await expect(toolRow).toHaveAttribute("aria-expanded", "true");
  // tool detail 内容（safeDetails）可见且 data-state=open
  await expect(worklog.locator('[data-state="open"]').first()).toBeVisible();
});

test("Kiro Write Tool：search → set_assignment_ddl → Action Card → 持久化 → Undo", async ({ page }) => {
  // Seed：统计学作业 DDL 今天 23:59
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const local = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now = new Date();
  const dow = now.getDay() === 0 ? 7 : now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dow - 1));
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowStr = local(tomorrow);
  const todayStr = local(now);

  await page.addInitScript(
    ({ today, monday, tomorrowStr, settings, key }) => {
      if (!localStorage.getItem("classflow-storage-v2")) {
        const state = {
        userProfile: { name: "测试", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
        semester: { id: "sem", name: "测试学期", startDate: monday, totalWeeks: 16 },
        courses: [{ id: "c1", name: "统计学", code: "STAT101", teacher: "李老师", classroom: "教101", credit: 3, bgHex: "#E7E3D8", borderHex: "#D5CDBE", textHex: "#313032", description: "", materials: [] }],
        schedules: [],
        assignments: [{ id: "a1", courseId: "c1", title: "统计学作业", description: "", ddl: `${today}T23:59:00`, priority: "medium", status: "todo", progress: 0, tags: [] }],
        calendarMarks: [{ id: "cm1", date: today, type: "ddl", title: "统计学作业", sourceId: "a1" }],
        groupProjects: [],
        assignmentTimeSlice: "all", lastWorkspaceTab: "overview",
        preferences: { showWeekends: true, ddlWarningDays: 7, defaultDDLTime: "23:59", enableScheduleDirectManipulation: true, enableDDLDirectManipulation: true, motionPreference: "system", startupView: "overview", defaultTaskPriority: "medium", defaultTaskStatus: "todo", enableSingleKeyShortcuts: true, contentDensity: "comfortable" },
      };
      localStorage.setItem("classflow-storage-v2", JSON.stringify({ version: 3, state }));
      }
      localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
      sessionStorage.setItem("classflow-ai-key:deepseek", key);
      (window as any).__tomorrowStr = tomorrowStr;
    },
    { today: todayStr, monday: local(monday), tomorrowStr, settings: AI_SETTINGS, key: "sk-test-key" }
  );

  let requests = 0;
  await page.route("**/api/ai/chat", async (route) => {
    requests++;
    const body = route.request().postDataJSON() as { messages: { role: string; parts?: { type: string; state?: string; input?: unknown; output?: { ok: boolean; data?: { id?: string; items?: { id: string }[] } } }[] }[] };
    const toolParts = (body?.messages ?? []).filter((m) => m.role === "assistant").flatMap((m) => m.parts ?? []).filter((p) => p.type.startsWith("tool-") && p.state === "output-available");

    // 第 1 轮：search_assignments
    if (toolParts.length === 0) {
      const chunks = [
        JSON.stringify({ type: "start", messageId: "mock-msg-1" }),
        JSON.stringify({ type: "start-step" }),
        JSON.stringify({ type: "tool-input-start", toolCallId: "call_1", toolName: "search_assignments" }),
        JSON.stringify({ type: "tool-input-delta", toolCallId: "call_1", inputTextDelta: '{"query":"统计学"}' }),
        JSON.stringify({ type: "tool-input-available", toolCallId: "call_1", toolName: "search_assignments", input: { query: "统计学" } }),
        JSON.stringify({ type: "finish-step" }),
        JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
      ];
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(chunks.join("\n")) });
      return;
    }
    // 第 2 轮：从真实 tool output 中取 assignmentId → set_assignment_ddl
    if (toolParts.length === 1) {
      const searchOut = toolParts[0].output as { data?: { items?: { id: string }[] } };
      const assignmentId = searchOut?.data?.items?.[0]?.id ?? "a1";
      const chunks = [
        JSON.stringify({ type: "start", messageId: "mock-msg-1" }),
        JSON.stringify({ type: "start-step" }),
        JSON.stringify({ type: "tool-input-start", toolCallId: "call_2", toolName: "set_assignment_ddl" }),
        JSON.stringify({ type: "tool-input-delta", toolCallId: "call_2", inputTextDelta: JSON.stringify({ assignmentId, ddl: `${tomorrowStr}T22:00:00` }) }),
        JSON.stringify({ type: "tool-input-available", toolCallId: "call_2", toolName: "set_assignment_ddl", input: { assignmentId, ddl: `${tomorrowStr}T22:00:00` } }),
        JSON.stringify({ type: "finish-step" }),
        JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
      ];
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(chunks.join("\n")) });
      return;
    }
    // 第 3 轮：最终回答
    const chunks = [
      JSON.stringify({ type: "start", messageId: "mock-msg-1" }),
      JSON.stringify({ type: "start-step" }),
      JSON.stringify({ type: "text-start", id: "txt3" }),
      JSON.stringify({ type: "text-delta", id: "txt3", delta: "已调整统计学作业的截止时间到明天 22:00。" }),
      JSON.stringify({ type: "text-end", id: "txt3" }),
      JSON.stringify({ type: "finish-step" }),
      JSON.stringify({ type: "finish", finishReason: "stop" }),
    ];
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(chunks.join("\n")) });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("把统计学作业改到明天晚上十点");
  await composer.getByLabel("发送").click();

  // 最终回答 + Action Card
  await expect(page.getByTestId("kiro-message").last()).toContainText("已调整统计学作业", { timeout: 15000 });
  const card = page.getByTestId("kiro-action-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("已调整任务");
  await expect(card).toContainText("撤销");
  expect(requests).toBe(3);

  // Store 真实改变：DDL + CalendarMark 同步（localStorage 即持久化数据库）
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("classflow-storage-v2")!;
    const s = JSON.parse(raw).state;
    return { ddl: s.assignments[0].ddl, markDate: s.calendarMarks[0].date };
  });
  expect(stored.ddl).toBe(`${tomorrowStr}T22:00:00`);
  expect(stored.markDate).toBe(tomorrowStr);

  // Undo 恢复原 DDL（Card 撤销）
  await card.getByRole("button", { name: "撤销" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem("classflow-storage-v2")!).state;
        return { ddl: s.assignments[0].ddl, markDate: s.calendarMarks[0].date };
      })
    )
    .toEqual({ ddl: `${todayStr}T23:59:00`, markDate: todayStr });

  // 刷新后仍保持（写入与撤销都真实持久化）
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem("classflow-storage-v2")!).state;
        return s.assignments[0].ddl;
      })
    )
    .toBe(`${todayStr}T23:59:00`);
});

test("Kiro Markdown：heading / table / strong / list 真实渲染，无原始符号", async ({ page }) => {
  await page.route("**/api/ai/chat", async (route) => {
    const md = "## 最近 DDL\n\n| 日期 | 任务 | 课程 |\n| --- | --- | --- |\n| 8 月 9 日 | 高数习题 | 高等数学 |\n\n- **高优先级**\n- 尽快处理";
    const chunks = [
      JSON.stringify({ type: "start", messageId: "mock-md-1" }),
      JSON.stringify({ type: "start-step" }),
      JSON.stringify({ type: "text-start", id: "md-text" }),
      JSON.stringify({ type: "text-delta", id: "md-text", delta: md }),
      JSON.stringify({ type: "text-end", id: "md-text" }),
      JSON.stringify({ type: "finish-step" }),
      JSON.stringify({ type: "finish", finishReason: "stop" }),
    ];
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(chunks.join("\n")) });
  });

  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("查看最近 DDL");
  await composer.getByLabel("发送").click();

  const msg = page.getByTestId("kiro-message").last();
  await expect(msg.getByRole("heading", { level: 2 })).toHaveText("最近 DDL", { timeout: 10000 });
  // 真实 table（含表头与单元格）
  const table = msg.locator("table");
  await expect(table).toBeVisible();
  await expect(table.locator("th")).toHaveText(["日期", "任务", "课程"]);
  await expect(table.locator("td").first()).toHaveText("8 月 9 日");
  // strong + list
  await expect(msg.locator("strong")).toHaveText("高优先级");
  await expect(msg.locator("li")).toHaveCount(2);
  // 不显示原始 Markdown 符号
  await expect(msg.getByText("| --- |")).toHaveCount(0);
  await expect(msg.getByText("**")).toHaveCount(0);
  await expect(msg.getByText("## 最近 DDL")).toHaveCount(0);
  // 页面无横向溢出（长表格内部滚动）
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
});

test("Kiro Attachment：上传 PDF → 本地解析 ready → 发送 → 附件 context 到达 Mock → 回答", async ({ page }) => {
  const { buildMinimalPdf } = require("../fixtures/files");
  let receivedContext = "";
  await page.route("**/api/ai/chat", async (route) => {
    const body = route.request().postDataJSON() as { attachmentsContext?: { name?: string; text?: string }[] };
    receivedContext = body?.attachmentsContext?.[0]?.text ?? "";
    const md = "根据《测试讲义.pdf》的正文，这份资料介绍了回归分析的要点。";
    const chunks = [
      JSON.stringify({ type: "start", messageId: "mock-att-1" }),
      JSON.stringify({ type: "start-step" }),
      JSON.stringify({ type: "text-start", id: "att-text" }),
      JSON.stringify({ type: "text-delta", id: "att-text", delta: md }),
      JSON.stringify({ type: "text-end", id: "att-text" }),
      JSON.stringify({ type: "finish-step" }),
      JSON.stringify({ type: "finish", finishReason: "stop" }),
    ];
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(chunks.join("\n")) });
  });

  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();

  const composer = page.getByTestId("kiro-composer");
  await expect(composer).toBeVisible();

  // 通过 + 菜单 → 上传文件 → filechooser 提供 PDF
  const chooserPromise = page.waitForEvent("filechooser");
  await composer.getByLabel("添加附件").click();
  await page.getByRole("menuitem", { name: "上传文件" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "测试讲义.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(buildMinimalPdf("ClassFlow PDF test document")),
  });

  // 附件 chip：正在读取 → 已就绪（本地解析，不发送）
  const chip = page.getByTestId("kiro-attachment-chip");
  await expect(chip).toContainText("测试讲义.pdf", { timeout: 15000 });
  await expect(chip).toContainText("PDF", { timeout: 15000 });
  await expect(page.getByText("文件内容会发送给当前选择的 AI 服务以完成你的请求。")).toBeVisible();

  // 发送 → Mock 收到附件 context（真实提取文本）→ 回答引用文件
  await composer.getByLabel("Ask Kiro").fill("这份资料讲了什么？");
  await composer.getByLabel("发送").click();
  await expect(page.getByTestId("kiro-message").last()).toContainText("测试讲义", { timeout: 10000 });
  await expect(receivedContext).toContain("ClassFlow PDF test document");

  // 用户消息显示附件 chip（不显示提取全文）
  await expect(page.getByTestId("kiro-sent-attachment")).toContainText("测试讲义.pdf");
  await expect(page.getByTestId("kiro-user-message")).not.toContainText("ClassFlow PDF test document");
});
