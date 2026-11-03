import { expect } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Group 宽屏 Kiro Dock：
 * - 2xl+：Header「问 Kiro」变为项目内嵌 Dock（打开/收起、切换项目同步上下文），不再弹浮动 Sidecar；
 * - <2xl：保持既有 Sidecar 行为；
 * - Dock 与 Sidecar 共用同一 Kiro Session，但同一时间只呈现一个聊天面。
 */

const PROJECTS = [
  {
    id: "gp-dock-1",
    courseId: "c_1",
    title: "校园导航系统课程设计",
    description: "基于图的建模实现校园最短路径查询。",
    progress: 50,
    updatedAt: "2026-10-01",
    members: [{ id: "gm-dock-1", name: "林晓阳", role: "leader", major: "计算机科学与技术" }],
    tasks: [
      { id: "gt-dock-1", title: "需求分析与图建模", assigneeId: "gm-dock-1", ddl: "2026-10-13T23:59:00", completed: true },
      { id: "gt-dock-2", title: "Dijkstra 算法实现", assigneeId: "gm-dock-1", ddl: "2026-10-27T23:59:00", completed: false },
    ],
  },
  {
    id: "gp-dock-2",
    courseId: "c_1",
    title: "Kaggle 房价预测组队赛",
    description: "特征工程与模型融合。",
    progress: 33,
    updatedAt: "2026-10-02",
    members: [],
    tasks: [
      { id: "gt-dock-3", title: "基线模型", assigneeId: undefined, ddl: "2026-11-09T23:59:00", completed: true },
    ],
  },
];

async function seedProjects(page: import("@playwright/test").Page) {
  await page.addInitScript(({ projects }) => {
    const raw = localStorage.getItem("classflow-storage-v2");
    if (!raw) return;
    const parsed = JSON.parse(raw);
    parsed.state.groupProjects = projects;
    parsed.state.selectedGroupProjectId = null;
    localStorage.setItem("classflow-storage-v2", JSON.stringify(parsed));
  }, { projects: PROJECTS });
}

async function openGroup(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "小组协作" }).first().click();
  await expect(page.getByRole("heading", { name: "小组协作" })).toBeVisible();
}

test("Group：2xl「问 Kiro」打开项目 Dock；切换项目更新上下文；再点收起", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await seedProjects(page);
  await openGroup(page);

  const panel = page.getByTestId("group-kiro-panel");
  const toggle = page.getByRole("button", { name: "问 Kiro" });
  await expect(panel).toHaveCount(0);

  await toggle.click();
  await expect(panel).toBeVisible();
  await expect(panel.getByText("项目 Kiro")).toBeVisible();
  await expect(panel.getByText("校园导航系统课程设计", { exact: true })).toBeVisible();
  await expect(panel.getByLabel("Ask Kiro")).toBeVisible();
  // 项目上下文已附加（entry context chip）
  await expect(panel.getByText(/小组项目 · 校园导航系统课程设计/)).toBeVisible({ timeout: 10000 });
  // 不弹浮动 Sidecar（同一会话单面）
  await expect(page.getByTestId("kiro-sidecar")).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  // 切换项目：Dock 标题与项目上下文跟随
  await page.getByRole("button", { name: /Kaggle 房价预测组队赛/ }).first().click();
  await expect(panel.getByText("Kaggle 房价预测组队赛", { exact: true })).toBeVisible();
  await expect(panel.getByText(/小组项目 · Kaggle 房价预测组队赛/)).toBeVisible({ timeout: 10000 });

  // 面板内收起
  await panel.getByRole("button", { name: "收起 Kiro" }).click();
  await expect(panel).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  // Header 快捷键再次打开 / 收起
  await toggle.click();
  await expect(panel).toBeVisible();
  await toggle.click();
  await expect(panel).toHaveCount(0);
});

test("Group：<2xl 保持浮动 Sidecar，不渲染 Dock", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedProjects(page);
  await openGroup(page);

  await page.getByRole("button", { name: "问 Kiro" }).click();
  await expect(page.getByTestId("kiro-sidecar")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("group-kiro-panel")).toHaveCount(0);
});

