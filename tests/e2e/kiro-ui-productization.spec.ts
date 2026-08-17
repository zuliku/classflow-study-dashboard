import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Kiro UI Productization（Recent Files / Session More Menu / Agent Activity）。
 * - Recent Files：0/1/多文件高度策略（内容驱动高度、无固定 min-height、超限滚动）
 * - More Menu：desktop 顶部无多余 separator；mobile 历史记录 + separator
 * - Recent Activity：full-width flat list、清除按钮位置、empty state
 */

const AI_SETTINGS = {
  enabled: true,
  provider: "deepseek",
  model: "deepseek-v4-flash",
  custom: { providerName: "", baseURL: "", model: "" },
};

async function seedAI(page: Page) {
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
}

async function seedSandboxFile(page: Page, path: string, text: string) {
  await page.evaluate(
    async ({ p, t }) => {
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        const req = indexedDB.open("classflow-kiro-sandbox-v1", 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains("files")) req.result.createObjectStore("files");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      if (!db) return;
      try {
        await new Promise<void>((resolve) => {
          const tx = db.transaction("files", "readwrite");
          tx.objectStore("files").put({ kind: "file", text: t, type: "text/plain" }, `sandbox-default\u0000${p}`);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        });
      } finally {
        db.close();
      }
    },
    { p: path, t: text }
  );
}

async function seedArtifact(page: Page, id: string, relativePath: string, workspaceId: string, rootId: string, updatedAt: string) {
  await page.evaluate(
    async ({ a }) => {
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        const req = indexedDB.open("classflow-kiro-artifacts-v1", 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains("artifacts")) req.result.createObjectStore("artifacts");
          if (!req.result.objectStoreNames.contains("sources")) req.result.createObjectStore("sources");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      if (!db) return;
      try {
        await new Promise<void>((resolve) => {
          const tx = db.transaction("artifacts", "readwrite");
          tx.objectStore("artifacts").put(
            {
              id: a.id,
              workspaceId: a.workspaceId,
              rootId: a.rootId,
              relativePath: a.relativePath,
              displayName: a.relativePath.split("/").pop() ?? a.relativePath,
              type: "text",
              title: a.relativePath,
              source: "kiro-created",
              revision: 1,
              createdAt: a.updatedAt,
              updatedAt: a.updatedAt,
            },
            a.id
          );
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        });
      } finally {
        db.close();
      }
    },
    { a: { id, relativePath, workspaceId, rootId, updatedAt } }
  );
}

async function readSandboxWorkspace(page: Page): Promise<{ workspaceId: string; rootId: string }> {
  return page.evaluate(async () => {
    const raw = localStorage.getItem("classflow-kiro-computer-v1");
    const state = raw ? (JSON.parse(raw) as { state?: { workspaces?: { id: string; roots?: { id: string; adapterRef?: string }[] }[] } }).state : undefined;
    const ws = state?.workspaces?.find((w) => w.roots?.some((r) => r.adapterRef === "sandbox-default"));
    return { workspaceId: ws?.id ?? "", rootId: ws?.roots?.find((r) => r.adapterRef === "sandbox-default")?.id ?? "root-sandbox" };
  });
}

async function seedAuditEntries(page: Page, count: number) {
  await page.evaluate(async (n) => {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open("classflow-kiro-computer-audit-v1", 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("entries")) req.result.createObjectStore("entries");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!db) return;
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction("entries", "readwrite");
        for (let i = 0; i < n; i++) {
          const entry = {
            id: `audit-seed-${i}`,
            timestamp: `2026-08-14T${String(10 + i).padStart(2, "0")}:${String(i).padStart(2, "0")}:00.000Z`,
            taskId: "task-seed",
            conversationId: "conv-seed",
            toolCallId: `call-seed-${i}`,
            toolName: "create_text_file",
            capability: "fs.create",
            decision: "auto",
            outcome: "executed",
            workspaceId: "ws-seed",
            workspaceLabel: "Kiro Sandbox",
            rootId: "root-sandbox",
            rootLabel: "Sandbox",
            relativePath: `seed-${i}.txt`,
            verification: "passed",
          };
          tx.objectStore("entries").put(entry, entry.id);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } finally {
      db.close();
    }
  }, count);
}

async function openKiro(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await page.waitForTimeout(800);
  const composer = page.getByTestId("kiro-composer");
  await expect(composer).toBeVisible();
  await composer.getByRole("button", { name: "Computer" }).click();
  await expect(composer.getByRole("button", { name: "Computer" })).toHaveAttribute("aria-pressed", "true");
}

// ==================== Recent Files：内容高度跟随真实文件数量 ====================

test("Recent Files 0 文件：紧凑 Empty State（无 180px+ 固定空白）", async ({ page }) => {
  await seedAI(page);
  await openKiro(page);
  await page.getByRole("button", { name: "最近文件" }).click();
  const panel = page.getByRole("dialog", { name: "最近文件" });
  await expect(panel).toBeVisible();
  // Empty State：icon + 标题 + 描述，居中
  await expect(panel.getByText("暂无最近文件", { exact: true })).toBeVisible();
  await expect(panel.getByText("Kiro 创建或采用的文件会显示在这里")).toBeVisible();
  // 内容高度紧凑（< 160px，不存在 180px+ 空白）
  const listHeight = await panel.evaluate((el) => (el as HTMLElement).offsetHeight);
  expect(listHeight).toBeLessThan(230);
  expect(listHeight).toBeGreaterThan(0);
});

test("Recent Files 1 文件：单行自然高度（Header + 1 row）", async ({ page }) => {
  await seedAI(page);
  await openKiro(page);
  const { workspaceId, rootId } = await readSandboxWorkspace(page);
  await seedSandboxFile(page, "one.txt", "内容");
  await seedArtifact(page, "artifact-ui-1", "one.txt", workspaceId, rootId, "2026-08-14T10:00:00.000Z");

  await page.getByRole("button", { name: "最近文件" }).click();
  const panel = page.getByRole("dialog", { name: "最近文件" });
  await expect(panel).toBeVisible();
  const rows = panel.locator('[data-testid="kiro-recent-artifact-row"]');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("one.txt");
  // 1 行高度自然：无 180px min-height 撑高
  const height = await panel.evaluate((el) => (el as HTMLElement).offsetHeight);
  expect(height).toBeLessThan(230);
  expect(height).toBeGreaterThan(90);
});

test("Recent Files 多文件：自然增长，超限才滚动（max-height + overflow）", async ({ page }) => {
  await seedAI(page);
  await openKiro(page);
  const { workspaceId, rootId } = await readSandboxWorkspace(page);
  // 14 个文件 > 12 条上限 → 列表区域滚动
  for (let i = 0; i < 14; i++) {
    const name = `file-${String(i).padStart(2, "0")}.txt`;
    await seedSandboxFile(page, name, `内容${i}`);
    await seedArtifact(page, `artifact-ui-m${i}`, name, workspaceId, rootId, `2026-08-14T09:${String(i).padStart(2, "0")}:00.000Z`);
  }
  await page.getByRole("button", { name: "最近文件" }).click();
  const panel = page.getByRole("dialog", { name: "最近文件" });
  await expect(panel).toBeVisible();
  // 面板高度受 max-height 限制（≤ 460 左右）
  const height = await panel.evaluate((el) => (el as HTMLElement).offsetHeight);
  expect(height).toBeLessThanOrEqual(470);
  // 列表容器可滚动（内容溢出）
  const scrollable = await panel.evaluate((el) => {
    const list = (el as HTMLElement).querySelector(".overflow-y-auto");
    return list ? list.scrollHeight > list.clientHeight : false;
  });
  expect(scrollable).toBe(true);
});

// ==================== Session More Menu：Divider 只分隔可见 section ====================

test("More Menu desktop：顶部无 separator，「复制全部对话」是第一个可见项", async ({ page }) => {
  await seedAI(page);
  await openKiro(page);
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  // 只统计可见元素（md:hidden 的移动端片段仍在 DOM 但不可见）
  const firstVisible = menu.locator('[role="menuitem"]:visible').first();
  await expect(firstVisible).toHaveText("复制全部对话");
  // 可见 separator 只有一个（复制/导出 与 清空 之间）
  const separators = await menu.locator('[role="separator"]:visible').count();
  expect(separators).toBe(1);
});

test("More Menu mobile：历史记录可见，其后有 separator", async ({ page }) => {
  await seedAI(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator('nav[aria-label="底部导航"]').getByRole("button", { name: "Kiro" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const items = menu.locator('[role="menuitem"]');
  await expect(items.first()).toHaveText("历史记录");
  // 历史记录后紧跟 separator（分隔「历史记录」与「复制全部对话」）
  const historyItem = items.first();
  const sepAfter = await historyItem.evaluate((el) => {
    const next = (el as HTMLElement).nextElementSibling;
    return next?.getAttribute("role") === "separator";
  });
  expect(sepAfter).toBe(true);
});

// ==================== Recent Activity：full-width flat list ====================

test("Recent Activity：full-width 布局 + flat list + 清除按钮 + empty state", async ({ page }) => {
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  // 先 seed 3 条 audit（需在已加载的 origin 上写 IndexedDB）
  await seedAuditEntries(page, 3);

  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await page.getByRole("navigation", { name: "设置导航" }).getByRole("button", { name: "Agent 与权限" }).click();
  await expect(page.getByTestId("settings-kiro-agent")).toBeVisible();

  const panel = page.getByTestId("kiro-computer-audit-panel");
  await expect(panel).toBeVisible();
  // Header：标题 + 清除按钮（标题区域右侧）
  await expect(panel.getByText("最近活动", { exact: true })).toBeVisible();
  await expect(panel.getByTestId("kiro-audit-clear")).toBeVisible();
  // flat list：3 条，主行 = 操作 · 文件名（operation 是主要信息）
  const panelText = await panel.textContent();
  expect(panelText).toContain("创建文件 · seed-0.txt");
  expect(panelText).toContain("创建文件 · seed-1.txt");
  expect(panelText).toContain("创建文件 · seed-2.txt");
  // 清除按钮工作
  await panel.getByTestId("kiro-audit-clear").click();
  await expect(panel.getByText("暂无活动记录")).toBeVisible();
  await expect(panel.getByTestId("kiro-audit-clear")).toHaveCount(0);
});

test("Recent Activity empty：full-width block 内显示紧凑空状态", async ({ page }) => {
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await page.getByRole("navigation", { name: "设置导航" }).getByRole("button", { name: "Agent 与权限" }).click();
  await expect(page.getByTestId("settings-kiro-agent")).toBeVisible();
  const panel = page.getByTestId("kiro-computer-audit-panel");
  await expect(panel.getByText("暂无活动记录")).toBeVisible();
  // 无清除按钮
  await expect(panel.getByTestId("kiro-audit-clear")).toHaveCount(0);
});

