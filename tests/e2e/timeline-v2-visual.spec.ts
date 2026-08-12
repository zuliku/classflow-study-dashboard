import { test as base, expect } from "@playwright/test";

/**
 * Timeline V2 Polish 验证：duration / clip / marker / interval bar-only（原生 test + 自定义种子）。
 */

function dayAnchor(): { monday: string; dow1: number } {
  const now = new Date();
  const w = now.getDay() === 0 ? 7 : now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (w - 1));
  const p = (n: number) => String(n).padStart(2, "0");
  return { monday: `${mon.getFullYear()}-${p(mon.getMonth() + 1)}-${p(mon.getDate())}`, dow1: w };
}

function seedScript(monday: string, dow1: number) {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const iso = (dow: number, h: number, m: number) => {
    const mon = new Date(`${monday}T00:00:00`);
    const d = new Date(mon);
    d.setDate(mon.getDate() + (dow - 1));
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(h)}:${pad2(m)}:00`;
  };
  const dateStr = (dow: number) => iso(dow, 0, 0).slice(0, 10);
  return `(() => {
    if (localStorage.getItem("classflow-storage-v2")) return;
    localStorage.setItem("classflow-storage-v2", JSON.stringify({
      version: 4,
      state: {
        userProfile: { name: "测试", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
        semester: { id: "s", name: "S", startDate: "${monday}", totalWeeks: 16 },
        courses: [{ id: "c1", name: "数据结构", code: "CS", teacher: "李老师", classroom: "A101", credit: 3, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [] }],
        schedules: [{ id: "s1", courseId: "c1", dayOfWeek: ${dow1}, startTime: "08:00", endTime: "09:40", location: "A101", weeks: "1-16周" }],
        assignments: [],
        calendarMarks: [
          { id: "m1", date: "${dateStr(dow1)}", type: "exam", title: "概率论期中考试", startTime: "14:00", endTime: "16:00" },
        ],
        groupProjects: [],
        studyBlocks: [
          { id: "b1", title: "重叠任务", date: "${dateStr(dow1)}", startTime: "08:30", endTime: "09:30", source: "manual" },
          { id: "b2", title: "一小时任务", date: "${dateStr(dow1)}", startTime: "19:00", endTime: "20:00", source: "manual" },
          { id: "b3", title: "跨边界任务", date: "${dateStr(dow1)}", startTime: "20:30", endTime: "21:30", source: "manual" },
          { id: "b4", title: "深夜任务", date: "${dateStr(dow1)}", startTime: "22:00", endTime: "23:00", source: "manual" },
        ],
        assignmentTimeSlice: "all",
        preferences: { showWeekends: true, ddlWarningDays: 3, defaultDDLTime: "23:59", enableScheduleDirectManipulation: true, enableDDLDirectManipulation: true, motionPreference: "system", startupView: "overview", defaultTaskPriority: "medium", defaultTaskStatus: "todo", enableSingleKeyShortcuts: true, contentDensity: "comfortable" },
      },
    }));
  })()`;
}

async function openTimeline(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "时间表" }).first().click();
  await expect(page.getByRole("heading", { name: "时间表" })).toBeVisible();
  await expect(page.getByTestId("timeline-workspace")).toBeVisible();
}

base("duration 修复 + 21:00 clip + 22:00 不显示 + overlap marker + interval bar-only", async ({ page }) => {
  const { monday, dow1 } = dayAnchor();
  await page.addInitScript(seedScript(monday, dow1));
  await openTimeline(page);

  // 1) 60min → 1h（不是 1min）
  await expect(
    page.locator('[data-testid="timeline-study-block"]').filter({ hasText: "一小时任务" })
  ).toContainText("1h");

  // 2) overlap（08:30-09:30 vs 课程 08:00-09:40）→ block 不渲染 + 课程卡 marker 出现
  await expect(
    page.locator('[data-testid="timeline-study-block"]').filter({ hasText: "重叠任务" })
  ).toHaveCount(0);
  await expect(page.locator('[data-testid="course-task-marker"]').first()).toBeVisible();

  // 3) 22:00-23:00 完全在 08:00-21:00 之外 → 不显示
  await expect(
    page.locator('[data-testid="timeline-study-block"]').filter({ hasText: "深夜任务" })
  ).toHaveCount(0);

  // 4) 跨边界 20:30-21:30 仍显示（clip 到 21:00，非完全在外）
  await expect(
    page.locator('[data-testid="timeline-study-block"]').filter({ hasText: "跨边界任务" })
  ).toHaveCount(1);

  // 5) Interval：默认无标题常驻；hover 显示 popover
  // 注：key lane 按天渲染（7 个 lane），mark 落在当日 lane —— 用文档级唯一定位，不依赖 .first()
  const markButton = page.getByRole("button", { name: /概率论期中考试/ });
  await expect(page.getByText("概率论期中考试", { exact: true })).toHaveCount(0);
  await markButton.hover();
  await expect(page.getByText("概率论期中考试", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("考试", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/14:00–16:00/)).toBeVisible();
});

base("Overview 不显示 Task Marker（课程卡干净）", async ({ page }) => {
  const { monday, dow1 } = dayAnchor();
  await page.addInitScript(seedScript(monday, dow1));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("timetable-card").first()).toBeVisible();
  await expect(page.locator('[data-testid="course-task-marker"]')).toHaveCount(0);
});

base("Task 2B1：Timeline Filter/Create/More 统一浮层并保持 dismiss/互斥", async ({ page }) => {
  const { monday, dow1 } = dayAnchor();
  await page.addInitScript(seedScript(monday, dow1));
  await openTimeline(page);

  const filterButton = page.getByRole("button", { name: "筛选" });
  const createButton = page.getByRole("button", { name: "新建" });
  const moreButton = page.getByRole("button", { name: "更多操作" });

  await filterButton.click();
  const filterPanel = page.getByRole("group", { name: "时间表筛选" });
  await expect(filterPanel).toBeVisible();
  await expect(filterButton).toHaveAttribute("aria-expanded", "true");

  await createButton.click();
  await expect(filterPanel).toHaveCount(0);
  const createMenu = page.getByRole("menu", { name: "新建" });
  await expect(createMenu).toBeVisible();

  await moreButton.click();
  await expect(createMenu).toHaveCount(0);
  const moreMenu = page.getByRole("menu", { name: "更多操作" });
  await expect(moreMenu).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(moreMenu).toHaveCount(0);
  await expect(moreButton).toHaveAttribute("aria-expanded", "false");

  await filterButton.click();
  await expect(filterPanel).toBeVisible();
  await page.getByRole("heading", { name: "时间表" }).click();
  await expect(filterPanel).toHaveCount(0);

  await createButton.click();
  await page.getByRole("menu", { name: "新建" }).getByRole("menuitem", { name: "学习计划" }).click();
  await expect(page.getByTestId("timeline-arrange-sheet")).toBeVisible();
});
