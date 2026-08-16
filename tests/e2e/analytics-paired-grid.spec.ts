import { expect, Page } from "@playwright/test";
import { test as demoTest } from "./demoFixtures";

/**
 * UI Hotfix：学习洞察 Paired Card 列宽统一（Desktop 50/50；Mobile 单列）。
 * 三个 paired section（趋势|Signals / 投入|节奏 / 前瞻|估时）使用同一
 * ANALYTICS_PAIRED_GRID（lg:grid-cols-2）：
 * 7. 学习趋势 row：desktop 2 equal columns
 * 8. 投入与节奏 row：desktop 2 equal columns
 * 9. 下一步 row：desktop 2 equal columns
 * 10. 三行 left/right bounding box 对齐（≤2px）
 * 12. mobile：全部 single column（纵向依次排列）
 */

/**
 * 浏览器侧 seed Learning History（raw IndexedDB；与 lib/history/store schema 一致）。
 * 事件 schema 与 learning-analytics-v3.spec 完全一致（focus.completed + assignment
 * created/completed + coverage meta historyStartedAt=上周一 → 本周 complete）。
 */
async function seedLearningHistory(page: Page) {
  await page.addInitScript(() => {
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const localDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const now = new Date();
    const dow = now.getDay() === 0 ? 7 : now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dow - 1));
    monday.setHours(0, 0, 0, 0);
    const DAY = 86400000;
    const at = (offsetDaysFromMonday: number, hour: number, minute = 0) => {
      const d = new Date(monday.getTime() + offsetDaysFromMonday * DAY);
      d.setHours(hour, minute, 0, 0);
      return d.getTime();
    };
    const openDb = () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open("classflow-learning-history", 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("events")) {
            const store = db.createObjectStore("events", { keyPath: "id" });
            store.createIndex("occurredAt", "occurredAt");
            store.createIndex("localDate", "localDate");
            store.createIndex("type", "type");
            store.createIndex("entityType", "entityType");
            store.createIndex("entityId", "entityId");
            store.createIndex("semesterId", "semesterId");
            store.createIndex("semesterWeek", "semesterWeek");
            store.createIndex("courseId", "courseId");
            store.createIndex("assignmentId", "assignmentId");
            store.createIndex("source", "source");
          }
          if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

    const focus = (
      id: string,
      atTs: number,
      courseId: string | undefined,
      courseNameSnapshot: string | undefined,
      minutes: number,
      sequence: number
    ) => ({
      schemaVersion: 1,
      id,
      type: "focus.completed",
      entityType: "focus-session",
      entityId: id,
      occurredAt: atTs,
      localDate: localDate(new Date(atTs)),
      sequence,
      semesterId: "sem_e2e",
      semesterNameSnapshot: "E2E学期",
      semesterWeek: 1,
      source: "manual",
      courseId,
      courseNameSnapshot,
      data: { actualActiveMs: minutes * 60000, startedAt: atTs, plannedMinutes: minutes },
    });

    const ev = (patch: Record<string, unknown>) => ({
      schemaVersion: 1,
      timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
      semesterId: "sem_e2e",
      semesterNameSnapshot: "E2E学期",
      semesterWeek: 1,
      source: "manual",
      ...patch,
    });

    (async () => {
      const db = await openDb();
      const tx = db.transaction(["events", "meta"], "readwrite");
      const store = tx.objectStore("events");
      const meta = tx.objectStore("meta");
      const events = [
        focus("f1", at(0, 9, 0), "c_4", "数据分析", 25, 1),
        focus("f2", at(0, 15, 0), "c_4", "数据分析", 35, 2),
        focus("f3", at(1, 10, 0), "c_5", "管理学原理", 30, 3),
        focus("f4", at(1, 20, 0), undefined, undefined, 20, 4),
        focus("f5", at(2, 9, 0), undefined, undefined, 40, 5),
        focus("f6", at(2, 15, 0), "c_1", "微观经济学", 15, 6),
        focus("f7", at(3, 10, 0), "c_2", "高等数学", 10, 7),
        ev({
          id: "a1-created",
          type: "assignment.created",
          entityType: "assignment",
          entityId: "a1",
          assignmentId: "a1",
          occurredAt: at(0, 8, 0),
          localDate: localDate(new Date(at(0, 8, 0))),
          sequence: 8,
          courseId: "c_4",
          courseNameSnapshot: "数据分析",
          data: { ddl: `${localDate(new Date(monday.getTime() + 12 * DAY))}T23:59:00` },
        }),
        ev({
          id: "a1-completed",
          type: "assignment.completed",
          entityType: "assignment",
          entityId: "a1",
          assignmentId: "a1",
          occurredAt: at(0, 11, 0),
          localDate: localDate(new Date(at(0, 11, 0))),
          sequence: 9,
          courseId: "c_4",
          data: {},
        }),
      ];
      for (const e of events) store.put(e);
      meta.put({
        key: "coverage",
        value: {
          schemaVersion: 1,
          historyStartedAt: monday.getTime() - 7 * DAY,
          initializedAt: monday.getTime() - 7 * DAY,
          studyBlockBatchIntegrityStartedAt: monday.getTime() - 7 * DAY,
          focusBackfillCompleted: false,
          backfilledFocusSessions: 0,
        },
      });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    })().catch(() => {});
  });
}

async function openAnalytics(page: Page, width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  if (width < 768) {
    // 移动端：学习洞察在底部导航「更多」菜单内
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("menuitem", { name: "学习洞察" }).click();
  } else {
    await page.getByRole("button", { name: "学习洞察" }).first().click();
  }
  await expect(page.getByRole("heading", { name: "学习洞察" })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1200); // snapshot 计算 + 动画 settle
}

type Box = { x: number; y: number; width: number; height: number };
async function boxOf(locator: ReturnType<Page["locator"]>): Promise<Box> {
  return (await locator.boundingBox())!;
}

demoTest("Desktop：三个 paired row 均为 2 equal columns（50/50，≤2px）", async ({ page }) => {
  await seedLearningHistory(page);
  await openAnalytics(page, 1440);

  const trendCard = page.getByText("学习趋势", { exact: true }).locator("..");
  const signals = page.getByTestId("learning-signals-card");
  const investment = page.getByTestId("course-investment-card");
  const rhythm = page.getByTestId("focus-rhythm-card");
  const outlook = page.getByTestId("study-outlook-card");
  const estimate = page.getByTestId("estimate-calibration-card");
  await expect(signals).toBeVisible();
  await expect(rhythm).toBeVisible();
  await expect(outlook).toBeVisible();
  await expect(estimate).toBeVisible();

  const trend = (await boxOf(trendCard))!;
  const sig = (await boxOf(signals))!;
  const inv = (await boxOf(investment))!;
  const rhy = (await boxOf(rhythm))!;
  const out = (await boxOf(outlook))!;
  const est = (await boxOf(estimate))!;

  // 7/8/9：每行两列等宽（≤2px）
  expect(Math.abs(trend.width - sig.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(inv.width - rhy.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(out.width - est.width)).toBeLessThanOrEqual(2);

  // 10：左边缘（Trend / Investment / Outlook）同一 axis；右边缘（Signals / Rhythm / Estimate）同一 axis
  expect(Math.abs(trend.x - inv.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(inv.x - out.x)).toBeLessThanOrEqual(2);
  const right = (b: Box) => b.x + b.width;
  expect(Math.abs(right(sig) - right(rhy))).toBeLessThanOrEqual(2);
  expect(Math.abs(right(rhy) - right(est))).toBeLessThanOrEqual(2);
  // 中间分隔轴：每行左右卡共享同一 center divider
  expect(Math.abs((trend.x + right(trend)) / 2 - (inv.x + right(inv)) / 2)).toBeLessThanOrEqual(2);
});

demoTest("Desktop：Summary 与 Paired 区左边缘对齐（整页同一 left axis）", async ({ page }) => {
  await seedLearningHistory(page);
  await openAnalytics(page, 1440);

  const summary = page.getByTestId("analytics-summary-strip");
  const trendCard = page.getByText("学习趋势", { exact: true }).locator("..");
  const investment = page.getByTestId("course-investment-card");
  const outlook = page.getByTestId("study-outlook-card");
  await expect(summary).toBeVisible();
  await expect(investment).toBeVisible();
  await expect(outlook).toBeVisible();

  const s = (await boxOf(summary))!;
  const t = (await boxOf(trendCard))!;
  const inv = (await boxOf(investment))!;
  const out = (await boxOf(outlook))!;
  expect(Math.abs(s.x - t.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(t.x - inv.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(inv.x - out.x)).toBeLessThanOrEqual(2);
});

demoTest("Mobile（390）：全部 single column（依次纵向排列）", async ({ page }) => {
  await seedLearningHistory(page);
  await openAnalytics(page, 390);

  const trendCard = page.getByText("学习趋势", { exact: true }).locator("..");
  const signals = page.getByTestId("learning-signals-card");
  const investment = page.getByTestId("course-investment-card");
  const rhythm = page.getByTestId("focus-rhythm-card");
  const outlook = page.getByTestId("study-outlook-card");
  const estimate = page.getByTestId("estimate-calibration-card");
  await expect(signals).toBeVisible();
  await expect(investment).toBeVisible();
  await expect(rhythm).toBeVisible();
  await expect(outlook).toBeVisible();
  await expect(estimate).toBeVisible();

  const t = (await boxOf(trendCard))!;
  const sig = (await boxOf(signals))!;
  const inv = (await boxOf(investment))!;
  const rhy = (await boxOf(rhythm))!;
  const out = (await boxOf(outlook))!;
  const est = (await boxOf(estimate))!;

  // 全部纵向：每张卡左边缘一致（同一列），且宽度一致
  const xs = [t, sig, inv, rhy, out, est];
  for (let i = 1; i < xs.length; i++) {
    expect(Math.abs(xs[i].x - xs[0].x)).toBeLessThanOrEqual(2);
    expect(Math.abs(xs[i].width - xs[0].width)).toBeLessThanOrEqual(2);
  }
  // 顺序排列：后一张卡 top ≥ 前一张卡 bottom - 2
  for (let i = 1; i < xs.length; i++) {
    expect(xs[i].y).toBeGreaterThanOrEqual(xs[i - 1].y + xs[i - 1].height - 2);
  }
});
