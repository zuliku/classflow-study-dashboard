import { test as base, expect } from "@playwright/test";

/**
 * Course Library V5 —— Compact Resource Dashboard focused E2E。
 * 核心：同一 Grid row 等高（items-stretch + h-full），row 之间不要求等高（无 fixed 320）。
 * 4 门课程 fixture：
 * - Row1：c1（2 attention tasks + 2 materials）、c2（0 / 0，空课程）
 * - Row2：c3（2 attention tasks + 0 materials）、c4（1 attention task + 1 material）
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
  const mkCourse = (
    id: string,
    name: string,
    bgHex: string,
    borderHex: string,
    materials: { id: string; title: string }[]
  ) => ({
    id,
    name,
    code: `CS-${id.slice(1)}`,
    teacher: "李教授",
    classroom: "计算机楼102",
    credit: 3,
    bgHex,
    borderHex,
    textHex: "#313032",
    description: "",
    materials: materials.map((m) => ({
      ...m,
      type: "pdf",
      size: "2.4 MB",
      uploadDate: "2026-08-10",
    })),
  });
  const mkTask = (id: string, courseId: string, title: string, ddl: string | undefined, status: string) => ({
    id,
    courseId,
    title,
    description: "",
    priority: "medium",
    status,
    progress: 0,
    tags: [],
    ddl,
  });
  return `(() => {
    if (localStorage.getItem("classflow-storage-v2")) return;
    localStorage.setItem("classflow-storage-v2", JSON.stringify({
      version: 7,
      state: {
        userProfile: { name: "测试", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
        semester: { id: "s", name: "S", startDate: "${monday}", totalWeeks: 16 },
        courses: [
          ${JSON.stringify(mkCourse("c1", "高级数据结构与算法设计及复杂度分析", "#E3F0E6", "#2E7D5B", [
            { id: "m1", title: "第3章 树与二叉树讲义.pdf" },
            { id: "m2", title: "算法可视化（Visualgo）" },
          ]))},
          ${JSON.stringify(mkCourse("c2", "操作系统", "#F0EBE1", "#C9A227", []))},
          ${JSON.stringify(mkCourse("c3", "概率论与数理统计", "#F3E8E6", "#A87952", []))},
          ${JSON.stringify(mkCourse("c4", "数据库系统", "#E8EDF3", "#5B7C9B", [{ id: "m4", title: "MySQL 实战讲义.pdf" }]))},
          ${JSON.stringify(mkCourse("c5", "学术英语写作", "#EDE8F0", "#7B5B9B", []))},
        ],
        schedules: [],
        assignments: [
          ${JSON.stringify(mkTask("a1", "c1", "红黑树删除算法整理", iso(7, 20, 0), "todo"))},
          ${JSON.stringify(mkTask("a2", "c1", "整理本周算法笔记", undefined, "doing"))},
          ${JSON.stringify(mkTask("a3", "c1", "已交作业", iso(-1, 20, 0), "submitted"))},
          ${JSON.stringify(mkTask("a4", "c3", "概率论课后习题", iso(2, 20, 0), "todo"))},
          ${JSON.stringify(mkTask("a5", "c3", "置信区间推导", iso(1, 20, 0), "doing"))},
          ${JSON.stringify(mkTask("a6", "c4", "数据库实验四", iso(4, 20, 0), "todo"))},
          ${JSON.stringify(mkTask("a7", "c4", "已完成任务", iso(-3, 20, 0), "completed"))},
          ${JSON.stringify(mkTask("a8", "c5", "第一周写作作业", iso(-5, 20, 0), "completed"))},
          ${JSON.stringify(mkTask("a9", "c5", "第二周写作作业", iso(-6, 20, 0), "completed"))},
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
  })()`;
}

async function openLibrary(page: import("@playwright/test").Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  if (width < 768) {
    await page.getByRole("button", { name: "更多" }).click();
    await page.getByRole("menuitem", { name: "课程" }).click();
  } else {
    await page.getByRole("button", { name: "课程资料" }).first().click();
  }
  await expect(page.getByRole("heading", { name: "课程资料", exact: true })).toBeVisible({ timeout: 8000 });
}

base("Row1：c1（满内容）与 c2（空课程）同 row 等高（top/bottom/height 对齐）", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await openLibrary(page);

  const cardA = page.getByTestId("course-library-card-c1");
  const cardB = page.getByTestId("course-library-card-c2");
  await expect(cardA).toBeVisible();
  await expect(cardB).toBeVisible();
  const boxA = (await cardA.boundingBox())!;
  const boxB = (await cardB.boundingBox())!;

  expect(Math.abs(boxA.y - boxB.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(boxA.height - boxB.height)).toBeLessThanOrEqual(2);
  expect(Math.abs(boxA.y + boxA.height - (boxB.y + boxB.height))).toBeLessThanOrEqual(2);
});

base("Row2：c3 / c4 各自等高；且不要求 row1 == row2（无 fixed 320）", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await openLibrary(page);

  const c3 = page.getByTestId("course-library-card-c3");
  const c4 = page.getByTestId("course-library-card-c4");
  const box3 = (await c3.boundingBox())!;
  const box4 = (await c4.boundingBox())!;
  expect(Math.abs(box3.y - box4.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(box3.height - box4.height)).toBeLessThanOrEqual(2);

  // 不是全局固定高度（V5 禁 fixed 320；row 高度由内容/stable slots 决定）
  for (const c of [page.getByTestId("course-library-card-c1"), c3]) {
    const cls = (await c.getAttribute("class")) ?? "";
    expect(cls).not.toMatch(/h-\[(320|312|300|340)px\]|min-h-\[(320|312|300|340)px\]/);
  }
  const box1 = (await page.getByTestId("course-library-card-c1").boundingBox())!;
  expect(box1.height).not.toBe(320);
});

base("Copy：待处理 2（c1）/ 全部 3 项 / 课程资料 2 / submitted 不算待处理（c1 待处理 2 非 3）", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await openLibrary(page);

  const c1 = page.getByTestId("course-library-card-c1");
  await expect(c1.getByText("待处理 2", { exact: true })).toBeVisible();
  await expect(c1.getByText("全部 3 项", { exact: true })).toBeVisible();
  await expect(c1.getByText("课程资料 2", { exact: true })).toBeVisible();
  // submitted 旧 DDL 不产生逾期 badge
  await expect(c1.getByText(/项逾期/)).toHaveCount(0);
  // 空课程
  const c2 = page.getByTestId("course-library-card-c2");
  await expect(c2.getByText("待处理 0", { exact: true })).toBeVisible();
  await expect(c2.getByText("暂无待处理任务", { exact: true })).toBeVisible();
  await expect(c2.getByText("暂无课程资料", { exact: true })).toBeVisible();
});

base("长课程名：单行 truncate 不撑高 row；Footer 不存在", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await openLibrary(page);

  const card = page.getByTestId("course-library-card-c1");
  const title = card.getByRole("button", { name: "高级数据结构与算法设计及复杂度分析", exact: true });
  await expect(title).toBeVisible();
  // 单行 truncate：scrollWidth <= clientWidth
  const overflow = await title.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // title attribute 保留完整名称
  await expect(title).toHaveAttribute("title", "高级数据结构与算法设计及复杂度分析");
  // Footer 完全移除
  await expect(card.locator("footer")).toHaveCount(0);
  await expect(card.getByText("课程详情", { exact: true })).toHaveCount(0);
});

base("Actions smoke：标题 → Course Hub；任务行 → Assignment Detail；全部 N 项 → Popover；添加 → Editor", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await openLibrary(page);

  const c1 = page.getByTestId("course-library-card-c1");
  // Course name → Floating Course Hub
  await c1.getByRole("button", { name: "高级数据结构与算法设计及复杂度分析", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "课程详情" })).toBeVisible({ timeout: 8000 });
  await page.getByRole("dialog", { name: "课程详情" }).getByRole("button", { name: "关闭" }).click();
  await expect(page.getByRole("dialog", { name: "课程详情" })).toHaveCount(0);

  // 任务行 → Assignment Floating Detail
  await c1.getByRole("button", { name: /红黑树删除算法整理/ }).click();
  await expect(page.getByRole("dialog", { name: "任务详情" })).toBeVisible({ timeout: 8000 });
  await page.getByRole("dialog", { name: "任务详情" }).getByRole("button", { name: "关闭" }).click();
  await expect(page.getByRole("dialog", { name: "任务详情" })).toHaveCount(0);

  // 全部 3 项 → Popover（完整列表含 submitted）
  await c1.getByRole("button", { name: /全部 3 项/ }).click();
  await expect(page.getByText("已交作业", { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/任务 3/)).toBeVisible();
  await page.keyboard.press("Escape");

  // 添加 → Assignment Editor，courseId 预选当前课程
  await c1.getByRole("button", { name: /添加/ }).first().click();
  const editor = page.getByRole("dialog", { name: "添加任务" });
  await expect(editor).toBeVisible({ timeout: 8000 });
  await expect(editor.getByRole("combobox", { name: "课程" })).toContainText("高级数据结构与算法设计及复杂度分析");
});

base("V5.1：completed-only 课程 → 待处理 0 + 全部 2 项 → Popover 两个已完成任务可见", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await openLibrary(page);

  const c5 = page.getByTestId("course-library-card-c5");
  await expect(c5).toBeVisible();
  await expect(c5.getByText("待处理 0", { exact: true })).toBeVisible();
  await expect(c5.getByText("暂无待处理任务", { exact: true })).toBeVisible();
  await expect(c5.getByText("全部 2 项", { exact: true })).toBeVisible();

  // 点击 → Popover 展示完整列表（两个 completed 任务可见）
  await c5.getByRole("button", { name: /全部 2 项/ }).click();
  await expect(page.getByText("第一周写作作业", { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText("第二周写作作业", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  // 1 todo + 1 submitted 的 c1 也必须有完整入口（V5.1 回归）
  const c1 = page.getByTestId("course-library-card-c1");
  await expect(c1.getByText("全部 3 项", { exact: true })).toBeVisible();
});

base("390×844：无横向 overflow；header/上传/待处理/资料可见；无 footer", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await openLibrary(page, 390, 844);

  const card = page.getByTestId("course-library-card-c1");
  await expect(card).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(card.getByRole("button", { name: "上传《高级数据结构与算法设计及复杂度分析》的课程资料" })).toBeVisible();
  await expect(card.getByText("待处理 2", { exact: true })).toBeVisible();
  await expect(card.getByText("课程资料 2", { exact: true })).toBeVisible();
  await expect(card.locator("footer")).toHaveCount(0);
});
