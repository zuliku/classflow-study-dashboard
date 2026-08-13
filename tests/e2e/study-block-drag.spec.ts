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
  const blockTitle = await block.getAttribute("title");
  expect(blockTitle).toContain("13:00");

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
  await page.mouse.up();
  await page.waitForTimeout(500);

  // 落库：block 移动到周五 18:00–19:00（offset 30min 保持 grab 位置）
  const moved = page.getByTestId("timeline-study-block").first();
  const movedTitle = await moved.getAttribute("title");
  expect(movedTitle).toContain("18:00");
  expect(movedTitle).toContain("19:00");

  // Undo：恢复周一 13:00–14:00
  await page.getByRole("button", { name: "撤销" }).first().click();
  await page.waitForTimeout(400);
  const restored = await page.getByTestId("timeline-study-block").first().getAttribute("title");
  expect(restored).toContain("13:00");
  expect(restored).toContain("14:00");
});

test("StudyBlock drag 冲突：拖到课程时段 → danger ghost + Store 不变", async ({ page }) => {
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
  // 目标 09:00（mockData 周一 08:00–09:40 有课 → 冲突）
  const targetY = dayBox.y + ((9 - 8) / 13) * dayBox.height;

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
