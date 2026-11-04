import { expect, test, type Page } from "@playwright/test";

/**
 * Kiro 输入框动效回归（E2E 几何门禁，人眼验收的替代）：
 * - 删除附件输入框零位移：surface 下方包裹常驻（空时零高度），删最后一颗 chip
 *   时 textarea 顶部位置纹丝不动（曾回归：mt-1.5 整块卸载导致下跳 6px）。
 * - 退出期间 tray 锁 overflow-x-clip：收缩内容不再触发横向滚动条闪烁。
 * - 帧兜底：收回全程无灾难性掉帧（阈值刻意宽松，只防死循环/长时间挂起；
 *   真实帧率以 MotionFpsProbe dev 工具为准，不在此断言避免 CI 抖动）。
 *
 * 不依赖演示数据/模型配置（附件是纯本地解析），用原生 @playwright/test。
 * 运行要求：本地 `npm run dev` 常驻（renderer http://localhost:5173）。
 */

async function openKiro(page: Page) {
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await expect(page.getByTestId("kiro-workspace")).toBeVisible();
  await expect(page.getByTestId("kiro-composer")).toBeVisible();
}

async function dropFiles(page: Page, files: { name: string; content: string }[]) {
  await page.evaluate((names) => {
    const el = document.querySelector('[data-testid="kiro-composer"]')!;
    const dt = new DataTransfer();
    for (const f of names) {
      dt.items.add(new File([f.content.repeat(30)], f.name, { type: "text/plain" }));
    }
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, files);
  await expect(page.getByTestId("kiro-attachment-chip")).toHaveCount(files.length);
}

async function textareaTop(page: Page): Promise<number> {
  const box = await page.getByLabel("Ask Kiro").boundingBox();
  return box?.y ?? -1;
}

/** 等 Composer 自身进场（kiro-composer-intro，220ms translateY 6px）播完再取基线——
 *  否则 before 采样落在 intro 位移中，会把进场残值误判成删除附件后的布局跳动。 */
async function waitForComposerSettled(page: Page) {
  await page.getByTestId("kiro-composer-surface").evaluate(async (el) => {
    await Promise.all(
      el.getAnimations().map((a) => a.finished.catch(() => undefined))
    );
  });
}

test("删除附件输入框零位移（mt-1.5 下跳回归）", async ({ page }) => {
  await openKiro(page);
  await dropFiles(page, [{ name: "a.txt", content: "hello world " }]);
  await waitForComposerSettled(page);

  const before = await textareaTop(page);
  expect(before).toBeGreaterThan(0);

  await page.click('[aria-label="移除附件 a.txt"]');
  // chip collapse（160ms）+ 附件架折叠（160ms）播完
  await expect(page.getByTestId("kiro-attachment-chip")).toHaveCount(0, { timeout: 5000 });

  const after = await textareaTop(page);
  // 输入框位置纹丝不动（>1px 即此前 mt-1.5 整块卸载的下跳回归）
  expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
});

test("退出期间 tray 锁 overflow-x-clip，播完恢复 auto", async ({ page }) => {
  await openKiro(page);
  await dropFiles(page, [
    { name: "a.txt", content: "alpha " },
    { name: "b.txt", content: "beta " },
    { name: "c.txt", content: "gamma " },
  ]);
  const tray = page.getByTestId("kiro-attachments");

  await page.click('[aria-label="移除附件 b.txt"]');
  // 退出窗口内（160ms）tray 切 clip，防滚动条闪烁
  await expect.poll(async () => tray.getAttribute("class"), { timeout: 2000 }).toContain("overflow-x-clip");
  // chip 卸载后恢复 auto（不影响后续横向滚动）
  await expect(page.getByTestId("kiro-attachment-chip")).toHaveCount(2, { timeout: 5000 });
  await expect.poll(async () => tray.getAttribute("class"), { timeout: 2000 }).toContain("overflow-x-auto");
});

test("附件架收缩单调无回弹（删最后一颗）", async ({ page }) => {
  await openKiro(page);
  await dropFiles(page, [{ name: "a.txt", content: "hello world " }]);
  // 先把输入框滚入视口并静置，排除 click 自动滚动对轨迹的污染；采样期间用 force 点击
  await page.getByTestId("kiro-composer-surface").scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);

  // 逐帧采样：surface top 只向下收（单调不减），textarea 全程不动
  await page.evaluate(() => {
    (window as unknown as { __traj: { surfTop: number; taTop: number }[] }).__traj = [];
    const tick = () => {
      const surf = document.querySelector('[data-testid="kiro-composer-surface"]');
      const ta = document.querySelector('[aria-label="Ask Kiro"]');
      const store = (window as unknown as { __traj: { surfTop: number; taTop: number }[] }).__traj;
      store.push({
        surfTop: surf ? Math.round(surf.getBoundingClientRect().top * 10) / 10 : -1,
        taTop: ta ? Math.round(ta.getBoundingClientRect().top * 10) / 10 : -1,
      });
      if (store.length < 90) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.click('[aria-label="移除附件 a.txt"]', { force: true });
  await expect(page.getByTestId("kiro-attachment-chip")).toHaveCount(0, { timeout: 5000 });
  await page.waitForTimeout(600);

  const traj = await page.evaluate(
    () => (window as unknown as { __traj: { surfTop: number; taTop: number }[] }).__traj
  );
  const surf = traj.map((p) => p.surfTop).filter((v) => v >= 0);
  const ta = traj.map((p) => p.taTop).filter((v) => v >= 0);
  // surface 只向下收：回弹（向上）容忍 1.5px 亚像素抖动；总行程证明折叠真实发生（非瞬卸）
  let backtrack = 0;
  for (let i = 1; i < surf.length; i++) backtrack = Math.max(backtrack, surf[i - 1] - surf[i]);
  expect(backtrack).toBeLessThanOrEqual(1.5);
  expect(surf[surf.length - 1] - surf[0]).toBeGreaterThan(20);
  expect(surf[surf.length - 1] - surf[0]).toBeLessThan(120);
  // textarea：单步下移 ≤2px 且首尾零位移
  let taDown = 0;
  for (let i = 1; i < ta.length; i++) taDown = Math.max(taDown, ta[i] - ta[i - 1]);
  expect(taDown).toBeLessThanOrEqual(2);
  expect(Math.abs(ta[ta.length - 1] - ta[0])).toBeLessThanOrEqual(1);
});

test("收回全程无灾难性掉帧（兜底）", async ({ page }) => {
  await openKiro(page);
  await dropFiles(page, [{ name: "a.txt", content: "hello world " }]);

  await page.evaluate(() => {
    (window as unknown as { __frames: number[] }).__frames = [];
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      (window as unknown as { __frames: number[] }).__frames.push(now - last);
      last = now;
      if ((window as unknown as { __frames: number[] }).__frames.length < 120) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.click('[aria-label="移除附件 a.txt"]');
  await expect(page.getByTestId("kiro-attachment-chip")).toHaveCount(0, { timeout: 5000 });

  const frames = await page.evaluate(
    () => (window as unknown as { __frames: number[] }).__frames as number[]
  );
  const max = Math.max(...frames);
  const over50 = frames.filter((f) => f > 50).length;
  // eslint-disable-next-line no-console
  console.log(`[motion-gate] frames=${frames.length} max=${Math.round(max)}ms over50ms=${over50}`);
  // 灾难兜底：只拦死循环/长时间挂起（真实帧率看 MotionFpsProbe）
  expect(max).toBeLessThan(1000);
});
