import { expect, Page, test } from "@playwright/test";

/**
 * Assignment Workspace V2 E2E：focus/today/upcoming/unscheduled/all/archive 视图、
 * 无 DDL 任务、counts、Search、Peek V2（已计划/未设置/预计耗时）、Ask Kiro 入口。
 * 使用 V2 形状种子数据（含无 DDL、submitted、StudyBlock 关联），不依赖 demo 数据 → 原生 test。
 */

interface V2Seed {
  aOverdue: string;
  aTodayDdl: string;
  aTodayBlock: string;
  aDoing: string;
  aUpcoming1: string;
  aUpcoming2: string;
  aUnsched1: string;
  aUnsched2: string;
  aArchivedSubmitted: string;
  aArchivedCompleted: string;
}

function buildSeed() {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const shiftDate = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };
  const shiftISO = (offset: number, hour = 23, minute = 59) =>
    `${shiftDate(offset)}T${pad2(hour)}:${pad2(minute)}:00`;

  const ids: V2Seed = {
    aOverdue: "v-overdue",
    aTodayDdl: "v-today-ddl",
    aTodayBlock: "v-today-block",
    aDoing: "v-doing",
    aUpcoming1: "v-up1",
    aUpcoming2: "v-up2",
    aUnsched1: "v-uns1",
    aUnsched2: "v-uns2",
    aArchivedSubmitted: "v-arch-sub",
    aArchivedCompleted: "v-arch-done",
  };

  const mk = (id: string, patch: Record<string, unknown>) => ({
    id,
    courseId: "c1",
    title: id,
    description: "",
    priority: "medium",
    status: "todo",
    progress: 0,
    tags: [],
    ...patch,
  });

  const assignments = [
    mk(ids.aOverdue, { title: "逾期任务", status: "doing", priority: "urgent", ddl: shiftISO(-1) }),
    mk(ids.aTodayDdl, { title: "今天截止任务", ddl: shiftISO(0, 23, 59) }),
    mk(ids.aTodayBlock, { title: "今天安排任务", estimatedMinutes: 60 }),
    mk(ids.aDoing, { title: "进行中任务", status: "doing", ddl: shiftISO(5) }),
    mk(ids.aUpcoming1, { title: "即将截止一", ddl: shiftISO(3, 18, 0) }),
    mk(ids.aUpcoming2, { title: "即将截止二", ddl: shiftISO(8) }),
    mk(ids.aUnsched1, { title: "待安排一", estimatedMinutes: 45 }),
    mk(ids.aUnsched2, { title: "待安排二" }),
    mk(ids.aArchivedSubmitted, { title: "已提交任务", status: "submitted", ddl: shiftISO(-3) }),
    mk(ids.aArchivedCompleted, { title: "已完成任务", status: "completed" }),
  ];

  const studyBlocks = [
    { id: "v-b1", title: "今天安排任务", date: shiftDate(0), startTime: "19:00", endTime: "20:00", assignmentId: ids.aTodayBlock, courseId: "c1", source: "manual" },
    { id: "v-b2", title: "待安排一", date: shiftDate(0), startTime: "12:00", endTime: "12:45", assignmentId: ids.aUnsched1, courseId: "c1", source: "manual" },
  ];

  return { ids, assignments, studyBlocks };
}

async function seedV2(page: Page) {
  const seed = buildSeed();
  await page.addInitScript(
    ({ assignments, studyBlocks }) => {
      if (!localStorage.getItem("classflow-storage-v2")) {
        localStorage.setItem(
          "classflow-storage-v2",
          JSON.stringify({
            version: 4,
            state: {
              userProfile: { name: "测试", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
              semester: { id: "sem_v2", name: "V2", startDate: "2026-01-01", totalWeeks: 16 },
              courses: [{ id: "c1", name: "测试课程", code: "T-1", teacher: "", classroom: "", credit: 3, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [] }],
              schedules: [],
              assignments,
              calendarMarks: [],
              groupProjects: [],
              studyBlocks,
              assignmentTimeSlice: "all",
              preferences: {
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
              },
            },
          })
        );
      }
    },
    { assignments: seed.assignments, studyBlocks: seed.studyBlocks }
  );
  return seed;
}

async function openWorkspaceV2(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "任务工作区" }).first().click();
  await expect(page.getByRole("heading", { name: "任务与 DDL" })).toBeVisible();
}

const rowIds = (page: Page) =>
  page
    .locator('[data-assignment-id]')
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-assignment-id")));

test("默认 Focus 视图：逾期 > 今天截止 > 今天安排 > 进行中，count 徽标正确", async ({ page }) => {
  const seed = await seedV2(page);
  await openWorkspaceV2(page);

  expect(await rowIds(page)).toEqual([
    seed.ids.aOverdue,
    seed.ids.aTodayDdl,
    seed.ids.aTodayBlock,
    seed.ids.aUnsched1, // 无 DDL 但今天有 block → 聚焦
    seed.ids.aDoing,
  ]);

  // Focus tab count = 5（active 且需要行动）
  await expect(page.getByRole("button", { name: /^聚焦 \d+$/ })).toContainText("5");
  await expect(page.getByRole("button", { name: /^今天 \d+$/ })).toContainText("3");
  await expect(page.getByRole("button", { name: /^已归档 \d+$/ })).toContainText("2");
});

test("今天视图：今天截止 或 今天有 StudyBlock（Do Date ≠ Due Date）", async ({ page }) => {
  const seed = await seedV2(page);
  await openWorkspaceV2(page);

  await page.getByRole("button", { name: /^今天 \d+$/ }).click();
  expect((await rowIds(page)).sort()).toEqual(
    [seed.ids.aTodayDdl, seed.ids.aTodayBlock, seed.ids.aUnsched1].sort()
  );
});

test("待安排视图：无任何 StudyBlock 的任务（有 DDL 也可入选）", async ({ page }) => {
  const seed = await seedV2(page);
  await openWorkspaceV2(page);

  await page.getByRole("button", { name: /^待安排 \d+$/ }).click();
  expect((await rowIds(page)).sort()).toEqual(
    [seed.ids.aOverdue, seed.ids.aTodayDdl, seed.ids.aDoing, seed.ids.aUpcoming1, seed.ids.aUpcoming2, seed.ids.aUnsched2].sort()
  );
});

test("即将截止视图：仅未来 DDL，升序", async ({ page }) => {
  const seed = await seedV2(page);
  await openWorkspaceV2(page);

  await page.getByRole("button", { name: /^即将截止 \d+$/ }).click();
  expect(await rowIds(page)).toEqual([seed.ids.aUpcoming1, seed.ids.aDoing, seed.ids.aUpcoming2]);
});

test("已归档视图：submitted + completed；无 DDL 行显示无截止日期", async ({ page }) => {
  const seed = await seedV2(page);
  await openWorkspaceV2(page);

  await page.getByRole("button", { name: /^已归档 \d+$/ }).click();
  expect((await rowIds(page)).sort()).toEqual([seed.ids.aArchivedSubmitted, seed.ids.aArchivedCompleted].sort());

  // 已提交任务行（无 DDL 的已完成行显示「无截止日期」）
  await expect(page.locator(`[data-assignment-id="${seed.ids.aArchivedCompleted}"]`)).toContainText("无截止日期");
});

test("全部视图：包含无 DDL 任务，active 在前 archive 在后", async ({ page }) => {
  const seed = await seedV2(page);
  await openWorkspaceV2(page);

  await page.getByRole("button", { name: /^全部 \d+$/ }).click();
  expect(await rowIds(page)).toContain(seed.ids.aUnsched1);
  expect(await rowIds(page)).toContain(seed.ids.aArchivedCompleted);
  const allIds = await rowIds(page);
  const lastTwo = allIds.slice(-2);
  expect(lastTwo).toEqual([seed.ids.aArchivedSubmitted, seed.ids.aArchivedCompleted]);
});

test("Search：按标题过滤当前视图", async ({ page }) => {
  await seedV2(page);
  await openWorkspaceV2(page);

  await page.getByLabel("搜索任务").fill("逾期");
  expect(await rowIds(page)).toEqual(["v-overdue"]);
  await page.getByLabel("搜索任务").fill("");
  expect((await rowIds(page)).length).toBe(5);
});

test("Peek V2：今天安排任务显示已计划段 + 预计耗时；无 DDL 显示未设置", async ({ page }) => {
  await seedV2(page);
  await openWorkspaceV2(page);

  // focus 默认第 3 项 = 今天安排任务（有 block 无 DDL）
  await page.getByTestId("assignment-list").focus();
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await page.keyboard.press("Space");

  const peek = page.getByTestId("assignment-peek");
  await expect(peek).toBeVisible();
  await expect(peek.getByRole("heading", { name: "今天安排任务" })).toBeVisible();
  await expect(peek).toContainText("截止 未设置");
  await expect(peek).toContainText("预计 1 小时");
  await expect(peek).toContainText("已计划 1 段");
  await expect(peek).toContainText("19:00–20:00");

  await page.keyboard.press("Escape");
  await expect(peek).toHaveCount(0);
});

test("Peek V2：已提交任务显示已提交状态", async ({ page }) => {
  const seed = await seedV2(page);
  await openWorkspaceV2(page);

  await page.getByRole("button", { name: "已归档" }).click();
  const row = page.locator(`[data-assignment-id="${seed.ids.aArchivedSubmitted}"]`);
  await row.hover();
  await page.getByTestId("assignment-list").focus();
  await page.keyboard.press("Space");
  const peek = page.getByTestId("assignment-peek");
  await expect(peek.getByRole("heading", { name: "已提交任务" })).toBeVisible();
  await expect(peek).toContainText("已提交");
  await expect(peek).not.toContainText("待完成");
});

test("Ask Kiro 入口存在于工作区 Header", async ({ page }) => {
  await seedV2(page);
  await openWorkspaceV2(page);
  await expect(page.getByRole("button", { name: "Ask Kiro" })).toBeVisible();
});
