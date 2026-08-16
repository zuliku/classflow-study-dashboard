import { expect, Page } from "@playwright/test";
import { test as demoTest } from "./demoFixtures";

/**
 * Learning Analytics V3（Truth & IA）focused E2E：
 * A. Desktop 层级：Summary Strip / 学习趋势 / 值得注意 / 投入与节奏 / 执行情况 齐全
 * B. 1920×1080：内容 max-width ≈1500 居中（不无限拉伸）
 * C. Signals h-fit：signals 高度明显 < trend 高度（不 stretch）
 * D. 投入与节奏：Course Investment 高于 Focus Rhythm，top 对齐、高度不相等
 * E. 课程投入显示真实课程名（snapshot）；无多行「未关联课程」；unlinked 唯一聚合
 * F. 本周趋势 label 为「8/17 周一」格式（非 raw ISO）
 */

const visibleText = (page: Page, text: string | RegExp) =>
  page.getByText(text as string).filter({ visible: true }).first();

/**
 * 浏览器侧 seed Learning History（raw IndexedDB，schema 与 lib/history/store 一致）。
 * 事件相对今天偏移（本周一 = 周一 00:00）：
 * - focus：c_4 数据分析 2 次（各 25min/35min，周一）、c_5 管理学原理 1 次（30min，周二）、unbound 2 次（20+40min）
 * - coverage：historyStartedAt = 上周一 → 本周 complete；focusBackfillCompleted=false
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
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(undefined);
        tx.onerror = () => reject(tx.error);
      });
    })().catch(() => {});
  });
}

async function openAnalytics(page: Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await page.getByRole("button", { name: "学习洞察" }).first().click();
  await expect(page.getByRole("heading", { name: "学习洞察" })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(900); // snapshot 计算 + 动画 settle
}

demoTest("A：Desktop 层级齐全（Summary / Trend / 值得注意 / 投入与节奏 / 执行情况）", async ({ page }) => {
  await seedLearningHistory(page);
  await openAnalytics(page);

  await expect(page.getByTestId("analytics-summary-strip")).toBeVisible();
  // Summary 四项 value（focus 175min → 2 小时 55 分）
  await expect(visibleText(page, /2 小时 55 分/)).toBeVisible();
  await expect(page.getByText("学习趋势", { exact: true })).toBeVisible();
  await expect(page.getByText("值得注意", { exact: true })).toBeVisible();
  await expect(page.getByText("投入与节奏", { exact: true })).toBeVisible();
  await expect(page.getByText("课程投入", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("专注节奏", { exact: true })).toBeVisible();
  await expect(page.getByText("执行情况", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("下一步", { exact: true })).toBeVisible();
});

demoTest("B：1920×1080 内容 max-width ≈1500 且在 workspace 内居中（不无限拉伸）", async ({ page }) => {
  await seedLearningHistory(page);
  await openAnalytics(page, 1920, 1080);

  const bodyInner = page.getByTestId("analytics-body");
  const headerInner = page.getByTestId("analytics-header-inner");
  await expect(bodyInner).toBeVisible();
  const body = (await bodyInner.boundingBox())!;
  const header = (await headerInner.boundingBox())!;
  expect(body.width).toBeLessThanOrEqual(1500 + 2);
  // Header 与 Body 同宽对齐
  expect(Math.abs(header.x - body.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(header.width - body.width)).toBeLessThanOrEqual(2);
  // 在 main workspace 内居中
  const main = (await page.locator("main").first().boundingBox())!;
  expect(Math.abs(body.x - main.x - (main.width - body.width) / 2)).toBeLessThanOrEqual(4);
});

demoTest("C：Signals h-fit（signals 明显矮于 Trend，不被 stretch）", async ({ page }) => {
  await seedLearningHistory(page);
  await openAnalytics(page);

  const trendCard = page.getByText("学习趋势", { exact: true }).locator("..");
  const signals = page.getByTestId("learning-signals-card");
  await expect(signals).toBeVisible();
  const trendBox = (await trendCard.boundingBox())!;
  const signalsBox = (await signals.boundingBox())!;
  // 只要求明显矮于（不等高；不要求精确比例）
  expect(signalsBox.height).toBeLessThan(trendBox.height * 0.8);
});

demoTest("D：Course Investment 高于 Focus Rhythm；top 对齐、不等高", async ({ page }) => {
  await seedLearningHistory(page);
  await openAnalytics(page);

  const investment = page.getByTestId("course-investment-card");
  const rhythm = page.getByTestId("focus-rhythm-card");
  await expect(investment).toBeVisible();
  await expect(rhythm).toBeVisible();
  const inv = (await investment.boundingBox())!;
  const rhy = (await rhythm.boundingBox())!;
  expect(inv.height).toBeGreaterThan(rhy.height + 10);
  expect(Math.abs(inv.y - rhy.y)).toBeLessThanOrEqual(4);
});

demoTest("E：课程投入显示真实课程名（snapshot）；unlinked 唯一聚合；无重复未关联", async ({ page }) => {
  await seedLearningHistory(page);
  await openAnalytics(page);

  const card = page.getByTestId("course-investment-card");
  await expect(card.getByText("数据分析", { exact: true })).toBeVisible();
  await expect(card.getByText("管理学原理", { exact: true })).toBeVisible();
  // 未关联课程唯一一条（55 分钟 = 20+35? 实际 20+40=60）
  const unlinked = card.getByText("未关联课程", { exact: true });
  await expect(unlinked).toHaveCount(1);
  await expect(card.getByText(/1 小时/).first()).toBeVisible(); // 数据分析 60 分钟 = 1 小时
});

demoTest("F：本周趋势 label 为「M/d 周一」格式（非 raw ISO）", async ({ page }) => {
  await seedLearningHistory(page);
  await openAnalytics(page);

  // 周一 label（本周一日期动态计算）
  const now = new Date();
  const dow = now.getDay() === 0 ? 7 : now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (dow - 1));
  const monLabel = `${mon.getMonth() + 1}/${String(mon.getDate()).padStart(2, "0")} 周一`;
  await expect(page.getByText(monLabel, { exact: true }).first()).toBeVisible();
  // raw ISO 不作为最终标签
  await expect(page.getByText(/^\d{4}-\d{2}-\d{2}$/).first()).toHaveCount(0);
});
