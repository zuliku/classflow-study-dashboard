import { test as base, expect } from "@playwright/test";

/**
 * Timeline Task 4A：Floating Detail（Portal/collision）+ Short Interval capsule 验证。
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
          { id: "m2", date: "${dateStr(dow1)}", type: "activity", title: "深夜极短活动", startTime: "23:50", endTime: "23:59" },
        ],
        groupProjects: [],
        studyBlocks: [
          { id: "b1", title: "重叠任务", date: "${dateStr(dow1)}", startTime: "08:30", endTime: "09:30", source: "manual" },
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
  await expect(page.getByText(/第 \d+ 周/).first()).toBeVisible();
}

base("Floating Detail：Marker hover → Portal Popover（不压课程卡、不闪退）", async ({ page }) => {
  const { monday, dow1 } = dayAnchor();
  await page.addInitScript(seedScript(monday, dow1));
  await openTimeline(page);

  // Marker 在课程卡右上角
  const marker = page.locator('[data-testid="course-task-marker"]');
  await expect(marker).toBeVisible();
  const markerBox = await marker.boundingBox();
  const card = page.locator('[data-testid="schedule-card"]').first();
  const cardBox = await card.boundingBox();
  // 右上角：marker 右侧接近 card 右缘、顶部接近 card 顶部
  expect(markerBox!.x + markerBox!.width).toBeGreaterThan(cardBox!.x + cardBox!.width - 40);
  expect(markerBox!.y - cardBox!.y).toBeLessThan(20);

  // Hover → Portal Popover（body 直属）
  await marker.hover();
  const floating = page.getByTestId("floating-timeline-detail");
  await expect(floating).toBeVisible({ timeout: 3000 });
  await expect(floating.getByText("学习任务")).toBeVisible();
  await expect(floating.getByText(/重叠任务/)).toBeVisible();
  // 4542102 起文案为通用「与当前课程时间重叠」（不再内插课程名）
  await expect(floating.getByText(/与当前课程时间重叠/)).toBeVisible();

  // 在 body 直属（portal）→ 不受 overflow 容器裁剪
  const inBody = await floating.evaluate((el) => el.parentElement === document.body);
  expect(inBody).toBe(true);

  // 移动鼠标到 Popover 上 → 不闪退
  await floating.hover();
  await page.waitForTimeout(300);
  await expect(floating).toBeVisible();

  // Esc 关闭
  await page.keyboard.press("Escape");
  await expect(floating).toHaveCount(0);
});

base("Floating Detail：Interval hover → Popover；极短 Interval 为 16px capsule", async ({ page }) => {
  const { monday, dow1 } = dayAnchor();
  await page.addInitScript(seedScript(monday, dow1));
  await openTimeline(page);

  // Interval 默认无标题常驻
  await expect(page.getByText("概率论期中考试", { exact: true })).toHaveCount(0);

  // Hover → Portal Popover（页面级定位：exam mark 在今天列，跨天运行不受 `.first()` 列限制）
  await page.getByRole("button", { name: /概率论期中考试/ }).hover();
  const floating = page.getByTestId("floating-timeline-detail");
  await expect(floating).toBeVisible({ timeout: 3000 });
  await expect(floating.getByText("概率论期中考试", { exact: true })).toBeVisible();
  await expect(floating.getByText("考试", { exact: true })).toBeVisible();
  await expect(floating.getByText(/14:00–16:00/)).toBeVisible();
  await page.keyboard.press("Escape");

  // 极短 Interval（23:50-23:59）：真实宽度 < 16px → 16px capsule
  await page.getByRole("button", { name: /深夜极短活动/ }).hover();
  const floating2 = page.getByTestId("floating-timeline-detail");
  await expect(floating2).toBeVisible({ timeout: 3000 });
  // Tooltip 仍显示真实时间（不因 capsule 变长）
  await expect(floating2.getByText(/23:50–23:59/)).toBeVisible();
  await page.keyboard.press("Escape");

  const shortBar = page.getByRole("button", { name: /深夜极短活动/ });
  const shortBox = await shortBar.boundingBox();
  expect(shortBox!.width).toBeGreaterThanOrEqual(14); // 16px 左右 capsule
  expect(shortBox!.width).toBeLessThan(40);
});

base("Deadline Point 接入 Floating：hover 显示详情", async ({ page }) => {
  const { monday, dow1 } = dayAnchor();
  // 增加一个带 DDL 的任务（今天 21:00，避免与 23:50 极短活动重叠）
  const script = seedScript(monday, dow1).replace(
    "assignments: [],",
    `assignments: [{ id: "a1", courseId: "c1", title: "今天截止作业", description: "", ddl: "${monday}T21:00:00", priority: "high", status: "todo", progress: 0, tags: [] }],`
  );
  await page.addInitScript(script);
  await openTimeline(page);

  const lane = page.getByTestId("timeline-key-lane").first();
  await lane.getByRole("button", { name: /今天截止作业/ }).hover();
  const floating = page.getByTestId("floating-timeline-detail");
  await expect(floating).toBeVisible({ timeout: 3000 });
  await expect(floating.getByText("今天截止作业", { exact: true })).toBeVisible();
  await expect(floating.getByText(/21:00 截止/)).toBeVisible();
});
