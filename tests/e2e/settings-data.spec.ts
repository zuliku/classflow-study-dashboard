import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";
import JSZip from "jszip";

/**
 * Data & Storage 核心流程 E2E：
 * 1) 选择备份 → Preview → 取消 → 当前数据完全不变
 * 2) 选择备份 → Preview → 恢复 → UI 更新 → reload 后保持
 * JSON 兼容性由 unit（backupRestore.test）覆盖；fatal blocked 由 unit 覆盖。
 */

function buildData(courseCount: number) {
  return {
    userProfile: { name: "恢复用户", avatarUrl: "", college: "c", grade: "g", studentId: "s", completedCredits: 0, totalCredits: 0 },
    semester: { id: "s2", name: "恢复学期", startDate: "2026-02-23", totalWeeks: 16 },
    courses: Array.from({ length: courseCount }, (_, i) => ({
      id: `c_r${i}`, name: `恢复课程${i}`, code: `R-0${i}`, teacher: "t", classroom: "r", credit: 2,
      bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [],
    })),
    schedules: [{ id: "s_r", courseId: "c_r0", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "r", weeks: "1-16周" }],
    assignments: [{ id: "a_r", courseId: "c_r0", title: "恢复任务", description: "", ddl: "2026-09-01T23:59:00", priority: "medium", status: "todo", progress: 0, tags: [] }],
    calendarMarks: [{ id: "cm_r", date: "2026-09-01", type: "ddl", title: "恢复任务", sourceId: "a_r" }],
    groupProjects: [],
  };
}

async function makeZipFile(courseCount: number): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "data.json",
    JSON.stringify({ version: 1, exportedAt: "2026-08-08T00:00:00.000Z", data: buildData(courseCount) })
  );
  return Buffer.from(await zip.generateAsync({ type: "arraybuffer" }));
}

async function openDataSettings(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("navigation", { name: "设置导航" }).getByRole("button", { name: "数据与隐私" }).click();
  await expect(page.getByTestId("settings-data")).toBeVisible();
}

test("选择备份 → Preview 出现 → 取消 → 当前数据完全不变", async ({ page }) => {
  await openDataSettings(page);
  
  await page.locator("#restore-file-input").setInputFiles({
    name: "classflow_full_backup_2026-08-08.zip",
    mimeType: "application/zip",
    buffer: await makeZipFile(2),
  });

  // Preview 出现（文件名为标题）
  const preview = page.getByTestId("restore-preview");
  await expect(preview).toBeVisible();
  await expect(preview.getByText("恢复备份")).toBeVisible();
  await expect(preview.getByText("2", { exact: true }).first()).toBeVisible();

  // 取消 → 无任何数据变化（演示课程仍为 6 门）
  await preview.getByRole("button", { name: "取消" }).click();
  await expect(preview).toHaveCount(0);
  await expect(page.getByTestId("overview-课程")).toContainText("6");
});

test("选择备份 → 恢复 → UI 数据更新 → reload 后保持", async ({ page }) => {
  await openDataSettings(page);
  // 当前为演示数据 6 门课程
  await expect(page.getByTestId("overview-课程")).toContainText("6");

  await page.locator("#restore-file-input").setInputFiles({
    name: "backup.zip",
    mimeType: "application/zip",
    buffer: await makeZipFile(2),
  });

  const preview = page.getByTestId("restore-preview");
  await expect(preview).toBeVisible();
  await preview.getByTestId("confirm-restore").click();

  // 结果反馈 + toast
  await expect(page.getByTestId("restore-result")).toBeVisible();
  await expect(page.getByTestId("restore-result")).toContainText("恢复完成");
  await expect(page.getByText("备份已恢复").first()).toBeVisible();
  await expect(page.getByTestId("restore-result")).toContainText("2 门课程");
  // 本地数据概览：课程数变为 2
  await expect(page.getByTestId("overview-课程")).toContainText("2");

  // reload 后保持
  await page.reload();
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("navigation", { name: "设置导航" }).getByRole("button", { name: "数据与隐私" }).click();
  await expect(page.getByTestId("overview-课程")).toContainText("2");
});
