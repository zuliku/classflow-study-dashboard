import { expect } from "@playwright/test";
import { test } from "./demoFixtures";
import type { Page } from "@playwright/test";

const VIEWPORTS = [
  { name: "wide-1920", width: 1920, height: 1080 },
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "laptop-1280", width: 1280, height: 800 },
  { name: "tablet-1024", width: 1024, height: 768 },
  { name: "mobile-390", width: 390, height: 844 },
];

/** 造出 Today 四个分组 + 待安排 + 等待反馈的稳定数据。 */
async function seedDenseToday(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    const raw = localStorage.getItem("classflow-storage-v2");
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const state = parsed.state;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const shift = (days: number) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
      return key(d);
    };
    const today = key(now);

    const assignments = state.assignments as Array<Record<string, unknown>>;
    const specs: Array<{ ddl?: string; doDate?: string; status?: string; submittedAt?: string; est?: number }> = [
      { ddl: `${shift(-1)}T18:00`, est: 120 },
      { ddl: `${today}T23:59`, est: 90 },
      { ddl: `${shift(3)}T12:00`, doDate: today, est: 60 },
      { ddl: `${shift(2)}T09:00`, est: 180 },
      { ddl: `${shift(5)}T17:00` },
      { status: "submitted", submittedAt: `${today}T08:00`, ddl: `${shift(-2)}T23:59`, est: 45 },
    ];
    assignments.forEach((task, index) => {
      const spec = specs[index];
      if (!spec) return;
      if (spec.ddl) task.ddl = spec.ddl;
      if (spec.doDate) task.doDate = spec.doDate;
      if (spec.status) task.status = spec.status;
      if (spec.submittedAt) task.submittedAt = spec.submittedAt;
      if (spec.est !== undefined) task.estimatedMinutes = spec.est;
      task.progress = spec.status === "submitted" ? 100 : 0;
    });

    state.studyBlocks = [
      {
        id: "sb_e2e_1",
        title: "计量经济学作业 · 回归模型",
        date: today,
        startTime: "08:30",
        endTime: "09:30",
        assignmentId: assignments[0]?.id,
        courseId: assignments[0]?.courseId,
        source: "manual",
      },
      {
        id: "sb_e2e_2",
        title: "市场营销案例 · 资料整理",
        date: today,
        startTime: "10:00",
        endTime: "11:00",
        assignmentId: assignments[3]?.id,
        courseId: assignments[3]?.courseId,
        source: "manual",
      },
      {
        id: "sb_e2e_3",
        title: "复盘笔记",
        date: today,
        startTime: "14:00",
        endTime: "15:00",
        source: "manual",
      },
    ];
    state.calendarMarks = [
      ...(state.calendarMarks ?? []),
      {
        id: "mark_e2e_exam",
        date: today,
        type: "exam",
        title: "数据结构期中",
        startTime: "13:00",
        endTime: "15:00",
      },
    ];
    localStorage.setItem("classflow-storage-v2", JSON.stringify(parsed));
  });
  await page.reload();
}

/** 空工作区：验证 Today 空态与最低不遮挡。 */
async function seedEmptyToday(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    const raw = localStorage.getItem("classflow-storage-v2");
    if (!raw) return;
    const parsed = JSON.parse(raw);
    parsed.state.assignments = [];
    parsed.state.studyBlocks = [];
    parsed.state.calendarMarks = [];
    parsed.state.schedules = [];
    parsed.state.reminders = [];
    parsed.state.focusSessions = [];
    localStorage.setItem("classflow-storage-v2", JSON.stringify(parsed));
  });
  await page.reload();
}

async function gotoWorkspace(page: Page, name: string) {
  const direct = page.getByRole("button", { name, exact: true });
  if (await direct.isVisible().catch(() => false)) {
    await direct.click();
  } else {
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  }
  await page.waitForTimeout(650);
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const pick = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        radius: style.borderRadius,
        shadow: style.boxShadow,
        fontSize: style.fontSize,
        paddingLeft: style.paddingLeft,
        paddingBottom: style.paddingBottom,
      };
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      docScrollWidth: document.documentElement.scrollWidth,
      headerInner: pick("main header > div"),
      firstCard: pick("[data-testid='today-now-next']"),
      firstSectionTitle: pick("#today-tasks-title"),
      todayContent: pick("[data-testid='today-content']"),
    };
  });
}

test.describe("Today UI", () => {
  for (const vp of VIEWPORTS) {
    test(`layout ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await seedDenseToday(page);
      await gotoWorkspace(page, "今天");

      const metrics = await measure(page);
      expect(metrics.docScrollWidth).toBe(metrics.viewport.width);
      expect(metrics.firstCard?.radius).toBe("14px");
      expect(metrics.firstCard?.shadow).not.toBe("none");
      expect(metrics.firstSectionTitle?.fontSize).toBe("14px");
      if (metrics.headerInner && metrics.firstCard) {
        expect(
          Math.round(metrics.headerInner.left + parseFloat(metrics.headerInner.paddingLeft))
        ).toBe(metrics.firstCard.left);
      }

      await expect(page.getByText("本地摘要")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /5\s*待安排/ })).toBeVisible();
      if (vp.width >= 1280) {
        await expect(page.getByTestId("today-rail").getByText("待安排 5")).toBeVisible();
      } else if (vp.width < 768) {
        expect(parseFloat(metrics.todayContent?.paddingBottom ?? "0")).toBeGreaterThanOrEqual(80);
        const briefBox = await page.getByTestId("today-kiro-brief-mobile").boundingBox();
        const tasksBox = await page.locator("#today-tasks-title").boundingBox();
        expect(briefBox!.y).toBeLessThan(tasksBox!.y);
      }

      if (vp.width >= 1280) {
        await page.locator("main").evaluate((el) => el.scrollTo({ top: 420, behavior: "auto" }));
        await page.waitForTimeout(300);
        const scrolled = await page.evaluate(() => {
          const header = document.querySelector("main header")?.getBoundingClientRect();
          const rail = document.querySelector("[data-testid='today-rail']")?.getBoundingClientRect();
          return { headerTop: Math.round(header?.top ?? 0), railTop: Math.round(rail?.top ?? 0) };
        });
        expect(scrolled.headerTop).toBe(26);
        expect(scrolled.railTop).toBe(115);
        await page.locator("main").evaluate((el) => el.scrollTo({ top: 0, behavior: "auto" }));
        await page.waitForTimeout(200);
      }

      await page.getByRole("button", { name: /提交《|完成《/ }).first().click();
      const terminalDialog = page.getByRole("dialog", { name: /提交任务|完成任务/ });
      await expect(terminalDialog).toBeVisible();
      await expect(
        terminalDialog.getByText(/不再出现在今天和计划中|已安排的学习时间和提醒会一并释放/)
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(terminalDialog).toBeHidden();
      await page.waitForTimeout(300);

      await page
        .locator("[data-testid='today-timeline-item']")
        .filter({ hasText: "回归模型" })
        .click();
      const taskDrawer = page.getByRole("dialog", { name: "任务详情" });
      await expect(taskDrawer).toBeVisible();
      await expect(taskDrawer.getByText("完成数据清洗与变量定义")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(taskDrawer).toBeHidden();
      await page.waitForTimeout(300);

      const firstGroup = page.locator("#today-group-overdue").getByRole("button").first();
      await firstGroup.click();
      await expect(page.locator("#today-group-body-overdue")).toHaveAttribute("aria-hidden", "true");
      await firstGroup.click();
      await expect(page.locator("#today-group-body-overdue")).toHaveAttribute("aria-hidden", "false");
    });

    test(`empty ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await seedEmptyToday(page);
      await gotoWorkspace(page, "今天");

      const metrics = await measure(page);
      expect(metrics.docScrollWidth).toBe(metrics.viewport.width);
      await expect(page.getByText("今天暂无课程或截止")).toBeVisible();
      await expect(page.getByText("今天没有任务", { exact: true })).toBeVisible();
      await expect(page.getByText("今天没有安排", { exact: true })).toBeVisible();
      await expect(page.getByText("本地摘要")).toHaveCount(0);
    });
  }
});
