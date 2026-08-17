import { test as base, expect } from "@playwright/test";

/**
 * Task/DDL Detail Panel（Task/DDL Detail Panel UX Refresh）focused E2E。
 * A. Timeline → Assignment card → floating panel（有界、非贴边）打开，首屏核心可见
 * B. 已打开时点击另一任务 → outer shell 保持同一 DOM 节点，仅内容替换（不 close/reopen）
 * C. Escape → exit presence → 关闭 → focus 回到原 trigger
 * D. linked DDL（sourceId=assignment）→ 只打开 Assignment 详情，不出现第二套 DDL 详情
 * E. independent DDL mark → 轻量 DDL 详情（无 Assignment 专属字段）
 * F. reduced motion 下面板正常开合
 */

function dayAnchor(): { monday: string } {
  const now = new Date();
  const w = now.getDay() === 0 ? 7 : now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (w - 1));
  const p = (n: number) => String(n).padStart(2, "0");
  return { monday: `${mon.getFullYear()}-${p(mon.getMonth() + 1)}-${p(mon.getDate())}` };
}

function seedScript(monday: string, opts?: { reducedMotion?: boolean }) {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  // 相对本周一偏移：a1=周一（最左列）、a2=周二（第二列，面板打开时不被右侧浮层遮挡）
  const iso = (dayOffset: number, h: number, m: number) => {
    const mon = new Date(`${monday}T00:00:00`);
    const d = new Date(mon);
    d.setDate(mon.getDate() + dayOffset);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(h)}:${pad2(m)}:00`;
  };
  const dateStr = (dayOffset: number) => iso(dayOffset, 0, 0).slice(0, 10);
  return `(() => {
    if (localStorage.getItem("classflow-storage-v2")) return;
    // 独立 DDL：now+1h 的未来时刻（date 与 time 取自同一 later，跨午夜安全）
    const later = new Date(Date.now() + 3600000);
    const pad = (n) => String(n).padStart(2, "0");
    const laterDate = later.getFullYear() + "-" + pad(later.getMonth() + 1) + "-" + pad(later.getDate());
    const laterTime = pad(later.getHours()) + ":" + pad(later.getMinutes());
    localStorage.setItem("classflow-storage-v2", JSON.stringify({
      version: 6,
      state: {
        userProfile: { name: "测试", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
        semester: { id: "s", name: "S", startDate: "${monday}", totalWeeks: 16 },
        courses: [{ id: "c1", name: "概率论与数理统计", code: "STAT", teacher: "", classroom: "", credit: 3, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [] }],
        schedules: [],
        assignments: [
          { id: "a1", courseId: "c1", title: "置信区间作业", description: "推导置信区间公式", ddl: "${iso(0, 21, 0)}", priority: "high", status: "todo", progress: 20, tags: ["统计"], subtasks: [{ id: "st1", title: "整理笔记", completed: false }] },
          { id: "a2", courseId: "c1", title: "假设检验作业", description: "", ddl: "${iso(1, 20, 0)}", priority: "medium", status: "todo", progress: 0, tags: [] },
        ],
        calendarMarks: [
          { id: "cm-linked", date: "${dateStr(0)}", type: "ddl", title: "置信区间作业", sourceId: "a1" },
          { id: "cm1", date: laterDate, type: "ddl", title: "交项目报告", startTime: laterTime },
          { id: "cm2", date: "${dateStr(1)}", type: "ddl", title: "交结课报告", startTime: "12:00" },
        ],
        groupProjects: [],
        studyBlocks: [
          // 90 分钟时段：验证详情时长显示准确（1 小时 30 分，不 round 成 2 小时）
          { id: "b1", title: "置信区间作业", date: "${dateStr(0)}", startTime: "19:00", endTime: "20:30", assignmentId: "a1", source: "manual" },
        ],
        assignmentTimeSlice: "all",
        preferences: { showWeekends: true, ddlWarningDays: 3, defaultDDLTime: "23:59", enableScheduleDirectManipulation: true, enableDDLDirectManipulation: true, motionPreference: "${opts?.reducedMotion ? "reduced" : "system"}", startupView: "overview", defaultTaskPriority: "medium", defaultTaskStatus: "todo", enableSingleKeyShortcuts: true, contentDensity: "comfortable", defaultTaskWorkspaceView: "focus", defaultDeadlineReminderMinutes: 1440 },
        reminders: [],
        focusSessions: [],
      },
    }));
  })()`;
}

async function openTimeline(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "时间表" }).first().click();
  await expect(page.getByText(/第 \d+ 周/).first()).toBeVisible();
}

base("A：Timeline 点击 Assignment → floating panel 有界打开，首屏核心可见", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await openTimeline(page);

  await page.getByRole("button", { name: /置信区间作业.*截止/ }).click();

  const dialog = page.getByRole("dialog", { name: "任务详情" });
  await expect(dialog).toBeVisible({ timeout: 8000 });
  const panel = page.getByTestId("assignment-detail-panel");
  await expect(panel).toBeVisible();
  // floating 是 non-blocking contextual panel：不声明 aria-modal（不冒充 modal）
  await expect(dialog).not.toHaveAttribute("aria-modal", "true");
  // 等 enter 动画（230ms transform/opacity）settle 后再测量几何
  await expect(async () => {
    const transform = await panel.evaluate((el) => getComputedStyle(el).transform);
    expect(transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)").toBe(true);
  }).toPass({ timeout: 5000 });

  // 有界浮层：不贴满 viewport（右侧 + 上下 inset；宽度 ≈ 470）
  const box = (await panel.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(400);
  expect(box.width).toBeLessThanOrEqual(500);
  expect(box.x + box.width).toBeLessThanOrEqual(1440 - 10); // 右侧 16px inset
  expect(box.y).toBeGreaterThanOrEqual(10); // 顶部 16px inset
  expect(box.height).toBeLessThan(900);

  // 首屏核心：标题 / 截止 / 状态 / 主操作
  await expect(dialog.getByRole("heading", { name: "置信区间作业" })).toBeVisible();
  await expect(dialog.getByText("截止时间", { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText(/还有|已逾期/).first()).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "任务状态" })).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "优先级" })).toBeVisible();
  const actions = dialog.getByTestId("detail-primary-actions");
  await expect(actions.getByRole("button", { name: "标记完成" })).toBeVisible();
  await expect(actions.getByRole("button", { name: "日程" })).toBeVisible();
  await expect(actions.getByRole("button", { name: "提醒" })).toBeVisible();
  await expect(actions.getByRole("button", { name: "编辑" })).toBeVisible();

  // 首屏无重卡噪音：进度/子任务/资料默认不占据首屏同等权重（资料默认 collapsed）
  await expect(dialog.getByRole("button", { name: /关联资料/ })).toHaveAttribute("aria-expanded", "false");
});

base("B：已打开时点击另一任务 → outer shell 同一 DOM 节点，内容就地替换", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await openTimeline(page);

  await page.getByRole("button", { name: /置信区间作业.*截止/ }).click();
  const panel = page.getByTestId("assignment-detail-panel");
  await expect(panel).toBeVisible({ timeout: 8000 });
  const shellHandle = await panel.evaluateHandle((node) => node);
  const sameShell = await shellHandle.evaluate(
    (node) => node === document.querySelector('[data-testid="assignment-detail-panel"]')
  );
  expect(sameShell).toBe(true);

  // 移开鼠标避免 hover preview 遮挡，再点击第二任务
  await page.mouse.move(20, 20);
  await page.getByRole("button", { name: /假设检验作业.*截止/ }).click();

  // 面板从未卸载（同一节点）→ 内容替换为第二任务
  const stillSame = await shellHandle.evaluate(
    (node) => node === document.querySelector('[data-testid="assignment-detail-panel"]')
  );
  expect(stillSame).toBe(true);
  await expect(panel.getByRole("heading", { name: "假设检验作业" })).toBeVisible({ timeout: 8000 });
  await expect(panel.getByRole("heading", { name: "置信区间作业" })).toHaveCount(0);
  // 开关状态无闪断：任意时刻 DOM 中始终恰有 1 个 shell
  await expect(page.getByTestId("assignment-detail-panel")).toHaveCount(1);
});

base("C：Escape → exit presence → 关闭 → focus 回到原 trigger", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await openTimeline(page);

  const trigger = page.getByRole("button", { name: /置信区间作业.*截止/ });
  await trigger.click();
  const panel = page.getByTestId("assignment-detail-panel");
  await expect(panel).toBeVisible({ timeout: 8000 });

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0, { timeout: 8000 });
  // 焦点回到打开面板的 deadline point
  const focused = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el?.getAttribute("aria-label") ?? "";
  });
  expect(focused).toContain("置信区间作业");
});

base("D：linked DDL（sourceId=assignment）→ 只打开 Assignment 详情，无第二套 DDL 详情", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await openTimeline(page);

  await page.getByRole("button", { name: /置信区间作业.*截止/ }).click();

  await expect(page.getByRole("dialog", { name: "任务详情" })).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole("dialog", { name: "截止详情" })).toHaveCount(0);
});

base("E：independent DDL mark → 轻量 DDL 详情（无 Assignment 专属字段）", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await openTimeline(page);

  await page.getByRole("button", { name: /交项目报告.*截止/ }).click();

  const dialog = page.getByRole("dialog", { name: "截止详情" });
  await expect(dialog).toBeVisible({ timeout: 8000 });
  await expect(dialog.getByRole("heading", { name: "交项目报告" })).toBeVisible();
  await expect(dialog.getByText("截止时间", { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText(/还有|已逾期/).first()).toBeVisible();
  await expect(
    dialog.getByTestId("detail-primary-actions").getByRole("button", { name: "提醒" })
  ).toBeVisible();
  // 不发明 Assignment 专属字段
  await expect(dialog.getByText("进度", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("子任务", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("关联资料", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "任务详情" })).toHaveCount(0);

  // 轻量 DDL 详情可添加 preset 提醒（展开提醒区；锚点 = now+1h → 提前 10 分钟必可用）
  // hydrate 已为该 mark 生成 auto（due-time）→ 添加后共 2 个 scheduled
  await page.getByTestId("ddl-reminder-disclosure-trigger").click();
  await expect(dialog.getByRole("button", { name: "提前 10 分钟" })).toBeVisible();
  await dialog.getByRole("button", { name: "提前 10 分钟" }).click();
  await expect(dialog.getByText("2 个提醒", { exact: true }).first()).toBeVisible();
});

base("F：reduced motion 下面板正常开合（不依赖动画完成）", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday, { reducedMotion: true }));
  await openTimeline(page);

  await page.getByRole("button", { name: /置信区间作业.*截止/ }).click();
  const panel = page.getByTestId("assignment-detail-panel");
  await expect(panel).toBeVisible({ timeout: 8000 });
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0, { timeout: 8000 });

  // reduced motion 下 A→B：立即 entity swap（不做 60ms fade-out，也不残留 stale id）
  await page.getByRole("button", { name: /置信区间作业.*截止/ }).click();
  await expect(panel).toBeVisible({ timeout: 8000 });
  await page.getByRole("button", { name: /假设检验作业.*截止/ }).click();
  await expect(panel.getByRole("heading", { name: "假设检验作业" })).toBeVisible({ timeout: 2000 });
  await expect(panel.getByRole("heading", { name: "置信区间作业" })).toHaveCount(0, { timeout: 200 });
});

base("G：响应式 390×844 与 768×1024：无横向溢出、面板不超 viewport、关闭永远可见", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "时间表" }).first().click();
  await expect(page.getByText(/第 \d+ 周/).first()).toBeVisible();
  await page.getByRole("button", { name: /置信区间作业.*截止/ }).click();
  const panel = page.getByTestId("assignment-detail-panel");
  await expect(panel).toBeVisible({ timeout: 8000 });
  await expect(async () => {
    const transform = await panel.evaluate((el) => getComputedStyle(el).transform);
    expect(transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)").toBe(true);
  }).toPass({ timeout: 5000 });

  // 移动端：面板 ≤ 100vw - 24px；页面无横向溢出
  const box = (await panel.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(390 - 20);
  expect(box.x).toBeGreaterThanOrEqual(8);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  expect(overflow).toBe(false);
  // 关闭按钮可见（不依赖 hover）
  await expect(
    page.getByRole("dialog", { name: "任务详情" }).getByRole("button", { name: "关闭" })
  ).toBeVisible();

  // 768×1024（平板纵向）
  await page.setViewportSize({ width: 768, height: 1024 });
  const box2 = (await panel.boundingBox())!;
  expect(box2.width).toBeLessThanOrEqual(768 - 20);
  const overflow2 = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  expect(overflow2).toBe(false);
});

base("A2：close A → open B：fresh reopen 第一帧即 B，绝不 flash A", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await openTimeline(page);

  // open A → close
  await page.getByRole("button", { name: /置信区间作业.*截止/ }).click();
  const panel = page.getByTestId("assignment-detail-panel");
  await expect(panel).toBeVisible({ timeout: 8000 });
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0, { timeout: 8000 });

  // 重新打开 B：进入阶段第一帧不得出现 A（fresh reopen 不做 swap-out；
  // 若实现回退为「先渲染旧 displayedId 再 60ms swap」，此处会捕获 A）
  await page.getByRole("button", { name: /假设检验作业.*截止/ }).click();
  await expect(panel.getByRole("heading", { name: "置信区间作业" })).toHaveCount(0, { timeout: 50 });
  await expect(panel.getByRole("heading", { name: "假设检验作业" })).toBeVisible({ timeout: 2000 });
  // Header 与 Body 同实体：B 的标题与 hero 同时可见，A 的标题从未出现
  await expect(panel.getByRole("heading", { name: "假设检验作业" })).toHaveCount(1);
});

base("B2：切换任务后 transient state reset（Reminder 默认 collapsed；More/资料 picker 复位）", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await openTimeline(page);

  // open A → 展开 Reminder + 打开 More
  await page.getByRole("button", { name: /置信区间作业.*截止/ }).click();
  const panel = page.getByTestId("assignment-detail-panel");
  await expect(panel).toBeVisible({ timeout: 8000 });
  const reminderTrigger = page.getByTestId("reminder-disclosure-trigger");
  await reminderTrigger.click();
  await expect(reminderTrigger).toHaveAttribute("aria-expanded", "true");
  await panel.getByRole("button", { name: "更多操作" }).click();
  await expect(panel.getByRole("menuitem", { name: "Ask Kiro" })).toBeVisible();

  // switch B：transient 全部复位（More 关闭；Reminder collapsed）
  await page.mouse.move(20, 20);
  await page.getByRole("button", { name: /假设检验作业.*截止/ }).click();
  await expect(panel.getByRole("heading", { name: "假设检验作业" })).toBeVisible({ timeout: 2000 });
  await expect(page.getByTestId("reminder-disclosure-trigger")).toHaveAttribute("aria-expanded", "false");
  await expect(panel.getByRole("menuitem", { name: "Ask Kiro" })).toHaveCount(0);
});

base("C2：click Full Detail 立即关闭 hover preview（不等 mouseleave）", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await openTimeline(page);

  // hover → preview visible
  const point = page.getByRole("button", { name: /置信区间作业.*截止/ });
  await point.hover();
  const preview = page.getByTestId("floating-timeline-detail");
  await expect(preview).toBeVisible({ timeout: 3000 });

  // click → full detail 进入，preview 立即消失（不得同时可见）
  await point.click();
  await expect(page.getByTestId("assignment-detail-panel")).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId("floating-timeline-detail")).toHaveCount(0, { timeout: 1000 });
});

base("D2：A→B 切换后关闭，focus 回到 B 的 trigger（最近切换实体）", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await openTimeline(page);

  await page.getByRole("button", { name: /置信区间作业.*截止/ }).click();
  const panel = page.getByTestId("assignment-detail-panel");
  await expect(panel).toBeVisible({ timeout: 8000 });
  // 面板打开时点击 B → 实体切换（shell 不关闭）
  await page.getByRole("button", { name: /假设检验作业.*截止/ }).click();
  await expect(panel.getByRole("heading", { name: "假设检验作业" })).toBeVisible({ timeout: 2000 });

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0, { timeout: 8000 });
  const focused = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el?.getAttribute("aria-label") ?? "";
  });
  expect(focused).toContain("假设检验作业");
});

base("E2：keyboard Enter 激活 deadline → Full Detail 打开（preview 不残留）", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await openTimeline(page);

  const point = page.getByRole("button", { name: /置信区间作业.*截止/ });
  await point.focus();
  // focus 会打开 hover preview；Enter 激活 full detail 且 preview 关闭
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("assignment-detail-panel")).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId("floating-timeline-detail")).toHaveCount(0, { timeout: 1000 });
  await expect(
    page.getByRole("dialog", { name: "任务详情" }).getByRole("heading", { name: "置信区间作业" })
  ).toBeVisible();
});

base("F2：独立 DDL A→B：outer shell 同一节点，内容就地替换", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await openTimeline(page);

  await page.getByRole("button", { name: /交项目报告.*截止/ }).click();
  const panel = page.getByTestId("ddl-detail-panel");
  await expect(panel).toBeVisible({ timeout: 8000 });
  const shellHandle = await panel.evaluateHandle((node) => node);

  await page.mouse.move(20, 20);
  await page.getByRole("button", { name: /交结课报告.*截止/ }).click();
  const stillSame = await shellHandle.evaluate(
    (node) => node === document.querySelector('[data-testid="ddl-detail-panel"]')
  );
  expect(stillSame).toBe(true);
  await expect(panel.getByRole("heading", { name: "交结课报告" })).toBeVisible({ timeout: 2000 });
  await expect(panel.getByRole("heading", { name: "交项目报告" })).toHaveCount(0);
});

base("G2：close DDL A → open DDL B：第一帧无 A", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await openTimeline(page);

  await page.getByRole("button", { name: /交项目报告.*截止/ }).click();
  const panel = page.getByTestId("ddl-detail-panel");
  await expect(panel).toBeVisible({ timeout: 8000 });
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0, { timeout: 8000 });

  await page.getByRole("button", { name: /交结课报告.*截止/ }).click();
  await expect(panel.getByRole("heading", { name: "交项目报告" })).toHaveCount(0, { timeout: 50 });
  await expect(panel.getByRole("heading", { name: "交结课报告" })).toBeVisible({ timeout: 2000 });
});

base("H：学习安排时长显示准确（90 分钟 → 1 小时 30 分）", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await openTimeline(page);

  await page.getByRole("button", { name: /置信区间作业.*截止/ }).click();
  const dialog = page.getByRole("dialog", { name: "任务详情" });
  await expect(dialog).toBeVisible({ timeout: 8000 });
  // Execution 学习安排行 + Hero 摘要都使用准确时长
  await expect(dialog.getByText("1 小时 30 分 · 1 个时段", { exact: true })).toBeVisible();
  await expect(dialog.getByText("已安排 1 小时 30 分 · 1 个时段", { exact: true })).toBeVisible();
});
