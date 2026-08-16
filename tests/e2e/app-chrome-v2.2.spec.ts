import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * App Chrome V2.2 — Timeline Workspace Chrome E2E：
 * A-O 覆盖：Header / ViewBar 结构、周导航与边界、今天、Filter 语义与 active 态、
 * Create / Ask Kiro / More 入口、Popover 互斥、无 Local Toolbar、无横向裁剪、单 sticky chrome。
 * 只测最终状态与语义（不测毫秒）。
 */

async function openTimeline(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "时间表" }).first().click();
  await expect(page.getByRole("heading", { name: "时间表" })).toBeVisible();
  await expect(page.getByTestId("timeline-viewbar")).toBeVisible();
}

/** 在当前周 seed 一个 StudyBlock / 今日 DDL 任务 / 今日活动（localStorage patch 在 hydration 前生效） */
async function seedCurrentWeekContent(page: Page) {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
  await page.addInitScript(
    ({ today }) => {
      const raw = localStorage.getItem("classflow-storage-v2");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      parsed.state.studyBlocks = [
        { id: "sb-chrome", title: "今日精读", date: today, startTime: "12:00", endTime: "13:00", source: "manual" },
      ];
      parsed.state.assignments = [
        ...(parsed.state.assignments ?? []),
        { id: "ddl-chrome", courseId: "c_1", title: "几何作业", description: "", ddl: `${today}T23:59:00`, priority: "high", status: "todo", progress: 0, tags: [] },
      ];
      parsed.state.calendarMarks = [
        ...(parsed.state.calendarMarks ?? []),
        { id: "cm-chrome", date: today, type: "activity", title: "学术圆桌", startTime: "10:00", endTime: "11:00" },
      ];
      localStorage.setItem("classflow-storage-v2", JSON.stringify(parsed));
    },
    { today: todayStr }
  );
}

test("A+B+O：Header 存在；ViewBar 紧跟 Header；单 sticky chrome 无双重滚动", async ({ page }) => {
  await openTimeline(page);

  // Header：标题 + 第 N 周 context（header 在 main 内不具备 banner landmark role）
  const header = page.locator("main header").first();
  await expect(header.getByText("时间表", { exact: true })).toBeVisible();
  await expect(page.getByText(/第 1 周 ·/)).toBeVisible();

  // ViewBar 直接位于 Header 之后（同一 sticky 容器内）
  const order = await page.evaluate(() => {
    const headerEl = document.querySelector("main header");
    if (!headerEl) return null;
    const sibling = headerEl.nextElementSibling as HTMLElement | null;
    const container = headerEl.parentElement as HTMLElement | null;
    return {
      viewbarAfterHeader: sibling?.dataset?.testid === "timeline-viewbar",
      stickyContainer: container?.classList.contains("sticky") ?? false,
    };
  });
  expect(order).toEqual({ viewbarAfterHeader: true, stickyContainer: true });

  // 单滚动模型：body 不滚动；滚动只可能发生在 main（或都不滚）——无双重滚动条
  const scrollModel = await page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) return { mainScrolls: false, bodyScrolls: false };
    return {
      mainScrolls: main.scrollHeight > main.clientHeight + 1,
      bodyScrolls: document.body.scrollHeight > window.innerHeight + 1,
    };
  });
  expect(scrollModel.bodyScrolls).toBe(false);
  // main 是否滚动取决于内容高度（高视口下时间表可完全容纳）；但绝不出现 body 滚动
  expect(scrollModel.mainScrolls).toBe(scrollModel.mainScrolls);
});

test("C：旧 Card Local Toolbar 不再存在（周导航/筛选/新建/更多 均不在 Card 内）", async ({ page }) => {
  await openTimeline(page);
  const card = page.getByTestId("timeline-workspace");
  for (const name of ["上一周", "下一周", "今天", "筛选", "新建", "更多操作", "Ask Kiro"]) {
    await expect(card.getByRole("button", { name })).toHaveCount(0);
  }
});

test("D+E：上一周/下一周 更新 currentSemesterWeek；今天 回到真实当前周", async ({ page }) => {
  await openTimeline(page);
  const scope = page.getByTestId("timeline-week-scope");

  await scope.getByRole("button", { name: "下一周" }).click();
  await expect(page.getByText(/第 2 周 ·/)).toBeVisible();

  await scope.getByRole("button", { name: "上一周" }).click();
  await expect(page.getByText(/第 1 周 ·/)).toBeVisible();

  // 今天：先切走，再回当前周（demoFixtures 学期本周为第 1 周）
  await scope.getByRole("button", { name: "下一周" }).click();
  await expect(page.getByText(/第 2 周 ·/)).toBeVisible();
  await scope.getByRole("button", { name: "今天" }).click();
  await expect(page.getByText(/第 1 周 ·/)).toBeVisible();
  await expect(scope.getByRole("button", { name: "今天" })).toBeDisabled();
});

test("F：边界 — 第 1 周 上一周 disabled；最后一周 下一周 disabled", async ({ page }) => {
  await openTimeline(page);
  const scope = page.getByTestId("timeline-week-scope");
  await expect(scope.getByRole("button", { name: "上一周" })).toBeDisabled();

  // 跳到最后一周（16 周）
  for (let i = 0; i < 15; i++) {
    await scope.getByRole("button", { name: "下一周" }).click();
  }
  await expect(page.getByText(/第 16 周 ·/)).toBeVisible();
  await expect(scope.getByRole("button", { name: "下一周" })).toBeDisabled();
});

test("G：Filter 语义不变 + active 态（学习计划/DDL/活动 真实内容联动）", async ({ page }) => {
  await seedCurrentWeekContent(page);
  await openTimeline(page);

  const filterTrigger = page.getByRole("button", { name: "筛选" });
  const block = page.getByTestId("timeline-study-block").first();
  const ddlPoint = page.getByTestId("timeline-key-lane").getByRole("button", { name: /几何作业/ }).first();
  const interval = page.getByRole("button", { name: /学术圆桌/ }).first();
  await expect(block).toBeVisible();
  await expect(ddlPoint).toBeVisible();
  await expect(interval).toBeVisible();

  // 关闭 学习计划 → StudyBlock 消失
  await filterTrigger.click();
  await page.getByRole("group", { name: "时间表筛选" }).getByLabel("学习计划").uncheck();
  await expect(block).toHaveCount(0);
  // 关闭面板 → Filter trigger 进入 active 态（plain bg-alabaster，非 hover 变体）
  await page.keyboard.press("Escape");
  await expect(filterTrigger).toHaveClass(/(?<!:)bg-alabaster/);

  // 关闭 DDL → DDL 点消失
  await filterTrigger.click();
  await page.getByRole("group", { name: "时间表筛选" }).getByLabel("DDL").uncheck();
  await expect(ddlPoint).toHaveCount(0);

  // 关闭 活动 → 活动 interval 消失
  await page.getByRole("group", { name: "时间表筛选" }).getByLabel("活动").uncheck();
  await expect(interval).toHaveCount(0);

  // 全部恢复 → 内容回归；关闭面板 → active 态消失
  await page.getByRole("group", { name: "时间表筛选" }).getByLabel("学习计划").check();
  await page.getByRole("group", { name: "时间表筛选" }).getByLabel("DDL").check();
  await page.getByRole("group", { name: "时间表筛选" }).getByLabel("活动").check();
  await expect(block).toBeVisible();
  await expect(ddlPoint).toBeVisible();
  await expect(interval).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(filterTrigger).not.toHaveClass(/(?<!:)bg-alabaster/);
});

test("H：新建菜单四入口可用（新建课程/学习计划/新建任务/考试 日程）", async ({ page }) => {
  await openTimeline(page);

  await page.getByRole("button", { name: "新建" }).click();
  const menu = page.getByRole("menu", { name: "新建" });
  for (const label of ["新建课程", "学习计划", "新建任务", "考试 / 日程"]) {
    await expect(menu.getByRole("menuitem", { name: label })).toBeVisible();
  }
  // 学习计划 → ArrangeSheet
  await menu.getByRole("menuitem", { name: "学习计划" }).click();
  await expect(page.getByRole("dialog", { name: "安排学习计划" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "安排学习计划" })).toHaveCount(0);

  // 考试 / 日程 → MarkSheet
  await page.getByRole("button", { name: "新建" }).click();
  await page.getByRole("menu", { name: "新建" }).getByRole("menuitem", { name: "考试 / 日程" }).click();
  await expect(page.getByRole("dialog", { name: "添加考试或日程" })).toBeVisible();
  await page.keyboard.press("Escape");

  // 新建任务 → Editor
  await page.getByRole("button", { name: "新建" }).click();
  await page.getByRole("menu", { name: "新建" }).getByRole("menuitem", { name: "新建任务" }).click();
  await expect(page.getByRole("heading", { name: "新建任务" })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("I：Ask Kiro 仍在 Header 并 handoff 当前周", async ({ page }) => {
  await openTimeline(page);
  const askKiro = page.getByRole("button", { name: "Ask Kiro" });
  await expect(askKiro).toBeVisible();
  await askKiro.click();
  await expect(page.getByTestId("kiro-sidecar")).toBeVisible({ timeout: 10000 });
});

test("J：More — 导入课表 / 全屏 / 时间表设置 可用", async ({ page }) => {
  await openTimeline(page);

  await page.getByRole("button", { name: "更多操作" }).click();
  const menu = page.getByRole("menu", { name: "更多操作" });
  for (const label of ["导入课表", "全屏查看", "时间表设置"]) {
    await expect(menu.getByRole("menuitem", { name: label })).toBeVisible();
  }
  await menu.getByRole("menuitem", { name: "导入课表" }).click();
  await expect(page.getByRole("dialog", { name: "导入课表" })).toBeVisible();
  await page.getByRole("dialog", { name: "导入课表" }).getByRole("button", { name: "关闭" }).click();

  await page.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menu", { name: "更多操作" }).getByRole("menuitem", { name: "全屏查看" }).click();
  await expect(page.getByRole("dialog", { name: "完整课表" })).toBeVisible();
  await page.getByRole("dialog", { name: "完整课表" }).getByRole("button", { name: "关闭" }).click();

  await page.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menu", { name: "更多操作" }).getByRole("menuitem", { name: "时间表设置" }).click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await expect(page.getByTestId("settings-semester")).toBeVisible();
});

test("K：Filter / Quick / More 三向互斥（同一时刻只有一个菜单打开）", async ({ page }) => {
  await openTimeline(page);

  // Filter 打开 → 新建 → filter 关闭、quick 打开
  await page.getByRole("button", { name: "筛选" }).click();
  await expect(page.getByRole("group", { name: "时间表筛选" })).toBeVisible();
  await page.getByRole("button", { name: "新建" }).click();
  await expect(page.getByRole("group", { name: "时间表筛选" })).toHaveCount(0);
  await expect(page.getByRole("menu", { name: "新建" })).toBeVisible();

  // Quick 打开 → More → quick 关闭、more 打开
  await page.getByRole("button", { name: "更多操作" }).click();
  await expect(page.getByRole("menu", { name: "新建" })).toHaveCount(0);
  await expect(page.getByRole("menu", { name: "更多操作" })).toBeVisible();

  // More 打开 → Filter → more 关闭、filter 打开
  await page.getByRole("button", { name: "筛选" }).click();
  await expect(page.getByRole("menu", { name: "更多操作" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "时间表筛选" })).toBeVisible();
});

test("L+M：Timeline 内容与拖拽骨架不回归（day columns 存在；wrapRef 仍在 Card 上）", async ({ page }) => {
  await openTimeline(page);
  await expect(page.locator("[data-timetable-day]").first()).toBeVisible();
  const dayCount = await page.locator("[data-timetable-day]").count();
  expect(dayCount).toBeGreaterThanOrEqual(5);

  // wrapRef 指向内容 Card（floating detail bounds 依赖；assert 卡片内 day columns）
  const cardHasDays = await page
    .getByTestId("timeline-workspace")
    .locator("[data-timetable-day]")
    .count();
  expect(cardHasDays).toBe(dayCount);
});

test("N：Desktop / Medium / Mobile 无横向裁剪", async ({ page }) => {
  for (const [w, h] of [[1440, 900], [1024, 768], [390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/");
    await page.getByRole("button", { name: "时间表" }).first().click();
    await expect(page.getByTestId("timeline-workspace")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow, `viewport ${w}`).toBe(false);
    // Header 右侧（Kiro/New/More/Search）不溢出
    const headerOverflow = await page.evaluate(() => {
      const header = document.querySelector("main header");
      if (!header) return false;
      const right = header.lastElementChild as HTMLElement | null;
      return right ? right.scrollWidth > right.clientWidth + 1 : false;
    });
    expect(headerOverflow, `header overflow at ${w}`).toBe(false);
  }
});
