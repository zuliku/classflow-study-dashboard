import { expect, Page } from "@playwright/test";
import { test as demoTest } from "./demoFixtures";

/**
 * Learning Analytics V3（Truth & IA）focused E2E：
 * A. Desktop 层级：Summary Strip / 学习趋势 / 值得注意 / 投入与节奏 / 执行情况 齐全
 * B. 1920×1080：流式占满工作区（d96b007 意图，无 1500 上限）+ Header/Body 对齐
 * C. 配对行等高（ca62dac 意图：grid stretch，signals 与 Trend 同高顶对齐）
 * D. 投入与节奏等高顶对齐（ca62dac 意图）
 * E. 课程投入显示真实课程名（snapshot）；无多行「未关联课程」；unlinked 唯一聚合
 * F. 本周趋势 label 为「M/d 周一」格式（非 raw ISO、无补零）
 */

const visibleText = (page: Page, text: string | RegExp) =>
  page.getByText(text as string).filter({ visible: true }).first();

/**
 * 时间冻结（周内稳健性）：把页面时钟拨到本周五 12:00。
 * 种子事件全部落在周一～周四（最晚 f7 周四 10:00），应用按 occurredAt > now 排除未来事件
 * （正确行为）；不冻结时，周三前运行会丢 f6/f7（总额 -25 分钟），周一早上丢更多 →
 * 总额/几何/课程名断言全灭。只偏移 Date（定时器/rAF 不动），presence/动画/超时语义不受影响；
 * 同一周内，周一锚点/趋势 label/学期周均不变。
 */
async function freezeToFridayNoon(page: Page) {
  const now = new Date();
  const dow = now.getDay() === 0 ? 7 : now.getDay();
  const friday = new Date(now);
  friday.setDate(now.getDate() + (5 - dow));
  friday.setHours(12, 0, 0, 0);
  await page.addInitScript((frozenTs: number) => {
    const RealDate = Date;
    const OFFSET = frozenTs - RealDate.now();
    class ShiftedDate extends RealDate {
      constructor(...args: never[]) {
        super();
        const inst =
          args.length === 0
            ? new RealDate(RealDate.now() + OFFSET)
            : Reflect.construct(RealDate, args, new.target);
        Object.setPrototypeOf(inst, new.target.prototype);
        return inst;
      }
      static now(): number {
        return RealDate.now() + OFFSET;
      }
    }
    window.Date = ShiftedDate as unknown as DateConstructor;
  }, friday.getTime());
}

demoTest.beforeEach(async ({ page }) => {
  await freezeToFridayNoon(page);
});

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
        // 一个按时完成的任务（ddl +5d；completed 周一 11:00）→ on-time 精确 100%
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
  // 动量区：热力可见 + 连续 4 天（周一～周四有记录，周五冻结时钟下今日未动但保持）
  await expect(page.getByTestId("analytics-momentum")).toBeVisible();
  await expect(page.getByTestId("momentum-heatmap")).toBeVisible();
  await expect(page.getByTestId("momentum-streak-value")).toContainText("4 天");
});

demoTest("B：1920×1080 流式布局——占满工作区（无 1500 上限，d96b007 意图），Header/Body 对齐", async ({ page }) => {
  await seedLearningHistory(page);
  await openAnalytics(page, 1920, 1080);

  const bodyInner = page.getByTestId("analytics-body");
  const headerInner = page.getByTestId("analytics-header-inner");
  await expect(bodyInner).toBeVisible();
  const body = (await bodyInner.boundingBox())!;
  const header = (await headerInner.boundingBox())!;
  // 流式：body 基本占满 main 宽度（仅 gutter 差值），不再居中留白
  const main = (await page.locator("main").first().boundingBox())!;
  expect(main.width - body.width).toBeLessThanOrEqual(64);
  // Header 与 Body 同宽对齐
  expect(Math.abs(header.x - body.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(header.width - body.width)).toBeLessThanOrEqual(2);
});

demoTest("C：总览配对列等高（trend+动量 / signals+执行 同高顶对齐）", async ({ page }) => {
  await seedLearningHistory(page);
  await openAnalytics(page);

  const trendCard = page.getByTestId("learning-trend-card");
  const signalsColumn = page.getByTestId("analytics-signals-column");
  await expect(signalsColumn).toBeVisible();
  const trendBox = (await trendCard.boundingBox())!;
  const signalsBox = (await signalsColumn.boundingBox())!;
  // 等高 + 顶对齐（grid stretch；右列承载 signals + execution）
  expect(Math.abs(signalsBox.height - trendBox.height)).toBeLessThanOrEqual(2);
  expect(Math.abs(signalsBox.y - trendBox.y)).toBeLessThanOrEqual(2);
});

demoTest("D：投入与节奏等高顶对齐（grid stretch，ca62dac 意图）", async ({ page }) => {
  await seedLearningHistory(page);
  await openAnalytics(page);

  const investment = page.getByTestId("course-investment-card");
  const rhythm = page.getByTestId("focus-rhythm-card");
  await expect(investment).toBeVisible();
  await expect(rhythm).toBeVisible();
  const inv = (await investment.boundingBox())!;
  const rhy = (await rhythm.boundingBox())!;
  expect(Math.abs(inv.height - rhy.height)).toBeLessThanOrEqual(2);
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

  // 周一 label（本周一日期动态计算；应用格式为无补零 M/d，与图表注释一致）
  const now = new Date();
  const dow = now.getDay() === 0 ? 7 : now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (dow - 1));
  const monLabel = `${mon.getMonth() + 1}/${mon.getDate()} 周一`;
  await expect(page.getByText(monLabel, { exact: true }).first()).toBeVisible();
  // raw ISO 不作为最终标签
  await expect(page.getByText(/^\d{4}-\d{2}-\d{2}$/).first()).toHaveCount(0);
});

/** partial fixture：coverage 从「现在」开始 → 本周区间 assignment/plan/focus 全部 partial */
async function seedPartialHistory(page: Page) {
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
      // 今日 2 次专注 + 1 个完成（ddl +5d → raw onTimeRate 本可计算，但 coverage partial 禁止显示）
      store.put(
        ev({
          id: "pf1",
          type: "focus.completed",
          entityType: "focus-session",
          entityId: "pf1",
          occurredAt: now.getTime() - 2 * 3600000,
          localDate: localDate(new Date(now.getTime() - 2 * 3600000)),
          sequence: 1,
          courseId: "c_4",
          courseNameSnapshot: "数据分析",
          data: { actualActiveMs: 45 * 60000, startedAt: now.getTime() - 2 * 3600000, plannedMinutes: 45 },
        })
      );
      store.put(
        ev({
          id: "pa1-completed",
          type: "assignment.completed",
          entityType: "assignment",
          entityId: "pa1",
          assignmentId: "pa1",
          occurredAt: now.getTime() - 3600000,
          localDate: localDate(new Date(now.getTime() - 3600000)),
          sequence: 2,
          courseId: "c_4",
          data: {},
        })
      );
      tx.objectStore("meta").put({
        key: "coverage",
        value: {
          schemaVersion: 1,
          historyStartedAt: now.getTime() - 3600000,
          initializedAt: now.getTime() - 3600000,
          studyBlockBatchIntegrityStartedAt: now.getTime() - 3600000,
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

demoTest("G：Header 分离——Range 三项 + 独立周回顾 action（非第四种 selection）", async ({ page }) => {
  await seedLearningHistory(page);
  await openAnalytics(page);

  const range = page.getByRole("group", { name: "分析范围" });
  await expect(range).toBeVisible();
  await expect(range.getByRole("button", { name: "本周" })).toBeVisible();
  await expect(range.getByRole("button", { name: "近 4 周" })).toBeVisible();
  await expect(range.getByRole("button", { name: "本学期" })).toBeVisible();
  await expect(range.getByRole("button")).toHaveCount(3);
  // 周回顾是独立 action（不在 range selector 内）
  const reviewAction = page.getByTestId("weekly-review-action");
  await expect(reviewAction).toBeVisible();
  expect(await reviewAction.getAttribute("aria-pressed")).toBe("false");
});

demoTest("H：本周完整覆盖 → Execution 精确（按时完成 100%）；无 Coverage 提示", async ({ page }) => {
  await seedLearningHistory(page);
  await openAnalytics(page);

  await expect(page.getByTestId("analytics-coverage-notice")).toHaveCount(0);
  const exec = page.getByTestId("execution-quality-card");
  await expect(exec.getByText("100%", { exact: true })).toBeVisible();
  await expect(exec.getByText(/样本不足 · 1 个可判断任务/)).toBeVisible();
  await expect(exec.getByText("1 项", { exact: true }).first()).toBeVisible(); // 完成任务 1 项
});

demoTest("I：partial range → Coverage 折叠可展开（只显示真实事实）；Execution 无伪精确按时率", async ({ page }) => {
  await seedPartialHistory(page);
  await openAnalytics(page);

  // 折叠态：标题 + hint + 查看范围
  const notice = page.getByTestId("analytics-coverage-notice");
  await expect(notice).toBeVisible();
  await expect(notice.getByText("部分历史记录不完整", { exact: true })).toBeVisible();
  await expect(notice.getByText("部分指标仅展示已记录内容", { exact: true })).toBeVisible();
  const toggle = notice.getByRole("button", { name: /查看范围|收起/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  // 展开：逐项事实；focus partial 无具体日期
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(notice.getByText(/任务记录：自 \d+月\d+日 起完整/)).toBeVisible();
  await expect(notice.getByText(/学习计划：自 \d+月\d+日 起完整/)).toBeVisible();
  await expect(notice.getByText("专注记录：当前区间可能不完整", { exact: true })).toBeVisible();

  // Execution：无伪精确按时率；completed 显示已记录
  const exec = page.getByTestId("execution-quality-card");
  await expect(exec.getByText("已记录 1 项", { exact: true }).first()).toBeVisible();
  await expect(exec.getByText(/任务历史不完整，暂不判断按时率/)).toBeVisible();
  await expect(exec.getByText(/\d+%/, { exact: false })).toHaveCount(0);

  // Summary detail 可读（不被 ellipsis 隐藏）
  const onTimeDetail = page.getByTestId("summary-detail-按时完成");
  await expect(onTimeDetail).toContainText("任务历史不完整");
  expect((await onTimeDetail.getAttribute("class")) ?? "").not.toContain("truncate");
});

demoTest("J：周回顾 toggle（open→scroll→再点收起）；切 range 自动收起", async ({ page }) => {
  await seedLearningHistory(page);
  await openAnalytics(page);

  const action = page.getByTestId("weekly-review-action");
  await action.click();
  await expect(page.getByTestId("weekly-review-card")).toBeVisible({ timeout: 8000 });
  await expect(action).toHaveAttribute("aria-expanded", "true");
  await expect(action).toContainText("收起周回顾");

  // 再点 → 收起
  await action.click();
  await expect(page.getByTestId("weekly-review-card")).toHaveCount(0);

  // 展开后再切 range → 收起
  await action.click();
  await expect(page.getByTestId("weekly-review-card")).toBeVisible({ timeout: 8000 });
  await page.getByRole("button", { name: "近 4 周" }).click();
  await page.waitForTimeout(500);
  await expect(page.getByTestId("weekly-review-card")).toHaveCount(0);
  await expect(action).toHaveAttribute("aria-expanded", "false");
});

demoTest("K：390px 无横向 overflow；Summary detail 可读；legend 可读", async ({ page }) => {
  await seedLearningHistory(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "更多" }).click();
  await page.getByRole("menuitem", { name: "学习洞察" }).click();
  await expect(page.getByRole("heading", { name: "学习洞察" })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1200);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // 计划执行 detail（实际/计划）完整可读（非单行 ellipsis）
  const detail = page.getByTestId("summary-detail-计划执行");
  await expect(detail).toBeVisible();
  expect((await detail.getAttribute("class")) ?? "").not.toContain("truncate");
  await expect(page.getByText("单位：分钟", { exact: true })).toBeVisible();
});
