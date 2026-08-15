import { test as base, expect } from "@playwright/test";

/**
 * Entity Activity Timeline（focused E2E）：
 * Assignment Detail + Floating Course Hub 的真实 Learning History 展示。
 * History 通过 raw IndexedDB seed（schema 与 lib/history/store 一致，非 UI 操作伪造）。
 * - Activity 默认 closed；展开后按时间显示真实文案
 * - completed + 同 mutation status_changed 不重复；focus start/pause/resume 不显示
 * - Kiro source 有 chip；Material 无 fake activity
 * - Floating Course Hub 几何：展开 Activity 后 content-fit 仍成立（居中 / 不缩水）
 */

function dayAnchor(): { monday: string } {
  const now = new Date();
  const w = now.getDay() === 0 ? 7 : now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (w - 1));
  const p = (n: number) => String(n).padStart(2, "0");
  return { monday: `${mon.getFullYear()}-${p(mon.getMonth() + 1)}-${p(mon.getDate())}` };
}

function seedScript(monday: string) {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const iso = (dayOffset: number, h: number, m: number) => {
    const mon = new Date(`${monday}T00:00:00`);
    const d = new Date(mon);
    d.setDate(mon.getDate() + dayOffset);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(h)}:${pad2(m)}:00`;
  };
  return `(() => {
    const DAY = 86400000;
    const pad2 = (n) => String(n).padStart(2, "0");
    const localDate = (d) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    const at = (offsetDays, hour, minute = 0) => {
      const d = new Date();
      d.setDate(d.getDate() + offsetDays);
      d.setHours(hour, minute, 0, 0);
      return d.getTime();
    };

    // ---- localStorage 业务数据 ----
    localStorage.setItem("classflow-storage-v2", JSON.stringify({
      version: 6,
      state: {
        userProfile: { name: "测试", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
        semester: { id: "s", name: "S", startDate: "${monday}", totalWeeks: 16 },
        courses: [
          { id: "c1", name: "数据结构与算法", code: "CS-210", teacher: "李教授", classroom: "计算机楼102", credit: 4, bgHex: "#DDE4DC", borderHex: "#C9D4C6", textHex: "#313032", description: "核心数据结构", materials: [] },
          { id: "c2", name: "操作系统", code: "CS-220", teacher: "张教授", classroom: "计算机楼201", credit: 3, bgHex: "#E9E2D9", borderHex: "#D8CDBF", textHex: "#313032", description: "", materials: [] },
        ],
        schedules: [
          { id: "s1", courseId: "c1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "计算机楼102", weeks: "1-16周" },
        ],
        assignments: [
          { id: "a1", courseId: "c1", title: "置信区间与检验小测", description: "", ddl: "${iso(4, 20, 0)}", priority: "high", status: "todo", progress: 0, tags: [] },
        ],
        calendarMarks: [],
        groupProjects: [],
        studyBlocks: [],
        assignmentTimeSlice: "all",
        preferences: { showWeekends: true, ddlWarningDays: 3, defaultDDLTime: "23:59", enableScheduleDirectManipulation: true, enableDDLDirectManipulation: true, motionPreference: "system", startupView: "overview", defaultTaskPriority: "medium", defaultTaskStatus: "todo", enableSingleKeyShortcuts: true, contentDensity: "comfortable", defaultTaskWorkspaceView: "focus", defaultDeadlineReminderMinutes: 1440 },
        reminders: [],
        focusSessions: [],
      },
    }));

    // ---- IndexedDB Learning History（真实 schema 一致） ----
    const openDb = () => new Promise((resolve, reject) => {
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

    (async () => {
      const db = await openDb();
      const tx = db.transaction(["events", "meta"], "readwrite");
      const store = tx.objectStore("events");
      let seq = 0;
      const ev = (patch) => ({
        schemaVersion: 1,
        timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
        semesterId: "s",
        semesterNameSnapshot: "S",
        semesterWeek: 1,
        source: "manual",
        sequence: ++seq,
        ...patch,
      });
      const created = at(-2, 9, 0);
      const deadlineAt = at(-1, 21, 18);
      const studyAt = at(-1, 19, 4);
      const focusAt = Date.now() - 3 * 3600000;
      const doneAt = Date.now() - 3600000;
      store.put(ev({
        id: "h-a1-created", type: "assignment.created", entityType: "assignment", entityId: "a1",
        assignmentId: "a1", courseId: "c1", courseNameSnapshot: "数据结构与算法",
        assignmentTitleSnapshot: "置信区间与检验小测",
        occurredAt: created, localDate: localDate(new Date(created)),
        source: "kiro",
        data: { status: "todo", priority: "high", ddl: null, estimatedMinutes: null },
      }));
      store.put(ev({
        id: "h-a1-ddl", type: "assignment.deadline_changed", entityType: "assignment", entityId: "a1",
        assignmentId: "a1", courseId: "c1", assignmentTitleSnapshot: "置信区间与检验小测",
        occurredAt: deadlineAt, localDate: localDate(new Date(deadlineAt)),
        data: { before: null, after: "${iso(4, 20, 0)}" },
      }));
      store.put(ev({
        id: "h-a1-sb", type: "study_block.created", entityType: "study-block", entityId: "sb1",
        assignmentId: "a1", courseId: "c1",
        occurredAt: studyAt, localDate: localDate(new Date(studyAt)),
        data: { date: "${iso(1, 0, 0).slice(0, 10)}", startTime: "19:00", endTime: "20:00", plannedMinutes: 60, originSource: "manual" },
      }));
      store.put(ev({
        id: "h-a1-focus-start", type: "focus.started", entityType: "focus-session", entityId: "fs1",
        assignmentId: "a1", courseId: "c1",
        occurredAt: focusAt - 60000, localDate: localDate(new Date(focusAt - 60000)),
        data: { plannedMinutes: 45, sessionSource: "manual", startedAt: focusAt - 60000 },
      }));
      store.put(ev({
        id: "h-a1-focus-pause", type: "focus.paused", entityType: "focus-session", entityId: "fs1",
        assignmentId: "a1", courseId: "c1",
        occurredAt: focusAt - 30000, localDate: localDate(new Date(focusAt - 30000)),
        data: { accumulatedActiveMs: 30000 },
      }));
      store.put(ev({
        id: "h-a1-focus-done", type: "focus.completed", entityType: "focus-session", entityId: "fs1",
        assignmentId: "a1", courseId: "c1",
        occurredAt: focusAt, localDate: localDate(new Date(focusAt)),
        data: { plannedMinutes: 45, actualActiveMs: 42 * 60000 + 31000, startedAt: focusAt - 60000, endedAt: focusAt, endReason: "timer", sessionSource: "manual" },
      }));
      // 同 mutation：completed + status_changed（同一 occurredAt → status_changed 被抑制）
      store.put(ev({
        id: "h-a1-status", type: "assignment.status_changed", entityType: "assignment", entityId: "a1",
        assignmentId: "a1", courseId: "c1",
        occurredAt: doneAt, localDate: localDate(new Date(doneAt)),
        data: { from: "doing", to: "completed" },
      }));
      store.put(ev({
        id: "h-a1-done", type: "assignment.completed", entityType: "assignment", entityId: "a1",
        assignmentId: "a1", courseId: "c1",
        occurredAt: doneAt, localDate: localDate(new Date(doneAt)),
        data: { previousStatus: "doing", completionTrigger: "status" },
      }));
      // course scope：course.created + schedule.created
      const courseAt = at(-7, 8, 0);
      const schedAt = at(-6, 8, 30);
      store.put(ev({
        id: "h-c1-created", type: "course.created", entityType: "course", entityId: "c1",
        courseId: "c1", courseNameSnapshot: "数据结构与算法",
        occurredAt: courseAt, localDate: localDate(new Date(courseAt)),
        data: { name: "数据结构与算法", code: "CS-210", credit: 4 },
      }));
      store.put(ev({
        id: "h-c1-sched", type: "schedule.created", entityType: "schedule", entityId: "s1",
        courseId: "c1",
        occurredAt: schedAt, localDate: localDate(new Date(schedAt)),
        data: { dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "计算机楼102", weeks: "1-16周" },
      }));
      // coverage：historyStartedAt = 上周一（早于所有事件）
      const mon = new Date();
      mon.setDate(mon.getDate() - ((mon.getDay() === 0 ? 7 : mon.getDay()) - 1));
      mon.setHours(0, 0, 0, 0);
      tx.objectStore("meta").put({ key: "coverage", value: { schemaVersion: 1, historyStartedAt: mon.getTime() - 7 * DAY, initializedAt: mon.getTime() - 7 * DAY, focusBackfillCompleted: true, backfilledFocusSessions: 0 } });
      await new Promise((resolve) => { tx.oncomplete = () => resolve(); });
    })();
  })()`;
}

async function openAssignmentDetail(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "课程资料" }).first().click();
  await page.getByRole("button", { name: "数据结构与算法", exact: true }).click();
  const hub = page.getByRole("dialog", { name: "课程详情" });
  await expect(hub).toBeVisible({ timeout: 8000 });
  await hub.getByText("置信区间与检验小测", { exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "任务详情" });
  await expect(drawer).toBeVisible({ timeout: 8000 });
  return drawer;
}

base("Assignment：Activity 默认 closed → 展开显示真实文案（suppression / noise / Kiro chip）", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  const drawer = await openAssignmentDetail(page);

  // 默认 closed：不触发 history I/O 视觉（无列表）
  const trigger = drawer.getByTestId("entity-activity-trigger-assignment");
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  // 加载完成：核心事件文案（时间 desc）
  await expect(drawer.getByText("完成任务", { exact: true })).toBeVisible({ timeout: 8000 });
  await expect(drawer.getByText("完成专注", { exact: true })).toBeVisible();
  await expect(drawer.getByText("43 分钟", { exact: true })).toBeVisible();
  await expect(drawer.getByText("安排学习时间", { exact: true })).toBeVisible();
  await expect(drawer.getByText("设置截止时间为 8月", { exact: false })).toBeVisible();
  await expect(drawer.getByText("创建任务", { exact: true })).toBeVisible();

  // completed + 同 mutation status_changed 不重复：无「状态从...改为...」行
  await expect(drawer.getByText(/状态从「/)).toHaveCount(0);
  // focus start/pause 不显示
  await expect(drawer.getByText("focus.started", { exact: true })).toHaveCount(0);
  await expect(drawer.getByText("focus.paused", { exact: true })).toHaveCount(0);
  // Kiro chip（创建任务由 Kiro 发起）；manual 行无 badge
  await expect(drawer.getByText("Kiro", { exact: true }).first()).toBeVisible();
  // 分组：今天 / 昨天
  await expect(drawer.getByText("今天", { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText("昨天", { exact: true }).first()).toBeVisible();
});

base("Course：Activity closed → 展开显示课程里程碑；Material 无 fake activity", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "课程资料" }).first().click();
  await page.getByRole("button", { name: "数据结构与算法", exact: true }).click();
  const hub = page.getByRole("dialog", { name: "课程详情" });
  await expect(hub).toBeVisible({ timeout: 8000 });

  const trigger = hub.getByTestId("entity-activity-trigger-course");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(hub.getByText("完成任务", { exact: true }).first()).toBeVisible({ timeout: 8000 });
  // 课程里程碑较旧 → 展开查看更多（默认前 5 条）
  await hub.getByRole("button", { name: /查看更多（/ }).click();

  await expect(hub.getByText("创建课程", { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(hub.getByText("添加上课时段", { exact: true })).toBeVisible();
  await expect(hub.getByText("创建任务", { exact: true }).first()).toBeVisible();
  await expect(hub.getByText("置信区间与检验小测", { exact: true }).first()).toBeVisible();
  // Material 不产生 fake activity：无上传/删除资料相关行
  await expect(hub.getByText(/上传了资料|删除了资料/)).toHaveCount(0);
  // 覆盖起点可见
  await expect(hub.getByText(/记录自/)).toBeVisible();
});

base("Floating Hub 几何：展开 Activity 后 content-fit 仍成立（居中 / 高度不缩水）", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "课程资料" }).first().click();
  await page.getByRole("button", { name: "操作系统", exact: true }).click();
  const hub = page.getByRole("dialog", { name: "课程详情" });
  await expect(hub).toBeVisible({ timeout: 8000 });
  await expect(async () => {
    const transform = await hub.evaluate((el) => getComputedStyle(el).transform);
    expect(transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)").toBe(true);
  }).toPass({ timeout: 5000 });
  const before = (await hub.boundingBox())!;
  expect(Math.abs(before.y + before.height / 2 - 450)).toBeLessThanOrEqual(4);

  // 展开 Activity（操作系统无 history → 空态）→ 高度增长或不变，仍居中，不超 viewport
  await hub.getByTestId("entity-activity-trigger-course").click();
  await expect(hub.getByText("暂无已记录活动", { exact: true })).toBeVisible({ timeout: 8000 });
  await expect(async () => {
    const transform = await hub.evaluate((el) => getComputedStyle(el).transform);
    expect(transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)").toBe(true);
  }).toPass({ timeout: 5000 });
  const after = (await hub.boundingBox())!;
  expect(after.height).toBeGreaterThanOrEqual(before.height);
  expect(Math.abs(after.y + after.height / 2 - 450)).toBeLessThanOrEqual(4);
  expect(after.y + after.height).toBeLessThanOrEqual(900 - 12);
});
