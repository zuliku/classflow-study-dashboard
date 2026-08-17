import { expect, test } from "@playwright/test";

/**
 * Kiro Projects V1.3A.1 人工 Smoke（§21/§25）自动化：
 * 跨项目数据完整性 —— 删除 Project A 不得触碰 Project B 的文件/Blob。
 * 生产 First Run 状态（空工作区、空 Kiro DB），不依赖 demo 数据。
 *
 * 1. 建 Project A + 上传 a.md
 * 2. 建 Project B + 上传 b.md
 * 3. 删除 A（确认对话框）
 * 4. A 消失；B 仍在；B 的 b.md UI 仍显示
 * 5. 刷新浏览器：B 仍存在、b.md 仍显示（metadata 持久化）
 * 6. IndexedDB blob 层：classflow-files 只剩 1 个 Blob（b.md，内容 "BBB project B"）；
 *    a.md 的 Blob 已删；启动 reconcile 未误删 B
 */

const md = (text: string) => Buffer.from(text, "utf8");

async function openKiro(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await expect(page.getByTestId("kiro-workspace")).toBeVisible();
}

async function openProjectPanel(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "打开项目" }).click();
  await expect(page.getByTestId("kiro-project-panel")).toBeVisible();
  const panel = page.getByRole("dialog", { name: "项目" });
  await expect(panel).toBeVisible();
  return panel;
}

async function createProject(page: import("@playwright/test").Page, name: string) {
  const panel = page.getByRole("dialog", { name: "项目" });
  await panel.getByRole("button", { name: "新建项目" }).click();
  await panel.getByLabel("项目名称").fill(name);
  await panel.getByRole("button", { name: "保存" }).click();
  // 创建后自动进入 Detail 视图
  await expect(panel.getByText(name, { exact: true }).first()).toBeVisible();
}

async function uploadFile(page: import("@playwright/test").Page, name: string, content: string) {
  const panel = page.getByRole("dialog", { name: "项目" });
  await panel.getByLabel("上传项目资料").setInputFiles({
    name,
    mimeType: "text/markdown",
    buffer: md(content),
  });
  await expect(panel.getByText(name, { exact: true })).toBeVisible();
  await expect(panel.getByText("项目资料 · 1")).toBeVisible();
}

async function fileBlobTexts(page: import("@playwright/test").Page): Promise<Record<string, string>> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("classflow-files", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction("files", "readonly");
    const store = tx.objectStore("files");
    const keys = await new Promise<string[]>((resolve, reject) => {
      const r = store.getAllKeys();
      r.onsuccess = () => resolve(r.result as unknown as string[]);
      r.onerror = () => reject(r.error);
    });
    const blobs = await new Promise<Blob[]>((resolve, reject) => {
      const r = store.getAll();
      r.onsuccess = () => resolve(r.result as Blob[]);
      r.onerror = () => reject(r.error);
    });
    db.close();
    const out: Record<string, string> = {};
    for (let i = 0; i < keys.length; i++) {
      out[keys[i]] = await blobs[i].text();
    }
    return out;
  });
}

test("跨项目删除：A 删除后 B 的文件 metadata + Blob 完整，刷新后仍可读", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openKiro(page);
  await openProjectPanel(page);

  // 1. Project A + a.md
  await createProject(page, "项目A");
  await uploadFile(page, "a.md", "AAA project A");

  // 2. Project B + b.md
  await page.getByRole("button", { name: "返回项目列表" }).click();
  await createProject(page, "项目B");
  await uploadFile(page, "b.md", "BBB project B");

  // 3. 两个项目都在列表；各自 Detail 文件独立
  await page.getByRole("button", { name: "返回项目列表" }).click();
  await expect(page.getByRole("button", { name: "打开项目 项目A" })).toBeVisible();
  await expect(page.getByRole("button", { name: "打开项目 项目B" })).toBeVisible();

  // 4. 删除 A（确认对话框）
  await page.getByRole("button", { name: "删除项目 项目A" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("删除项目？");
  await confirm.getByTestId("confirm-dialog-confirm").click();
  await expect(confirm).toHaveCount(0);

  // 5. A 消失；B 仍在
  await expect(page.getByRole("button", { name: "打开项目 项目A" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "打开项目 项目B" })).toBeVisible();

  // 6. 打开 B：b.md 仍显示（metadata 保留）
  await page.getByRole("button", { name: "打开项目 项目B" }).click();
  await expect(page.getByText("b.md", { exact: true })).toBeVisible();
  await expect(page.getByText("a.md", { exact: true })).toHaveCount(0);

  // 7. 刷新浏览器：B 仍存在，b.md 仍显示
  await page.reload();
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await expect(page.getByTestId("kiro-workspace")).toBeVisible();
  await openProjectPanel(page);
  await expect(page.getByRole("button", { name: "打开项目 项目B" })).toBeVisible();
  await expect(page.getByRole("button", { name: "打开项目 项目A" })).toHaveCount(0);
  await page.getByRole("button", { name: "打开项目 项目B" }).click();
  await expect(page.getByText("b.md", { exact: true })).toBeVisible();

  // 8. Blob 完整性：只剩 b.md 的 Blob（a.md 已删）；启动 reconcile 未误删 B
  const blobs = await fileBlobTexts(page);
  expect(Object.keys(blobs)).toHaveLength(1);
  expect(Object.values(blobs)[0]).toBe("BBB project B");
});
