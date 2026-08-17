import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * App Chrome V2.3 — Workspace Consistency Closure E2E：
 * - WorkspaceHeader / WorkspaceViewBar innerClassName bounded 支持（默认几何不回归）
 * - Analytics：Header / ViewBar / 1500px 版心对齐 / Range / Weekly Review 交互语义
 * - Group：双 gutter 修复、本地 Create 降权、Empty CTA 保留、Master–Detail 不回归
 */

async function openAnalytics(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "学习洞察" }).first().click();
  await expect(page.getByRole("heading", { name: "学习洞察" })).toBeVisible();
}

async function openGroup(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "小组协作" }).first().click();
  await expect(page.getByRole("heading", { name: "小组协作" })).toBeVisible();
}

// ==================== Analytics Chrome ====================

test("Analytics：WorkspaceHeader + ViewBar + Global Search + 三档 Range", async ({ page }) => {
  await openAnalytics(page);

  // Header：标题 + context（WorkspaceHeader 语义）+ Global Search
  await expect(page.getByRole("heading", { name: "学习洞察" })).toBeVisible();
  await expect(page.getByText("从学习历史中理解你的投入与节奏")).toBeVisible();
  await expect(page.getByRole("button", { name: "全局搜索" })).toBeVisible();

  // ViewBar：Range Selector（三档，非第四种 selection）+ Weekly Review 独立 action
  const bar = page.getByTestId("analytics-viewbar");
  await expect(bar).toBeVisible();
  const rangeGroup = bar.getByRole("group", { name: "分析范围" });
  for (const label of ["本周", "近 4 周", "本学期"]) {
    await expect(rangeGroup.getByRole("button", { name: label })).toBeVisible();
  }
  await expect(bar.getByTestId("weekly-review-action")).toBeVisible();
  // Weekly Review 不属于 range group
  await expect(rangeGroup.getByTestId("weekly-review-action")).toHaveCount(0);
});

test("Analytics：切换 Range 更新真实 preset（aria-pressed）", async ({ page }) => {
  await openAnalytics(page);
  const rangeGroup = page.getByTestId("analytics-viewbar").getByRole("group", { name: "分析范围" });
  await rangeGroup.getByRole("button", { name: "近 4 周" }).click();
  await expect(rangeGroup.getByRole("button", { name: "近 4 周" })).toHaveAttribute("aria-pressed", "true");
  await expect(rangeGroup.getByRole("button", { name: "本周" })).toHaveAttribute("aria-pressed", "false");
  await rangeGroup.getByRole("button", { name: "本学期" }).click();
  await expect(rangeGroup.getByRole("button", { name: "本学期" })).toHaveAttribute("aria-pressed", "true");
});

test("Analytics：Weekly Review 语义 A/B/C/D（week 展开 / 再点收起 / 非 week 回 week 展开 / 切 range 收起）", async ({ page }) => {
  await openAnalytics(page);
  const review = page.getByTestId("weekly-review-action");
  const rangeGroup = page.getByTestId("analytics-viewbar").getByRole("group", { name: "分析范围" });

  // Case A：week + 未展开 → 展开 + scroll（本周回顾卡片可见）
  await review.click();
  await expect(review).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("本周回顾")).toBeVisible();

  // Case B：再点 → 收起
  await review.click();
  await expect(review).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "收起周回顾" })).toHaveCount(0);

  // Case C：从 semester 点周回顾 → 回 week + 展开
  await rangeGroup.getByRole("button", { name: "本学期" }).click();
  await expect(rangeGroup.getByRole("button", { name: "本学期" })).toHaveAttribute("aria-pressed", "true");
  await review.click();
  await expect(rangeGroup.getByRole("button", { name: "本周" })).toHaveAttribute("aria-pressed", "true");
  await expect(review).toHaveAttribute("aria-pressed", "true");

  // Case D：展开状态下切到 4weeks → 收起
  await rangeGroup.getByRole("button", { name: "近 4 周" }).click();
  await expect(review).toHaveAttribute("aria-pressed", "false");
});

test("Analytics：reduced motion 下周回顾仍可展开（behavior 不依赖 smooth）", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openAnalytics(page);
  await page.getByTestId("weekly-review-action").click();
  await expect(page.getByTestId("weekly-review-action")).toHaveAttribute("aria-pressed", "true");
});

test("Analytics：超宽屏 Header / ViewBar / Body 同一版心（1500px 对齐，左右 ≤2px）", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "学习洞察" }).first().click();
  await expect(page.getByRole("heading", { name: "学习洞察" })).toBeVisible();
  await expect(page.getByTestId("analytics-body")).toBeVisible();

  const boxes = await page.evaluate(() => {
    const headerInner = document.querySelector("main header > div");
    const bar = document.querySelector('[data-testid="analytics-viewbar"]');
    const barInner = bar ? (bar.firstElementChild as HTMLElement | null) : null;
    const body = document.querySelector('[data-testid="analytics-body"]');
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right };
    };
    return { header: box(headerInner), bar: box(barInner), body: box(body) };
  });
  expect(boxes.header).not.toBeNull();
  expect(boxes.bar).not.toBeNull();
  expect(boxes.body).not.toBeNull();
  for (const key of ["bar", "body"] as const) {
    expect(Math.abs(boxes[key]!.left - boxes.header!.left), `${key} left`).toBeLessThanOrEqual(2);
    expect(Math.abs(boxes[key]!.right - boxes.header!.right), `${key} right`).toBeLessThanOrEqual(2);
  }
  expect(boxes.body!.right - boxes.body!.left).toBeLessThanOrEqual(1502);
});

test("Analytics：Loading / Empty 下 Chrome 持续存在（空历史 → 空态，Header/ViewBar 仍在）", async ({ page }) => {
  await openAnalytics(page);
  // demoFixtures 无学习历史 → EmptyState（学习洞察会随着使用逐渐形成）
  await expect(page.getByText("学习洞察会随着使用逐渐形成")).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("heading", { name: "学习洞察" })).toBeVisible();
  await expect(page.getByTestId("analytics-viewbar")).toBeVisible();
});

// ==================== WorkspaceHeader 默认几何回归 ====================

test("默认 Header 几何不回归：desktop min-h-16 / mobile min-h-14 / px gutter", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const header = page.locator("main header").first();
  const hh = await header.evaluate((el) => {
    const inner = (el as HTMLElement).firstElementChild as HTMLElement;
    return {
      minHeight: parseFloat(getComputedStyle(inner).minHeight),
      paddingLeft: parseFloat(getComputedStyle(inner).paddingLeft),
    };
  });
  expect(hh.minHeight).toBe(64);
  expect(hh.paddingLeft).toBe(24); // md:px-6

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const mh = await page
    .locator("main header")
    .first()
    .evaluate((el) => {
      const inner = (el as HTMLElement).firstElementChild as HTMLElement;
      return {
        minHeight: parseFloat(getComputedStyle(inner).minHeight),
        paddingLeft: parseFloat(getComputedStyle(inner).paddingLeft),
      };
    });
  expect(mh.minHeight).toBe(56);
  expect(mh.paddingLeft).toBe(16); // px-4
});

// ==================== Group Chrome ====================

test("Group：Header + 本地 Create 降权 + Empty CTA 保留（demoFixtures 空项目）", async ({ page }) => {
  await openGroup(page);

  // Header：标题 + context + Primary 新建项目；无 activeProject → 无 Ask Kiro
  await expect(page.getByRole("heading", { name: "小组协作" })).toBeVisible();
  await expect(page.getByText(/0 个项目/)).toBeVisible();
  await expect(page.getByRole("button", { name: "新建项目" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask Kiro" })).toHaveCount(0);

  // 项目列表本地 create：icon-only（aria-label 新建项目，无文字内容）；空态 CTA 保留文字按钮
  const asideCreates = page.locator("aside").getByRole("button", { name: "新建项目" });
  await expect(asideCreates).toHaveCount(2); // icon-only（列表头）+ empty CTA
  expect((await asideCreates.first().textContent())!.trim()).toBe("");
  await expect(asideCreates.last()).toContainText("新建项目");
});

test("Group：创建项目后 Ask Kiro 出现；列表本地 create 为 icon-only；CRUD 与搜索正常", async ({ page }) => {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  await page.addInitScript(({ today }) => {
    const raw = localStorage.getItem("classflow-storage-v2");
    if (!raw) return;
    const parsed = JSON.parse(raw);
    parsed.state.groupProjects = [
      {
        id: "gp-1",
        courseId: "c_1",
        title: "微观小组课题",
        description: "小组作业",
        progress: 20,
        updatedAt: today,
        members: [],
        tasks: [
          { id: "t-1", title: "文献调研", assigneeId: undefined, ddl: `${today}T23:59:00`, completed: false },
          { id: "t-2", title: "数据分析", assigneeId: undefined, ddl: `${today}T23:59:00`, completed: false },
        ],
      },
    ];
    localStorage.setItem("classflow-storage-v2", JSON.stringify(parsed));
  }, { today: todayStr });
  await openGroup(page);

  await expect(page.getByText(/1 个项目/)).toBeVisible();
  // 首个项目自动激活 → Ask Kiro 出现（仅 activeProject 时显示；空态无 Ask Kiro 已由上一用例覆盖）
  await expect(page.getByRole("button", { name: "Ask Kiro" })).toBeVisible();
  await page.getByRole("button", { name: /微观小组课题/ }).first().click();
  await expect(page.getByRole("button", { name: "Ask Kiro" })).toBeVisible();

  // 本地 create：icon-only（Header Primary 之外无文字按钮）
  const localCreate = page.locator("aside").getByRole("button", { name: "新建项目" });
  await expect(localCreate).toHaveCount(1);
  expect((await localCreate.textContent())!.trim()).toBe("");

  // 添加成员
  await page.getByRole("button", { name: "添加成员" }).first().click();
  await page.getByLabel("姓名").fill("测试成员");
  await page.getByRole("button", { name: "添加成员" }).last().click();
  await expect(page.getByText("测试成员")).toBeVisible();

  // 添加任务
  await page.getByRole("button", { name: "添加任务" }).first().click();
  await page.getByLabel("任务名称").fill("实验报告");
  await page.getByRole("button", { name: "添加任务" }).last().click();
  await expect(page.getByText("实验报告")).toBeVisible();

  // 任务搜索
  await page.getByLabel("检索任务").fill("实验");
  await expect(page.getByText("实验报告")).toBeVisible();
  await expect(page.getByText("文献调研")).toHaveCount(0);
});

test("Group：单一 body gutter（desktop 24 / mobile 16），无嵌套双 padding、无新增 nested scrollbar", async ({ page }) => {
  await openGroup(page);

  // 单一 body gutter：main 内第一个带对称内边距的容器（Group 两栏 body；desktop 24 / mobile 16）
  const readGutter = () =>
    page.evaluate(() => {
      const main = document.querySelector("main");
      if (!main) return null;
      for (const el of Array.from(main.querySelectorAll("div"))) {
        const cs = getComputedStyle(el);
        const pl = parseFloat(cs.paddingLeft);
        const pr = parseFloat(cs.paddingRight);
        if (pl > 0 && pl === pr) return { pl, pr };
      }
      return null;
    });
  expect(await readGutter()).toEqual({ pl: 24, pr: 24 });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await readGutter()).toEqual({ pl: 16, pr: 16 });

  // 无嵌套双滚动：main 是唯一页面滚动容器（body 不滚动）；项目列表内部滚动不产生页面级第二滚动条
  const scrollModel = await page.evaluate(() => ({
    bodyScrolls: document.body.scrollHeight > window.innerHeight + 1,
  }));
  expect(scrollModel.bodyScrolls).toBe(false);
});

test("Group：Master–Detail 结构不回归（项目选择 + 详情）", async ({ page }) => {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  await page.addInitScript(({ today }) => {
    const raw = localStorage.getItem("classflow-storage-v2");
    if (!raw) return;
    const parsed = JSON.parse(raw);
    parsed.state.groupProjects = [
      { id: "gp-1", courseId: "c_1", title: "项目A", description: "", progress: 10, updatedAt: today, members: [], tasks: [] },
      { id: "gp-2", courseId: "c_1", title: "项目B", description: "", progress: 40, updatedAt: today, members: [], tasks: [] },
    ];
    localStorage.setItem("classflow-storage-v2", JSON.stringify(parsed));
  }, { today: todayStr });
  await openGroup(page);

  await page.getByRole("button", { name: /项目A/ }).first().click();
  await expect(page.getByRole("heading", { name: "项目A" })).toBeVisible();
  await page.getByRole("button", { name: /项目B/ }).first().click();
  await expect(page.getByRole("heading", { name: "项目B" })).toBeVisible();
});
