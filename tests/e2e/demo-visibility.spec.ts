import { test, Page, expect } from "@playwright/test";

/**
 * 全模块预览数据可见性 E2E（开发自动注入后逐模块验证）。
 * 所有断言用 visible filter：避免匹配到 PageTransition/布局中的隐藏副本。
 */
async function seedAutoInject(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByText("已载入完整演示数据").first()).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1500); // PageTransition 动画完成
}

const visibleText = (page: Page, text: string | RegExp) =>
  page.getByText(text as string).filter({ visible: true }).first();

test("全模块演示数据可见性：总览/时间表/任务/课程资料/统计/小组协作", async ({ page }) => {
  await seedAutoInject(page);

  // ---- 总览 ----
  await expect(visibleText(page, /数据结构与算法/)).toBeVisible(); // 本周课表课程块
  await expect(visibleText(page, /进程调度实验报告/)).toBeVisible(); // 临近 DDL
  await expect(visibleText(page, /临近 DDL/)).toBeVisible();
  await expect(visibleText(page, /8月/)).toBeVisible(); // MiniCalendar

  // ---- 时间表 ----
  await page.getByRole("button", { name: "时间表" }).first().click();
  await page.waitForTimeout(600);
  await expect(visibleText(page, /红黑树删除算法整理/)).toBeVisible(); // StudyBlock 今天
  await expect(visibleText(page, /大数定律专题精读/)).toBeVisible(); // StudyBlock 周末
  await expect(visibleText(page, /贝叶斯公式课后练习/)).toBeVisible(); // DDL 点
  await expect(visibleText(page, /概率论小测验/)).toBeVisible(); // 考试

  // ---- 任务与 DDL ----
  await page.getByRole("button", { name: "任务与 DDL" }).first().click();
  await page.waitForTimeout(600);
  await expect(visibleText(page, /进程调度实验报告/)).toBeVisible(); // 逾期任务
  await expect(visibleText(page, /红黑树删除算法整理/)).toBeVisible(); // 无 DDL
  await expect(visibleText(page, /子任务: 1 \/ 3/)).toBeVisible();
  await expect(visibleText(page, /已计划/)).toBeVisible();

  // ---- 课程资料 + 材料（drawer）----
  await page.getByRole("button", { name: "课程资料" }).first().click();
  await page.waitForTimeout(600);
  await expect(visibleText(page, /计算机网络/)).toBeVisible(); // 第 5 门课
  await page.getByText("数据结构与算法").first().click();
  await page.waitForTimeout(600);
  await expect(visibleText(page, /第3章 树与二叉树讲义\.pdf/)).toBeVisible();
  await expect(visibleText(page, /算法可视化（Visualgo）/)).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).first().click();
  await page.waitForTimeout(600);

  // ---- 学习洞察 ----
  await page.getByRole("button", { name: "学习洞察" }).first().click();
  await page.waitForTimeout(600);
  await expect(visibleText(page, /学习洞察会随着使用逐渐形成/)).toBeVisible();
  await expect(visibleText(page, /完成任务、安排学习计划或进行专注后/)).toBeVisible();

  // ---- 小组协作 ----
  await page.getByRole("button", { name: "小组协作" }).first().click();
  await page.waitForTimeout(600);
  await expect(visibleText(page, /校园导航系统课程设计/)).toBeVisible();
  await expect(visibleText(page, /AI Ethics 小组论文/)).toBeVisible();
  await expect(visibleText(page, /李晨/)).toBeVisible();
  await expect(visibleText(page, /Dijkstra 算法实现/)).toBeVisible();
});
