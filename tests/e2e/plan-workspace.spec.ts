import { expect } from "@playwright/test";
import { test } from "./demoFixtures";
import type { Page } from "@playwright/test";

async function openPlan(page: Page) {
  await page.goto("/");
  // demoFixtures 默认 classic（供旧 Timeline E2E）；Plan spec 显式切到 plan。
  await page.evaluate(() => {
    const raw = localStorage.getItem("classflow-storage-v2");
    if (!raw) return;
    const parsed = JSON.parse(raw);
    parsed.state.preferences = {
      ...(parsed.state.preferences ?? {}),
      timetableMode: "plan",
    };
    localStorage.setItem("classflow-storage-v2", JSON.stringify(parsed));
  });
  await page.reload();
  await page.getByRole("button", { name: "时间表", exact: true }).click();
  await page.waitForTimeout(650);
}

async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
}

test.describe("Plan workspace", () => {
  test("1440：Backlog / Canvas 两列，拖入任务后生成学习块并打开 Inspector", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openPlan(page);

    await expect(page.getByTestId("plan-workspace")).toBeVisible();
    await expect(page.getByTestId("plan-backlog")).toBeVisible();
    await expect(page.getByTestId("plan-canvas")).toBeVisible();
    await expect(page.locator("[data-plan-day]")).toHaveCount(7);
    expect(await hasHorizontalOverflow(page)).toBe(false);

    const firstRow = page.getByTestId("plan-backlog-row").first();
    await firstRow.click();
    const inspector = page.getByTestId("plan-inspector");
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole("button", { name: "打开任务" })).toBeVisible();
    await inspector.getByRole("button", { name: "关闭详情" }).click();
    await expect(inspector).toBeHidden();

    const target = page.locator("[data-plan-day]").nth(2);
    await firstRow.dragTo(target, { targetPosition: { x: 50, y: 180 } });
    await expect(page.getByText(/^已安排 /).first()).toBeVisible();
    await expect(page.getByTestId("plan-inspector").getByText("学习块", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("plan-canvas-item").filter({ hasText: "计量经济学大作业" }).first()).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);

    await page.getByTestId("plan-inspector").getByRole("button", { name: "关闭详情" }).click();
    const studyBlock = page.locator("[data-testid='plan-canvas-item'][data-kind='study']").first();
    await studyBlock.dragTo(page.locator("[data-plan-day]").nth(5), {
      targetPosition: { x: 50, y: 350 },
    });
    await expect(page.getByText(/^已移到 /).first()).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);

    // Resize：拖底部 handle 向下 1h
    await page.getByTestId("plan-inspector").getByRole("button", { name: "关闭详情" }).click();
    const handle = studyBlock.getByTestId("plan-resize-handle");
    await handle.hover();
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error("resize handle unavailable");
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 56, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByText(/^已调整到 /).first()).toBeVisible();

    const readBlock = () =>
      page.evaluate(() => {
        const raw = localStorage.getItem("classflow-storage-v2") ?? "";
        const state = JSON.parse(raw).state;
        const block = (state.studyBlocks ?? []).find(
          (item: { title: string }) => item.title === "计量经济学大作业（第3章）"
        );
        return block
          ? { id: block.id, date: block.date, startTime: block.startTime, endTime: block.endTime }
          : null;
      });
    const resized = await readBlock();
    expect(resized).not.toBeNull();

    // 键盘：ArrowUp 移动 15min（静默），Delete 删除 + Undo 恢复
    await page.getByTestId("plan-inspector").getByRole("button", { name: "关闭详情" }).click();
    await studyBlock.focus();
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(300);
    const moved = await readBlock();
    expect(moved?.startTime).not.toBe(resized?.startTime);

    await studyBlock.focus();
    await page.keyboard.press("Delete");
    await expect(page.getByText("已删除学习块")).toBeVisible();
    await page.getByRole("button", { name: "撤销" }).first().click();
    await expect(page.getByTestId("plan-canvas-item").filter({ hasText: "计量经济学大作业" }).first()).toBeVisible();
  });

  test("1024：Backlog 收起，按钮打开左侧 Sheet；无横向溢出", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openPlan(page);

    await expect(page.getByTestId("plan-backlog")).toHaveCount(0);
    await page.getByRole("button", { name: /待安排 \d+/ }).click();
    await expect(page.getByTestId("plan-backlog")).toBeVisible();
    await expect(page.getByTestId("plan-backlog").getByText("待安排", { exact: true })).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test("390：Agenda 取代 7 天网格；待安排 Sheet 可打开并进入安排表单", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPlan(page);

    await expect(page.getByTestId("plan-agenda")).toBeVisible();
    await expect(page.getByTestId("plan-canvas")).toBeHidden();
    expect(await hasHorizontalOverflow(page)).toBe(false);

    await page.getByRole("button", { name: /待安排 \d+/ }).click();
    await expect(page.getByTestId("plan-backlog")).toBeVisible();
    const firstRow = page.getByTestId("plan-backlog-row").first();
    await firstRow.getByRole("button", { name: /安排《/ }).click();
    await expect(page.getByRole("dialog", { name: "安排学习计划" })).toBeVisible();
    await page.getByRole("button", { name: "确认安排" }).click();
    await expect(page.getByText(/^已安排 /).first()).toBeVisible();
    await expect(page.getByTestId("plan-inspector")).toBeVisible();
  });

  test("提案：自动安排本周 ghost → 应用 → 撤销", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.evaluate(() => {
      const raw = localStorage.getItem("classflow-storage-v2");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const state = parsed.state;
      const now = new Date();
      const ddl = new Date(now);
      ddl.setDate(ddl.getDate() + 7);
      const pad = (n: number) => String(n).padStart(2, "0");
      const ddlStr = `${ddl.getFullYear()}-${pad(ddl.getMonth() + 1)}-${pad(ddl.getDate())}T23:59:00`;
      state.schedules = [];
      state.calendarMarks = [];
      state.studyBlocks = [];
      state.preferences = { ...(state.preferences ?? {}), timetableMode: "plan" };
      state.assignments = (state.assignments ?? []).slice(0, 2).map((task: Record<string, unknown>) => ({
        ...task,
        status: "todo",
        progress: 0,
        estimatedMinutes: 120,
        ddl: ddlStr,
      }));
      localStorage.setItem("classflow-storage-v2", JSON.stringify(parsed));
    });
    await page.reload();
    await page.getByRole("button", { name: "时间表", exact: true }).click();
    await page.waitForTimeout(650);

    await page.getByRole("button", { name: "自动规划" }).click();
    await page.getByRole("menuitem", { name: "自动安排本周" }).click();
    const panel = page.getByTestId("plan-proposal-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("plan-ghost-item").first()).toBeVisible();
    const before = await page.evaluate(() => {
      const raw = localStorage.getItem("classflow-storage-v2") ?? "";
      return (JSON.parse(raw).state.studyBlocks ?? []).length;
    });
    expect(before).toBe(0);

    await panel.getByRole("button", { name: "应用计划" }).click();
    const approve = page.getByRole("button", { name: "仍然应用" });
    if (await approve.isVisible().catch(() => false)) await approve.click();
    await expect(page.getByText(/已创建 \d+ 个学习时段/).first()).toBeVisible();
    const after = await page.evaluate(() => {
      const raw = localStorage.getItem("classflow-storage-v2") ?? "";
      return (JSON.parse(raw).state.studyBlocks ?? []).length;
    });
    expect(after).toBeGreaterThan(0);

    await page.getByRole("button", { name: "撤销" }).first().click();
    await page.waitForTimeout(300);
    const undone = await page.evaluate(() => {
      const raw = localStorage.getItem("classflow-storage-v2") ?? "";
      return (JSON.parse(raw).state.studyBlocks ?? []).length;
    });
    expect(undone).toBe(0);
  });

  test("救援：Kiro 学习块与考试冲突 → 调整 → 撤销", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.evaluate(() => {
      const raw = localStorage.getItem("classflow-storage-v2");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const state = parsed.state;
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const ddl = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3);
      const task = {
        id: "a-rescue",
        courseId: state.courses?.[0]?.id ?? "c1",
        title: "救援任务",
        description: "",
        priority: "high",
        status: "todo",
        progress: 0,
        tags: [],
        estimatedMinutes: 120,
        ddl: `${key(ddl)}T23:59:00`,
      };
      state.schedules = [];
      state.assignments = [task];
      state.studyBlocks = [
        {
          id: "sb-rescue",
          title: "救援学习块",
          date: key(tomorrow),
          startTime: "19:00",
          endTime: "20:00",
          assignmentId: task.id,
          courseId: task.courseId,
          source: "kiro",
        },
      ];
      state.calendarMarks = [
        {
          id: "cm-rescue",
          date: key(tomorrow),
          type: "exam",
          title: "模拟考试",
          startTime: "19:00",
          endTime: "20:00",
        },
      ];
      state.preferences = { ...(state.preferences ?? {}), timetableMode: "plan" };
      localStorage.setItem("classflow-storage-v2", JSON.stringify(parsed));
    });
    await page.reload();
    await page.getByRole("button", { name: "时间表", exact: true }).click();
    await page.waitForTimeout(650);

    const before = await page.evaluate(() => {
      const raw = localStorage.getItem("classflow-storage-v2") ?? "";
      const block = (JSON.parse(raw).state.studyBlocks ?? []).find(
        (item: { id: string }) => item.id === "sb-rescue"
      );
      return block ? `${block.date}T${block.startTime}` : null;
    });
    expect(before).not.toBeNull();

    await page.getByRole("button", { name: "自动规划" }).click();
    await page.getByRole("menuitem", { name: "救援调整" }).click();
    const panel = page.getByTestId("plan-proposal-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("救援学习块")).toBeVisible();
    await panel.getByRole("button", { name: "应用调整" }).click();
    const approve = page.getByRole("button", { name: "仍然调整" });
    if (await approve.isVisible().catch(() => false)) await approve.click();
    await expect(page.getByText(/已调整 1 个学习时段/).first()).toBeVisible();

    const after = await page.evaluate(() => {
      const raw = localStorage.getItem("classflow-storage-v2") ?? "";
      const block = (JSON.parse(raw).state.studyBlocks ?? []).find(
        (item: { id: string }) => item.id === "sb-rescue"
      );
      return block ? `${block.date}T${block.startTime}` : null;
    });
    expect(after).not.toBe(before);

    await page.getByRole("button", { name: "撤销" }).first().click();
    await page.waitForTimeout(300);
    const undone = await page.evaluate(() => {
      const raw = localStorage.getItem("classflow-storage-v2") ?? "";
      const block = (JSON.parse(raw).state.studyBlocks ?? []).find(
        (item: { id: string }) => item.id === "sb-rescue"
      );
      return block ? `${block.date}T${block.startTime}` : null;
    });
    expect(undone).toBe(before);
  });

  test("Plan Tasks：时间轴 / 任务视图切换，无双 WorkspaceHeader", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openPlan(page);

    await page.getByRole("button", { name: "切换到任务" }).click();
    await expect(page.getByTestId("assignments-tab")).toBeVisible();
    await expect(page.getByTestId("plan-surface")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "任务与 DDL", level: 1 })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "更多视图" })).toBeVisible();

    await page.getByRole("button", { name: "切换到时间轴" }).click();
    await expect(page.getByTestId("plan-surface")).toBeVisible();
    await expect(page.getByTestId("assignments-tab")).toHaveCount(0);
  });

  test("1920：Backlog / Canvas / Inspector 三列同时存在", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openPlan(page);

    await expect(page.getByTestId("plan-backlog")).toBeVisible();
    await expect(page.getByTestId("plan-canvas")).toBeVisible();
    await expect(page.getByTestId("plan-inspector")).toBeVisible();
    await expect(page.getByText("选择一个任务或时间块")).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});
