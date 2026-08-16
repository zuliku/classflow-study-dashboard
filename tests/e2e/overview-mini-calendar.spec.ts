import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Layout Hotfix：MiniCalendar 自适应 Agenda（container-height 判断 + weekRows + hysteresis）。
 * 场景：
 * 1. Tall 容器 → Agenda visible
 * 2. Short 容器 → Agenda hidden
 * 3. Short → Tall → hidden → visible
 * 4. Tall → Short → visible → hidden
 * 5. Agenda hidden 时 calendar grid 高度 > visible 时（补位核心）
 * D1: 同一 row 日期格等高；不同 row ≤1px
 * D2: 5/6-row 月份 decision 正确（rows-aware budget）
 * D3: 无内部纵向 overflow（scrollHeight <= clientHeight + 1）
 * D4: Selection Indicator bbox ≈ 选中日期格 bbox
 */

/** 当前月份日历网格行数（Monday-first；与 MiniCalendar 同一计算） */
function gridWeekRows(year: number, month0: number): number {
  const first = new Date(year, month0, 1);
  const last = new Date(year, month0 + 1, 0);
  const mondayShift = (first.getDay() + 6) % 7;
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - mondayShift);
  const sundayShift = (7 - last.getDay()) % 7;
  const gridEnd = new Date(last);
  gridEnd.setDate(last.getDate() + sundayShift);
  return Math.round((gridEnd.getTime() - gridStart.getTime()) / 86400000 + 1) / 7;
}

function findRowPair() {
  const now = new Date();
  let five = -1;
  let six = -1;
  for (let off = -12; off <= 12; off++) {
    const d = new Date(now.getFullYear(), now.getMonth() + off, 1);
    const rows = gridWeekRows(d.getFullYear(), d.getMonth());
    if (rows === 5 && five === -1) five = off;
    if (rows === 6 && six === -1) six = off;
    if (five !== -1 && six !== -1) break;
  }
  return { five, six };
}

/** 相对当前月份点击 n 个月（n>0 下一月 / n<0 上一月） */
async function shiftMonth(page: Page, n: number) {
  const btn = page.getByRole("button", { name: n > 0 ? "下一月" : "上一月" });
  for (let i = 0; i < Math.abs(n); i++) await btn.click();
}

async function openOverview(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("calendar-card")).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(600);
}

function agendaState(page: Page) {
  return page.getByTestId("calendar-card").getAttribute("data-agenda-visible");
}

test("Tall 容器：Agenda visible；Short 容器：Agenda hidden（同月）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOverview(page);
  await expect(page.getByTestId("calendar-agenda")).toBeVisible();
  expect(await agendaState(page)).toBe("1");

  await page.setViewportSize({ width: 1440, height: 700 });
  await expect(page.getByTestId("calendar-agenda")).toHaveCount(0);
  expect(await agendaState(page)).toBe("0");
});

test("Tall → Short → Tall：visible → hidden → visible（hysteresis 下稳定翻转）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOverview(page);
  await expect(page.getByTestId("calendar-agenda")).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 700 });
  await expect(page.getByTestId("calendar-agenda")).toHaveCount(0);
  expect(await agendaState(page)).toBe("0");

  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByTestId("calendar-agenda")).toBeVisible();
  expect(await agendaState(page)).toBe("1");
});

test("补位核心：Agenda hidden 时日期区吃掉释放空间", async ({ page }) => {
  // (a) Short 容器（agenda hidden）：日期区一直延伸到卡片底部（仅剩底部 padding）——
  //     释放的 Agenda 空间全部回流给日期区（无空洞、无 overflow）
  await page.setViewportSize({ width: 1440, height: 700 });
  await openOverview(page);
  await expect(page.getByTestId("calendar-agenda")).toHaveCount(0);
  const gapHidden = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="calendar-card"]')!;
    const area = document.querySelector('[data-testid="calendar-grid-area"]')!;
    return card.getBoundingClientRect().bottom - area.getBoundingClientRect().bottom;
  });
  expect(gapHidden).toBeLessThanOrEqual(18); // ≈ 底部 padding 16px + 舍入；日期区吃满

  // (c) 高容器 visible 时：日期区底部不得越过 Agenda 顶部（不重叠、不压盖）
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByTestId("calendar-agenda")).toBeVisible();
  const noOverlap = await page.evaluate(() => {
    const area = document.querySelector('[data-testid="calendar-grid-area"]')!.getBoundingClientRect();
    const agenda = document.querySelector('[data-testid="calendar-agenda"]')!.getBoundingClientRect();
    return area.bottom - agenda.top;
  });
  expect(noOverlap).toBeLessThanOrEqual(2);
});

test("D1：同一 row 日期格等高；不同 row 高度误差 ≤1px", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOverview(page);
  // 取第一行（grid 的每 7 个 cell 一行）
  const cells = await page.locator('[data-calendar-day]').all();
  const boxes = [];
  for (let i = 0; i < Math.min(14, cells.length); i++) {
    boxes.push((await cells[i].boundingBox())!.height);
  }
  // 同一 row（前 7 个）
  for (let i = 1; i < 7; i++) expect(Math.abs(boxes[i] - boxes[0])).toBeLessThanOrEqual(1);
  // 不同 row（第 8 个 vs 第 1 个）
  expect(Math.abs(boxes[7] - boxes[0])).toBeLessThanOrEqual(1);

  // Short 容器同样成立（补位后 1fr 均分，不是最后一行吃空间）
  await page.setViewportSize({ width: 1440, height: 700 });
  await expect(page.getByTestId("calendar-agenda")).toHaveCount(0);
  const shortBoxes = [];
  for (let i = 0; i < Math.min(14, cells.length); i++) {
    shortBoxes.push((await cells[i].boundingBox())!.height);
  }
  for (let i = 1; i < 7; i++) expect(Math.abs(shortBoxes[i] - shortBoxes[0])).toBeLessThanOrEqual(1);
  expect(Math.abs(shortBoxes[7] - shortBoxes[0])).toBeLessThanOrEqual(1);
});

test("D3：tall / short 均无内部纵向 overflow", async ({ page }) => {
  const check = async () => {
    const { sh, ch } = await page
      .getByTestId("calendar-card")
      .evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
    expect(sh).toBeLessThanOrEqual(ch + 1);
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOverview(page);
  await check();
  await page.setViewportSize({ width: 1440, height: 700 });
  await expect(page.getByTestId("calendar-agenda")).toHaveCount(0);
  await check();
});

test("D4：Selection Indicator bbox ≈ 选中日期格 bbox（动态高度下仍跟随）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOverview(page);
  // 选中「今天」所在格（默认选中今天）
  const todayStr = await page.evaluate(() => {
    const d = new Date();
    const pad2 = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  });
  const cell = page.locator(`[data-calendar-day="${todayStr}"]`);
  await cell.click();
  await page.waitForTimeout(400); // indicator 过渡 settle
  const cellBox = (await cell.boundingBox())!;
  const indicatorBox = (await page.getByTestId("calendar-selection-indicator").boundingBox())!;
  expect(Math.abs(indicatorBox.width - cellBox.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(indicatorBox.height - cellBox.height)).toBeLessThanOrEqual(2);
  expect(Math.abs(indicatorBox.x - cellBox.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(indicatorBox.y - cellBox.y)).toBeLessThanOrEqual(2);
});

test("D2：5/6-row 月份 decision 正确（rows-aware budget；切换后重新判断）", async ({ page }) => {
  const { five, six } = findRowPair();
  expect(five).not.toBe(-1);
  expect(six).not.toBe(-1);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOverview(page);
  const card = page.getByTestId("calendar-card");

  // 导航到 6-row 月份
  await shiftMonth(page, six);
  await page.waitForTimeout(400);
  expect(Number(await card.getAttribute("data-week-rows"))).toBe(6);
  const required6 = Number(await card.getAttribute("data-agenda-required"));
  expect(await agendaState(page)).toBe("1"); // tall 容器：6 行也放得下

  // 导航到 5-row 月份
  await shiftMonth(page, five - six);
  await page.waitForTimeout(400);
  expect(Number(await card.getAttribute("data-week-rows"))).toBe(5);
  const required5 = Number(await card.getAttribute("data-agenda-required"));
  // rows-aware：5 行 budget 比 6 行小（多一行 MIN_DATE_ROW_HEIGHT + gap）
  expect(required5).toBeLessThan(required6);
  expect(required6 - required5).toBe(26);
  expect(await agendaState(page)).toBe("1");

  // Short 容器：两种月份都放不下 Agenda → 均隐藏
  await page.setViewportSize({ width: 1440, height: 700 });
  await expect(page.getByTestId("calendar-agenda")).toHaveCount(0);
  // 从当前 5-row 月份导航到 6-row 月份（相对步数）
  await shiftMonth(page, six - five);
  await page.waitForTimeout(400);
  await expect(page.getByTestId("calendar-agenda")).toHaveCount(0);
  expect(Number(await card.getAttribute("data-week-rows"))).toBe(6);
  // 决策与预算一致（数据驱动断言，不依赖硬编码像素）：
  // visible ⟺ containerHeight >= required；hidden ⟹ containerHeight < required + hysteresis
  const heightNow = await card.evaluate((el) => el.clientHeight);
  if ((await agendaState(page)) === "1") {
    expect(heightNow).toBeGreaterThanOrEqual(required6);
  } else {
    expect(heightNow).toBeLessThan(required6 + 16);
  }
});
