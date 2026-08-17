import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/** 打开课程 Drawer 并上传一个资料 */
async function openCourseAndUpload(page: Page, fileName: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "课程资料" }).first().click();
  await page.getByRole("button", { name: "微观经济学", exact: true }).click();
  const input = page.locator("#real-material-upload");
  await input.setInputFiles({
    name: fileName,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 fake classflow e2e pdf"),
  });
  await expect(page.getByText(fileName)).toBeVisible();
}

/** 删除指定资料的所在行（.last() 取最深匹配行，避免命中外层容器） */
async function deleteMaterialRow(page: Page, fileName: string) {
  const row = page
    .locator("div", { hasText: fileName })
    .filter({ has: page.getByTitle("删除此资料") })
    .last();
  await row.hover();
  await row.getByTitle("删除此资料").click();
}

test("删除资料 → 撤销 → 刷新后仍可预览", async ({ page }) => {
  await openCourseAndUpload(page, "E2E测试讲义.pdf");

  await deleteMaterialRow(page, "E2E测试讲义.pdf");

  // Toast：资料已删除 + 撤销
  await expect(page.getByText("资料已删除").first()).toBeVisible();
  await page.getByRole("button", { name: "撤销" }).click();

  // 撤销后资料仍在
  await expect(page.getByText("E2E测试讲义.pdf")).toBeVisible();

  // 刷新浏览器，数据仍持久化
  await page.reload();
  await page.getByRole("button", { name: "课程资料" }).first().click();
  await page.getByRole("button", { name: "微观经济学", exact: true }).click();
  await expect(page.getByText("E2E测试讲义.pdf")).toBeVisible();

  // 再次打开预览（IndexedDB Blob 仍存在）：文件预览弹窗内嵌 PDF iframe
  await page.getByText("E2E测试讲义.pdf").click();
  await expect(page.locator("iframe").first()).toBeVisible();
});

test("删除资料不撤销 → Toast 到期后 Blob 被真正清理", async ({ page }) => {
  await openCourseAndUpload(page, "E2E待清理.pdf");

  await deleteMaterialRow(page, "E2E待清理.pdf");
  await expect(page.getByText("资料已删除").first()).toBeVisible();

  // 等待 Toast 自动到期（action toast 6s + 退出 200ms）
  await page.waitForTimeout(7500);

  // 列表已移除
  await expect(page.getByText("E2E待清理.pdf")).toHaveCount(0);

  // IndexedDB 中该 Blob 已被清理（演示资料均无 storageKey，因此应为 0）
  const blobKeys = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("classflow-files");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction("files", "readonly");
      const req = tx.objectStore("files").getAllKeys();
      req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
      req.onerror = () => reject(req.error);
    });
  });
  expect(blobKeys.length).toBe(0);

  // 刷新后资料不再出现
  await page.reload();
  await page.getByRole("button", { name: "课程资料" }).first().click();
  await page.getByRole("button", { name: "微观经济学", exact: true }).click();
  await expect(page.getByText("E2E待清理.pdf")).toHaveCount(0);
});
