import { expect, Page } from "@playwright/test";
import { test } from "@playwright/test";

/**
 * P3：Automatic Deadline Reminder Product UX（focused E2E）。
 * 覆盖关键用户链路：auto 生成 + linked mark 不重复、降级、manual 并存、
 * 编辑转 custom、删除 opt-out + 重新开启、settings fan-out、hydrate backfill。
 * 数据经 localStorage seed（P2 hydrate 幂等 reconcile 自动 backfill）。
 */

const DESKTOP = { width: 1440, height: 900 };
const KEY = "classflow-storage-v2";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function localStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 未来 N 天（本地墙钟） */
function daysFromNow(days: number, hour = 10, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return localStr(d);
}

/** 距 now 指定小时数 */
function hoursFromNow(h: number): string {
  return localStr(new Date(Date.now() + h * 3600000));
}

function fullPreferences(patch: Record<string, unknown> = {}) {
  return {
    showWeekends: true,
    ddlWarningDays: 3,
    defaultDDLTime: "23:59",
    enableScheduleDirectManipulation: true,
    enableDDLDirectManipulation: true,
    motionPreference: "system",
    startupView: "overview",
    defaultTaskPriority: "medium",
    defaultTaskStatus: "todo",
    enableSingleKeyShortcuts: true,
    contentDensity: "comfortable",
    defaultTaskWorkspaceView: "focus",
    defaultDeadlineReminderMinutes: 1440,
    ...patch,
  };
}

interface SeedInput {
  assignments?: unknown[];
  calendarMarks?: unknown[];
  reminders?: unknown[];
  preferences?: Record<string, unknown>;
}

async function seed(page: Page, input: SeedInput) {
  const now = new Date();
  const dow = now.getDay() === 0 ? 7 : now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dow - 1));
  const p = (n: number) => String(n).padStart(2, "0");
  const state = {
    userProfile: { name: "P3 测试", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
    // 动态学期：本周一开学（Timeline 当前周含今天）
    semester: { id: "s", name: "测试学期", startDate: `${monday.getFullYear()}-${p(monday.getMonth() + 1)}-${p(monday.getDate())}`, totalWeeks: 16 },
    courses: [],
    schedules: [],
    assignments: input.assignments ?? [],
    calendarMarks: input.calendarMarks ?? [],
    groupProjects: [],
    studyBlocks: [],
    assignmentTimeSlice: "all",
    preferences: fullPreferences(input.preferences),
    reminders: input.reminders ?? [],
    focusSessions: [],
  };
  await page.addInitScript(({ s }) => {
    // 仅首次导航 seed（同页内二次 goto/reload 不覆盖 persist 写入的真实状态）
    if (!localStorage.getItem("classflow-storage-v2")) {
      localStorage.setItem("classflow-storage-v2", JSON.stringify({ version: 6, state: s }));
    }
  }, { s: state });
}

function mkAssignment(patch: Record<string, unknown>): Record<string, unknown> {
  return {
    id: patch.id as string,
    courseId: "c1",
    title: (patch.title as string) ?? "自动提醒任务",
    description: "",
    priority: "medium",
    status: "todo",
    progress: 0,
    tags: [],
    ...patch,
  };
}

function mkReminder(patch: Record<string, unknown>): Record<string, unknown> {
  return {
    id: patch.id as string,
    title: (patch.title as string) ?? "提醒",
    targetType: patch.targetType as string,
    targetId: patch.targetId as string,
    timingMode: "relative",
    offsetMinutes: -1440,
    triggerAt: patch.triggerAt as string,
    status: "scheduled",
    source: "manual",
    createdAt: localStr(new Date()),
    updatedAt: localStr(new Date()),
    ...patch,
  };
}

async function openReminderCenter(page: Page) {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await page.getByRole("button", { name: "提醒", exact: true }).click();
  const panel = page.getByTestId("reminder-center");
  await expect(panel).toHaveAttribute("data-state", "open", { timeout: 8000 });
  return panel;
}

async function openTasksSettings(page: Page) {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const view = page.getByTestId("settings-view");
  await expect(view).toBeVisible({ timeout: 8000 });
  await view.getByRole("button", { name: "任务与提醒", exact: true }).click();
  return view;
}

test("A1：未来 DDL Assignment → Reminder Center 恰好 1 条 auto（linked mark 不产生第二条）", async ({ page }) => {
  await seed(page, {
    assignments: [mkAssignment({ id: "a1", title: "交统计作业", ddl: daysFromNow(5) })],
    calendarMarks: [{ id: "cm1", date: daysFromNow(5).slice(0, 10), type: "ddl", title: "交统计作业", sourceId: "a1" }],
  });
  const panel = await openReminderCenter(page);
  // 恰好一条 auto + 「自动」标签
  const upcoming = panel.getByText("交统计作业", { exact: false });
  await expect(upcoming.first()).toBeVisible();
  await expect(panel.getByText("自动", { exact: true })).toHaveCount(1);
  // 只有 1 条 scheduled（auto；manual 无）
  await expect(panel.getByText(/提前 1 天/, { exact: false })).toHaveCount(1);
});

test("A2：3 小时后截止 + 默认 1 天 → auto 实际提前 1 小时（显示真实提前量）", async ({ page }) => {
  await seed(page, {
    assignments: [mkAssignment({ id: "a1", title: "临期任务", ddl: hoursFromNow(3) })],
  });
  const panel = await openReminderCenter(page);
  // 降级到提前 1 小时（metaLine 显示「提前 1 小时 · 任务」；不显示「提前 1 天」）
  await expect(panel.getByText(/提前 1 小时/, { exact: false })).toHaveCount(1);
  await expect(panel.getByText(/提前 1 天/, { exact: false })).toHaveCount(0);
});

test("C6：auto 1d + manual 3h 并存（两条 scheduled）", async ({ page }) => {
  await seed(page, {
    assignments: [mkAssignment({ id: "a1", title: "并存任务", ddl: daysFromNow(5) })],
    reminders: [
      mkReminder({ id: "r-manual", title: "并存任务", targetType: "assignment", targetId: "a1", offsetMinutes: -180, triggerAt: daysFromNow(4, 7) }),
    ],
  });
  const panel = await openReminderCenter(page);
  await expect(panel.getByText(/提前 1 天/, { exact: false })).toHaveCount(1);
  await expect(panel.getByText(/提前 3 小时/, { exact: false })).toHaveCount(1);
});

test("D8：编辑 auto → 转 custom；修改 global default 不影响它", async ({ page }) => {
  await seed(page, {
    assignments: [mkAssignment({ id: "a1", title: "编辑任务", ddl: daysFromNow(5) })],
  });
  const panel = await openReminderCenter(page);
  await expect(panel.getByText("自动", { exact: true })).toHaveCount(1);
  // 点击任务 → Assignment Drawer：默认提醒已开启 + auto row
  await panel.getByText("编辑任务", { exact: false }).first().click();
  await expect(page.getByText("默认提醒：已开启", { exact: true })).toBeVisible({ timeout: 8000 });
  await expect(page.getByText("自动", { exact: true })).toHaveCount(1);
  // 编辑 auto（picker 打开后，当前项「提前 1 天」再点一次 = 保存 → user-edit 语义：转 custom + opt-out）
  await page.getByRole("button", { name: /编辑提醒/, exact: false }).first().click();
  const picker = page.getByTestId("assignment-reminder-picker");
  await expect(picker).toBeVisible({ timeout: 5000 });
  await picker.getByRole("button", { name: /提前 1 天/, exact: false }).click();
  await expect(page.getByText("默认提醒：已关闭", { exact: true })).toBeVisible();
  await expect(page.getByText("自动", { exact: true })).toHaveCount(0);

  // 修改 global default 1d -> 3d → 该 custom 时间不变、无新 auto
  await page.keyboard.press("Escape");
  const settings = await openTasksSettings(page);
  await settings
    .getByRole("group", { name: "任务与 DDL 默认提醒" })
    .getByRole("button", { name: "提前 3 天" })
    .click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "提醒", exact: true }).click();
  const panel2 = page.getByTestId("reminder-center");
  await expect(panel2).toHaveAttribute("data-state", "open", { timeout: 8000 });
  await expect(panel2.getByText("自动", { exact: true })).toHaveCount(0);
  // custom 保留原相对时间（提前 1 天）
  await expect(panel2.getByText(/提前 1 天/, { exact: false })).toHaveCount(1);
});

test("E：删除 auto → opt-out（Drawer 显示已关闭）→ 重新开启恢复", async ({ page }) => {
  await seed(page, {
    assignments: [mkAssignment({ id: "a1", title: "开关任务", ddl: daysFromNow(5) })],
  });
  const panel = await openReminderCenter(page);
  await expect(panel.getByText("自动", { exact: true })).toHaveCount(1);
  // 点击任务 → Assignment Drawer
  await panel.getByText("开关任务", { exact: false }).first().click();
  await expect(page.getByText("默认提醒：已开启", { exact: true })).toBeVisible({ timeout: 8000 });
  // Drawer 内删除 auto（用户删除 → opt-out）
  await page.getByRole("button", { name: /删除提醒/, exact: false }).first().click();
  await expect(page.getByText("默认提醒：已关闭", { exact: true })).toBeVisible();
  await expect(page.getByText("自动", { exact: true })).toHaveCount(0);
  // 重新开启 → auto 恢复（Drawer 内 scheduled 列表回到 1 条 auto）
  await page.getByRole("button", { name: "重新开启默认提醒", exact: true }).click();
  await expect(page.getByText("默认提醒：已开启", { exact: true })).toBeVisible();
  await expect(page.getByText("自动", { exact: true })).toHaveCount(1);
  // 关闭 Drawer → 打开 Center → auto 仍存在
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "提醒", exact: true }).click();
  const panel2 = page.getByTestId("reminder-center");
  await expect(panel2).toHaveAttribute("data-state", "open", { timeout: 8000 });
  await expect(panel2.getByText("自动", { exact: true })).toHaveCount(1);
});

test("G15：settings 1d -> 3d → 所有 auto 更新、manual/custom 不变", async ({ page }) => {
  await seed(page, {
    assignments: [
      mkAssignment({ id: "a1", title: "任务甲", ddl: daysFromNow(10) }),
      mkAssignment({ id: "a2", title: "任务乙", ddl: daysFromNow(12) }),
    ],
    reminders: [
      mkReminder({ id: "r-m", title: "任务甲", targetType: "assignment", targetId: "a1", offsetMinutes: -180, triggerAt: daysFromNow(9, 7) }),
    ],
  });
  const panel = await openReminderCenter(page);
  // 两个 auto（提前 1 天 × 2）+ 一个 manual（提前 3 小时）
  await expect(panel.getByText(/提前 1 天/, { exact: false })).toHaveCount(2);
  await expect(panel.getByText(/提前 3 小时/, { exact: false })).toHaveCount(1);

  const settings = await openTasksSettings(page);
  await settings
    .getByRole("group", { name: "任务与 DDL 默认提醒" })
    .getByRole("button", { name: "提前 3 天" })
    .click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "提醒", exact: true }).click();
  const panel2 = page.getByTestId("reminder-center");
  await expect(panel2).toHaveAttribute("data-state", "open", { timeout: 8000 });
  // auto 全部更新为提前 3 天；manual 保持提前 3 小时
  await expect(panel2.getByText(/提前 3 天/, { exact: false })).toHaveCount(2);
  await expect(panel2.getByText(/提前 3 小时/, { exact: false })).toHaveCount(1);
  await expect(panel2.getByText(/提前 1 天/, { exact: false })).toHaveCount(0);
});

test("fix1 UI：custom absolute 与 auto 同实际时刻 → UI duplicate guard 拦截，Center 只有 1 个 scheduled", async ({ page }) => {
  await seed(page, {
    assignments: [mkAssignment({ id: "a1", title: "同点任务", ddl: daysFromNow(5) })],
  });
  const panel = await openReminderCenter(page);
  await expect(panel.getByText("自动", { exact: true })).toHaveCount(1);
  // 打开 Drawer → 自定义时间创建与 auto 相同 triggerAt 的 absolute
  await panel.getByText("同点任务", { exact: false }).first().click();
  await expect(page.getByText("默认提醒：已开启", { exact: true })).toBeVisible({ timeout: 8000 });
  const autoTrigger = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("classflow-storage-v2")!).state;
    const r = d.reminders.find((x: { source: string }) => x.source === "auto");
    return r.triggerAt as string;
  });
  await page.getByRole("button", { name: "添加", exact: true }).first().click();
  await page.getByRole("button", { name: "自定义时间…", exact: true }).click();
  const picker = page.getByTestId("assignment-reminder-picker");
  await picker.getByLabel("提醒日期").fill(autoTrigger.slice(0, 10));
  await picker.getByLabel("提醒时间").fill(autoTrigger.slice(11, 16));
  await picker.getByRole("button", { name: "保存", exact: true }).click();
  // UI duplicate guard（与 Domain 同 trigger 语义一致）阻止创建
  await expect(picker.getByText("已经存在相同时间的提醒", { exact: true })).toBeVisible();
  // 关闭 Drawer → Center：仍只有 1 个 scheduled（auto），无重复通知
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "提醒", exact: true }).click();
  const panel2 = page.getByTestId("reminder-center");
  await expect(panel2).toHaveAttribute("data-state", "open", { timeout: 8000 });
  await expect(panel2.getByText("自动", { exact: true })).toHaveCount(1);
});

test("fix4：独立 DDL mark 删除 auto → Timeline 显示已关闭 → 重新开启恢复 exactly one auto", async ({ page }) => {
  // 跨午夜安全：date 和 time 都从同一个 later 时刻提取（避免「今天日期 + 明天时间」组合出过去时间）
  const later = new Date(Date.now() + 3 * 3600000);
  const p = (n: number) => String(n).padStart(2, "0");
  const todayStr = `${later.getFullYear()}-${p(later.getMonth() + 1)}-${p(later.getDate())}`;
  const laterTime = `${p(later.getHours())}:${p(later.getMinutes())}`;
  await seed(page, {
    calendarMarks: [{ id: "cm1", date: todayStr, type: "ddl", title: "交项目报告", startTime: laterTime }],
  });
  const panel = await openReminderCenter(page);
  await expect(panel.getByText("交项目报告", { exact: false }).first()).toBeVisible();
  await expect(panel.getByText("自动", { exact: true })).toHaveCount(1);
  // 删除 auto（用户删除 → opt-out）；关闭 Center 后切 Timeline
  await panel.locator('button[aria-label="删除提醒 交项目报告"]').first().click();
  await expect(panel.getByText("交项目报告", { exact: false })).toHaveCount(0, { timeout: 5000 });
  await page.keyboard.press("Escape");
  // Timeline：hover 独立 DDL mark → 默认提醒：已关闭 + 重新开启
  await page.getByRole("button", { name: "时间表", exact: true }).click();
  const deadlinePoint = page.getByRole("button", { name: /交项目报告.*截止/ });
  await deadlinePoint.first().hover();
  await expect(page.getByText("默认提醒：已关闭", { exact: true })).toBeVisible({ timeout: 8000 });
  await page.getByRole("button", { name: "重新开启默认提醒", exact: true }).click();
  await expect(page.getByText("默认提醒：已关闭", { exact: true })).toHaveCount(0);
  // 回到 Center：auto 恢复 exactly one
  await page.getByRole("button", { name: "提醒", exact: true }).click();
  const panel2 = page.getByTestId("reminder-center");
  await expect(panel2).toHaveAttribute("data-state", "open", { timeout: 8000 });
  await expect(panel2.getByText("自动", { exact: true })).toHaveCount(1);
});

test("hydration：legacy-like state（future DDL + linked mark + 无 auto）→ 恰好 1 条 auto", async ({ page }) => {
  await seed(page, {
    assignments: [mkAssignment({ id: "a1", title: "遗留任务", ddl: daysFromNow(5) })],
    calendarMarks: [{ id: "cm1", date: daysFromNow(5).slice(0, 10), type: "ddl", title: "遗留任务", sourceId: "a1" }],
    reminders: [],
  });
  // reload 语义：再 goto 一次（hydrate backfill 幂等）
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await page.goto("/");
  await page.getByRole("button", { name: "提醒", exact: true }).click();
  const panel = page.getByTestId("reminder-center");
  await expect(panel).toHaveAttribute("data-state", "open", { timeout: 8000 });
  await expect(panel.getByText("自动", { exact: true })).toHaveCount(1);
  await expect(panel.getByText("遗留任务", { exact: false }).first()).toBeVisible();
});
