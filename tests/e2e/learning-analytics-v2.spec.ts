import { expect, Page } from "@playwright/test";
import { test as demoTest } from "./demoFixtures";

/**
 * 学习洞察（Analytics V2）E2E：
 * 1. 本周指标正确（seeded Learning History：prev week + this week 事件）
 * 2. 近 4 周 range：coverage 提示出现、对比/信号消失
 * 3. First Run 空状态：不假图
 * 4. 真交互链路：完成任务 → 洞察实时更新
 */

const visibleText = (page: Page, text: string | RegExp) =>
  page.getByText(text as string).filter({ visible: true }).first();

/**
 * 浏览器侧 seed Learning History（raw IndexedDB，schema 与 lib/history/store 一致）。
 * weekCovered=true：coverage 从「上周一 00:00」开始 → 本周全量覆盖且可与上周对比。
 */
async function seedLearningHistory(page: Page) {
  await page.addInitScript(() => {
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const localDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const at = (offsetDays: number, hour: number, minute = 0) => {
      const d = new Date();
      d.setDate(d.getDate() + offsetDays);
      d.setHours(hour, minute, 0, 0);
      return d.getTime();
    };
    const now = new Date();
    const dow = now.getDay() === 0 ? 7 : now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dow - 1));
    monday.setHours(0, 0, 0, 0);

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

    const ev = (patch: Record<string, unknown>) => ({
      schemaVersion: 1,
      timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
      semesterId: "sem_e2e",
      semesterNameSnapshot: "E2E学期",
      semesterWeek: 1,
      source: "manual",
      ...patch,
    });

    const DAY = 86400000;
    const historyStartedAt = monday.getTime() - 7 * DAY; // 上周一 00:00
    const atLastWeek = (offsetDaysFromLastMonday: number, hour: number, minute = 0) => {
      const d = new Date(monday.getTime() - offsetDaysFromLastMonday * DAY);
      d.setHours(hour, minute, 0, 0);
      return d.getTime();
    };
    const ddlFuture = localDate(new Date(Date.now() + 5 * DAY));
    const events = [
      // prev week：focus 60min（last Tue 10:00）
      ev({
        id: "prev-f1",
        type: "focus.completed",
        entityType: "focus-session",
        entityId: "prev-f1",
        occurredAt: atLastWeek(5, 10, 0),
        localDate: localDate(new Date(atLastWeek(5, 10, 0))),
        sequence: 1,
        courseId: "c1",
        courseNameSnapshot: "数据结构与算法",
        data: { actualActiveMs: 3600000, startedAt: atLastWeek(5, 10, 0), plannedMinutes: 60 },
      }),
      // prev week：assignment completed（created last Mon, completed last Tue）
      ev({
        id: "prev-a1-created",
        type: "assignment.created",
        entityType: "assignment",
        entityId: "prev-a1",
        assignmentId: "prev-a1",
        occurredAt: atLastWeek(6, 9, 0),
        localDate: localDate(new Date(atLastWeek(6, 9, 0))),
        sequence: 2,
        courseId: "c2",
        courseNameSnapshot: "概率论",
        data: { ddl: `${localDate(new Date(atLastWeek(4, 0, 0)))}T23:59:00` },
      }),
      ev({
        id: "prev-a1-completed",
        type: "assignment.completed",
        entityType: "assignment",
        entityId: "prev-a1",
        assignmentId: "prev-a1",
        occurredAt: atLastWeek(4, 15, 0),
        localDate: localDate(new Date(atLastWeek(4, 15, 0))),
        sequence: 3,
        courseId: "c2",
        data: {},
      }),
      // this week：focus 75min（now - 30min）
      ev({
        id: "wk-f1",
        type: "focus.completed",
        entityType: "focus-session",
        entityId: "wk-f1",
        occurredAt: Date.now() - 30 * 60000,
        localDate: localDate(now),
        sequence: 4,
        courseId: "c1",
        courseNameSnapshot: "数据结构与算法",
        data: { actualActiveMs: 4500000, startedAt: Date.now() - 30 * 60000, plannedMinutes: 75 },
      }),
      // this week：assignment completed（created -2h, completed -1h, ddl +5d → onTime）
      ev({
        id: "wk-a1-created",
        type: "assignment.created",
        entityType: "assignment",
        entityId: "wk-a1",
        assignmentId: "wk-a1",
        occurredAt: Date.now() - 2 * 3600000,
        localDate: localDate(now),
        sequence: 5,
        courseId: "c1",
        courseNameSnapshot: "数据结构与算法",
        data: { ddl: `${ddlFuture}T23:59:00` },
      }),
      ev({
        id: "wk-a1-completed",
        type: "assignment.completed",
        entityType: "assignment",
        entityId: "wk-a1",
        assignmentId: "wk-a1",
        occurredAt: Date.now() - 3600000,
        localDate: localDate(now),
        sequence: 6,
        courseId: "c1",
        data: {},
      }),
      // this week：study block（today 00:30，60min；created 在 start 之前 → 成熟）
      ev({
        id: "wk-p1",
        type: "study_block.created",
        entityType: "study-block",
        entityId: "wk-p1",
        occurredAt: new Date(now).setHours(0, 0, 0, 0),
        localDate: localDate(now),
        sequence: 7,
        courseId: "c1",
        courseNameSnapshot: "数据结构与算法",
        data: { date: localDate(now), startTime: "00:30", endTime: "01:30", plannedMinutes: 60 },
      }),
    ];

    openDb().then(async (db) => {
      const tx = db.transaction(["events", "meta"], "readwrite");
      const store = tx.objectStore("events");
      for (const e of events) store.put(e);
      tx.objectStore("meta").put({
        key: "coverage",
        value: {
          schemaVersion: 1,
          historyStartedAt,
          initializedAt: historyStartedAt,
          studyBlockBatchIntegrityStartedAt: historyStartedAt,
          focusBackfillCompleted: false,
          backfilledFocusSessions: 0,
        },
      });
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
    });
  });
}

async function openAnalytics(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "学习洞察" }).first().click();
  await expect(page.getByRole("heading", { name: "学习洞察" })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(800); // snapshot 计算 + 动画
}

demoTest("本周指标：专注/完成任务/计划/按时率 + 对比 + 信号", async ({ page }) => {
  await seedLearningHistory(page);
  await openAnalytics(page);

  // 本周范围：coverage 从上周一开始 → 全量覆盖，无提示
  await expect(page.getByTestId("analytics-coverage-notice")).toHaveCount(0);

  // 实际专注 75m + ↑ 25%（对比上周 60m）——V3 中文 duration
  await expect(visibleText(page, /1 小时 15 分/)).toBeVisible();
  await expect(visibleText(page, /↑ 25%/)).toBeVisible();

  // 完成任务 / 计划执行 / 按时完成（V3：计划执行为 ratio + 实际/计划）
  await expect(visibleText(page, /完成任务/)).toBeVisible();
  await expect(page.getByText("1 项", { exact: true }).first()).toBeVisible();
  await expect(visibleText(page, /125%/)).toBeVisible(); // 75 / 60
  await expect(visibleText(page, /实际 1 小时 15 分 \/ 计划 1 小时/)).toBeVisible();
  await expect(visibleText(page, /按时完成/)).toBeVisible();
  await expect(visibleText(page, /100%/)).toBeVisible();
  await expect(visibleText(page, /样本不足 · 1 个可判断任务/)).toBeVisible();

  // 信号：专注投入增加
  await expect(visibleText(page, /专注投入增加/)).toBeVisible();
  await expect(visibleText(page, /\+25%/)).toBeVisible();

  // 趋势图真实渲染（无假图：有 svg + 学习趋势标题）
  await expect(page.getByText("学习趋势", { exact: true })).toBeVisible();
  await expect(page.locator(".recharts-surface")).toHaveCount(1);
});

demoTest("近 4 周 range：coverage 提示出现、对比/信号消失", async ({ page }) => {
  await seedLearningHistory(page);
  await openAnalytics(page);

  // 切到近 4 周
  await page.getByRole("button", { name: "近 4 周" }).click();
  await page.waitForTimeout(800);

  // current.from（28d 前）早于 historyStartedAt → 提示可见（V3 文案）
  await expect(visibleText(page, /部分历史记录不完整/)).toBeVisible();
  await expect(visibleText(page, /记录不完整/)).toBeVisible();

  // comparison 不可用 → 无 delta、无信号
  await expect(visibleText(page, /↑ 25%/)).toHaveCount(0);
  await expect(visibleText(page, /专注投入增加/)).toHaveCount(0);

  // 切回本周 → 提示消失
  await page.getByRole("button", { name: "本周" }).click();
  await page.waitForTimeout(800);
  await expect(page.getByTestId("analytics-coverage-notice")).toHaveCount(0);
});

demoTest("空历史（本周）→ 无任何假指标/假图", async ({ page }) => {
  await openAnalytics(page);

  // Fresh app：coverage 初始化为今天 → 本周视图提示不完整（真实行为）
  await expect(visibleText(page, /部分历史记录不完整/)).toBeVisible();

  await expect(visibleText(page, /学习洞察会随着使用逐渐形成/)).toBeVisible();
  await expect(page.locator(".recharts-surface")).toHaveCount(0);
  await expect(page.getByText("学习趋势", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/执行情况/)).toHaveCount(0);
});

demoTest("完成任务 → 洞察实时更新（订阅链路）", async ({ page }) => {
  await openAnalytics(page);

  // 先确认空状态
  await expect(visibleText(page, /学习洞察会随着使用逐渐形成/)).toBeVisible();

  // 去任务工作区完成一个任务（drawer 主操作）
  await page.getByRole("button", { name: "任务与 DDL" }).first().click();
  await expect(page.getByRole("heading", { name: "任务与 DDL" })).toBeVisible();
  await page.getByTestId("assignment-list").getByText("计量经济学大作业（第3章）").click();
  const drawer = page.getByRole("dialog", { name: "任务详情" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "标记完成" }).click();
  await expect(drawer.getByRole("button", { name: "重新打开" })).toBeVisible();
  await drawer.getByRole("button", { name: "关闭" }).click();

  // 回到洞察：完成任务 live 刷新（V3：fresh app 本周区间记录不完整 → 「已记录 1 项」）
  await page.getByRole("button", { name: "学习洞察" }).first().click();
  await expect(visibleText(page, /已记录 1 项/)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/学习洞察会随着使用逐渐形成/)).toHaveCount(0);
});
