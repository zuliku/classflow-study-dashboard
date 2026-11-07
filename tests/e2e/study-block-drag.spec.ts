import { expect } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * IM5A：StudyBlock 直接拖动（Move only）。
 * seed 内置一个周一 10:00–11:00 学习计划 → 拖到周三 14:00 附近 → date/time 更新 → Undo 恢复。
 */

test("StudyBlock drag：周一 13:00 → 周五 18:00–19:00；Undo 恢复", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  // demoFixtures 无 studyBlocks：注入一个本周一 13:00–14:00 学习计划后 reload（避开 demo 课程时段）
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const dow = now.getDay() === 0 ? 7 : now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dow - 1));
  const mondayStr = `${monday.getFullYear()}-${pad2(monday.getMonth() + 1)}-${pad2(monday.getDate())}`;
  await page.evaluate((date) => {
    const raw = localStorage.getItem("classflow-storage-v2");
    if (!raw) return;
    const parsed = JSON.parse(raw);
    parsed.state.studyBlocks = [
      { id: "sb-e2e", title: "数据结构复习", date, startTime: "13:00", endTime: "14:00", source: "manual" },
    ];
    localStorage.setItem("classflow-storage-v2", JSON.stringify(parsed));
  }, mondayStr);
  await page.reload();
  await page.waitForTimeout(800);

  await page.locator("aside").first().getByRole("button", { name: "时间表" }).first().click();
  await page.waitForTimeout(800);

  const block = page.getByTestId("timeline-study-block").first();
  await expect(block).toBeVisible();
  expect(await block.getAttribute("data-start-time")).toBe("13:00");

  // 目标：周五（day 5）18:30 位置（mockData 周五 16:00–17:40 有课；offset 30min → 18:00–19:00 空闲）
  const day5 = page.locator('[data-timetable-day="5"]').first();
  const dayBox = await day5.boundingBox();
  const bBox = await block.boundingBox();
  if (!dayBox || !bBox) throw new Error("timeline geometry unavailable");
  // 08:00 顶、21:00 底（13 小时跨度）
  const targetY = dayBox.y + ((18.5 - 8) / 13) * dayBox.height;

  // pointerdown（块中心）→ 移动 >5px → pointerup（直接操作需要 fine pointer：playwright 默认 fine）
  await page.mouse.move(bBox.x + bBox.width / 2, bBox.y + bBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(dayBox.x + dayBox.width / 2, targetY, { steps: 6 });
  // 拖动中 ghost 出现（candidate 几何）
  await expect(page.getByTestId("study-block-ghost")).toBeVisible();

  // dragActive 生命周期契约：真实 dragging 后为 "1"；连续移动 + re-render 后仍为 "1"；结束后清理
  const dragActive = () => page.evaluate(() => document.body.dataset.dragActive ?? "");
  expect(await dragActive()).toBe("1");
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(dayBox.x + dayBox.width / 2, targetY - (i + 1) * 20, { steps: 2 });
    await page.waitForTimeout(50);
    expect(await dragActive()).toBe("1");
  }
  // 移回原目标再 drop
  await page.mouse.move(dayBox.x + dayBox.width / 2, targetY, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await dragActive()).not.toBe("1");
  await page.waitForTimeout(500);

  // 落库：block 移动到周五 18:00–19:00（offset 30min 保持 grab 位置）
  const moved = page.getByTestId("timeline-study-block").first();
  expect(await moved.getAttribute("data-start-time")).toBe("18:00");
  expect(await moved.getAttribute("data-end-time")).toBe("19:00");

  // Undo：恢复周一 13:00–14:00
  await page.getByRole("button", { name: "撤销" }).first().click();
  await page.waitForTimeout(400);
  const restored = page.getByTestId("timeline-study-block").first();
  expect(await restored.getAttribute("data-start-time")).toBe("13:00");
  expect(await restored.getAttribute("data-end-time")).toBe("14:00");
});

test("StudyBlock drag 冲突：拖到另一学习计划 → danger ghost + Store 不变", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const dow = now.getDay() === 0 ? 7 : now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dow - 1));
  const mondayStr = `${monday.getFullYear()}-${pad2(monday.getMonth() + 1)}-${pad2(monday.getDate())}`;
  await page.evaluate((date) => {
    const raw = localStorage.getItem("classflow-storage-v2");
    if (!raw) return;
    const parsed = JSON.parse(raw);
    parsed.state.studyBlocks = [
      { id: "sb-e2e-2", title: "数据结构复习", date, startTime: "13:00", endTime: "14:00", source: "manual" },
      { id: "sb-e2e-3", title: "占位学习计划", date, startTime: "09:00", endTime: "10:00", source: "manual" },
    ];
    localStorage.setItem("classflow-storage-v2", JSON.stringify(parsed));
  }, mondayStr);
  await page.reload();
  await page.waitForTimeout(800);

  await page.locator("aside").first().getByRole("button", { name: "时间表" }).first().click();
  await page.waitForTimeout(800);

  const block = page.locator('[data-testid="timeline-study-block"][data-start-time="13:00"]');
  const bBox = await block.boundingBox();
  const day1 = page.locator('[data-timetable-day="1"]').first();
  const dayBox = await day1.boundingBox();
  if (!bBox || !dayBox) throw new Error("timeline geometry unavailable");
  // 目标 09:30 指针（grab 中心偏移 30min → candidate 09:00–10:00，正压 sb-e2e-3 → 硬冲突）
  const targetY = dayBox.y + ((9.5 - 8) / 13) * dayBox.height;

  await page.mouse.move(bBox.x + bBox.width / 2, bBox.y + bBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(dayBox.x + dayBox.width / 2, targetY, { steps: 4 });
  await expect(page.getByTestId("study-block-ghost")).toBeVisible();
  const ghostClass = await page.getByTestId("study-block-ghost").getAttribute("class");
  expect(ghostClass).toContain("danger");
  await page.mouse.up();
  await page.waitForTimeout(400);

  // Store 不变；错误 toast 提示冲突
  const sb = await page.evaluate(() => {
    const raw = localStorage.getItem("classflow-storage-v2") ?? "";
    const b = JSON.parse(raw).state.studyBlocks.find((x: { id: string }) => x.id === "sb-e2e-2");
    return { startTime: b?.startTime, endTime: b?.endTime };
  });
  expect(sb?.startTime).toBe("13:00");
  expect(sb?.endTime).toBe("14:00");
  await expect(page.getByText(/时间冲突|重叠/).first()).toBeVisible();
});

test("StudyBlock drag 课程重叠是 soft：ghost 非 danger，落库并提示重叠", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const dow = now.getDay() === 0 ? 7 : now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dow - 1));
  const mondayStr = `${monday.getFullYear()}-${pad2(monday.getMonth() + 1)}-${pad2(monday.getDate())}`;
  await page.evaluate((date) => {
    const raw = localStorage.getItem("classflow-storage-v2");
    if (!raw) return;
    const parsed = JSON.parse(raw);
    parsed.state.studyBlocks = [
      { id: "sb-e2e-4", title: "数据结构复习", date, startTime: "13:00", endTime: "14:00", source: "manual" },
    ];
    localStorage.setItem("classflow-storage-v2", JSON.stringify(parsed));
  }, mondayStr);
  await page.reload();
  await page.waitForTimeout(800);

  await page.locator("aside").first().getByRole("button", { name: "时间表" }).first().click();
  await page.waitForTimeout(800);

  const block = page.getByTestId("timeline-study-block").first();
  const bBox = await block.boundingBox();
  const day1 = page.locator('[data-timetable-day="1"]').first();
  const dayBox = await day1.boundingBox();
  if (!bBox || !dayBox) throw new Error("timeline geometry unavailable");
  // 目标 10:30 指针（candidate 10:00–11:00，只压 mockData 周一 10:00–11:40 课程 → soft overlap，可落）
  const targetY = dayBox.y + ((10.5 - 8) / 13) * dayBox.height;

  await page.mouse.move(bBox.x + bBox.width / 2, bBox.y + bBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(dayBox.x + dayBox.width / 2, targetY, { steps: 4 });
  await expect(page.getByTestId("study-block-ghost")).toBeVisible();
  const ghostClass = await page.getByTestId("study-block-ghost").getAttribute("class");
  // soft overlap：非 danger（石色提示），允许落库
  expect(ghostClass).not.toContain("danger");
  expect(ghostClass).toContain("stone-beige");
  await page.mouse.up();
  await page.waitForTimeout(400);

  // 落库成功且 toast 带重叠后缀
  const sb = await page.evaluate(() => {
    const raw = localStorage.getItem("classflow-storage-v2") ?? "";
    const b = JSON.parse(raw).state.studyBlocks.find((x: { id: string }) => x.id === "sb-e2e-4");
    return { startTime: b?.startTime, endTime: b?.endTime };
  });
  expect(sb?.startTime).toBe("10:00");
  expect(sb?.endTime).toBe("11:00");
  await expect(page.getByText(/时间重叠/).first()).toBeVisible();
});

test("Unscheduled 任务拖入时间表：创建 1h StudyBlock（周五 18:00–19:00）；Undo 回到 Shelf", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const targetTitle = "计量经济学大作业（第3章）";
  // Task Model V2：unknown（有块但无估时）会留在待安排；这里给任务 60min 估时，
  // 让 1h 快速安排后进入 full，验证离开 Shelf → Undo 恢复。
  await page.evaluate((title) => {
    const raw = localStorage.getItem("classflow-storage-v2");
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const task = parsed.state.assignments.find((x: { title: string }) => x.title === title);
    if (task) task.estimatedMinutes = 60;
    localStorage.setItem("classflow-storage-v2", JSON.stringify(parsed));
  }, targetTitle);
  await page.reload();
  await page.locator("aside").first().getByRole("button", { name: "时间表" }).first().click();
  await page.waitForTimeout(800);

  // 找一个无 StudyBlock 的未完成任务（demo 数据均无 studyBlocks → 全部在 Shelf）
  const shelf = page.getByTestId("timeline-unscheduled");
  await expect(shelf).toBeVisible();
  const item = shelf.getByText(targetTitle).first().locator("..");
  await expect(item).toBeVisible();
  const itemBox = await item.boundingBox();
  if (!itemBox) throw new Error("shelf item unavailable");

  // 目标：周五（day 5）18:00（mockData 周五 16:00–17:40 有课；pointer = start → 18:00–19:00 空闲）
  const day5 = page.locator('[data-timetable-day="5"]').first();
  const dayBox = await day5.boundingBox();
  if (!dayBox) throw new Error("day geometry unavailable");
  const targetY = dayBox.y + ((18 - 8) / 13) * dayBox.height;

  await page.mouse.move(itemBox.x + itemBox.width / 2, itemBox.y + itemBox.height / 2);
  await page.mouse.down();
  // 拖动中 floating chip 跟随；进入 day5 后 ghost 出现
  await page.mouse.move(dayBox.x + dayBox.width / 2, targetY, { steps: 8 });
  await expect(page.getByTestId("unscheduled-drag-chip")).toBeVisible();
  await expect(page.getByTestId("unscheduled-ghost")).toBeVisible();
  await page.mouse.up();
  await page.waitForTimeout(500);

  // Store：新增 assignmentId=目标 + 周五 18:00–19:00
  const created = await page.evaluate((title) => {
    const raw = localStorage.getItem("classflow-storage-v2") ?? "";
    const state = JSON.parse(raw).state;
    const asgn = state.assignments.find((x: { title: string }) => x.title === title);
    const blocks = state.studyBlocks ?? [];
    const b = blocks.find((x: { assignmentId: string }) => x.assignmentId === asgn.id);
    return b ? { date: b.date, startTime: b.startTime, endTime: b.endTime } : null;
  }, targetTitle);
  expect(created).not.toBeNull();
  expect(created!.startTime).toBe("18:00");
  expect(created!.endTime).toBe("19:00");

  // Shelf：该任务不再出现
  await expect(page.getByTestId("timeline-unscheduled").getByText(targetTitle).first()).toHaveCount(0);

  // Undo：删除本次创建的 StudyBlock → 任务回到 Shelf
  await page.getByRole("button", { name: "撤销" }).first().click();
  await page.waitForTimeout(500);
  const after = await page.evaluate((title) => {
    const raw = localStorage.getItem("classflow-storage-v2") ?? "";
    const state = JSON.parse(raw).state;
    const asgn = state.assignments.find((x: { title: string }) => x.title === title);
    return (state.studyBlocks ?? []).some((x: { assignmentId: string }) => x.assignmentId === asgn.id);
  }, targetTitle);
  expect(after).toBe(false);
  await expect(page.getByTestId("timeline-unscheduled").getByText(targetTitle).first()).toBeVisible();
});
