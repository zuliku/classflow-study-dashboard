import { expect } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Kiro Mini（?mini=1）渲染在普通 Chromium 中通过 mock bridge 验证：
 * - 状态层 / Plan / 来源 / 低风险审批；
 * - 快捷 Prompt 直接发送；
 * - 胶囊态与展开态；
 * - 会话切换 / 打开主窗口命令。
 * 真实双窗口 IPC 由 main/preload contract 测试覆盖。
 */

const SNAPSHOT = {
  version: 2,
  conversationId: "c1",
  title: "计量经济学作业",
  messages: [
    { id: "m1", role: "user", text: "这周还有哪些 DDL？" },
    { id: "m2", role: "assistant", text: "我先查一下。", streaming: true },
  ],
  busy: true,
  streaming: true,
  phase: "working",
  status: { label: "正在搜索网络" },
  plan: {
    title: "准备计量经济学作业",
    completed: 1,
    total: 4,
    status: "approved",
    currentStep: "整理数据",
  },
  activity: { label: "搜索网络", done: 1, total: 2 },
  sources: [
    { id: "web-1", title: "课程公告", domain: "example.edu", url: "https://example.edu/notice" },
  ],
  approval: {
    pending: true,
    id: "approval-1",
    title: "Kiro 准备修改",
    primary: "report.docx",
    highRisk: false,
    canApproveInMini: true,
  },
  suggestions: ["今天要做什么", "这周还有什么 DDL", "总结当前对话"],
  conversations: [
    { id: "c1", title: "计量经济学作业", updatedAt: "2026-11-05T10:00:00.000Z" },
    { id: "c0", title: "上周复盘", updatedAt: "2026-11-04T10:00:00.000Z" },
  ],
  transitioning: false,
  attachments: [],
  configured: true,
  updatedAt: Date.now(),
};

const IDLE_SNAPSHOT = {
  ...SNAPSHOT,
  messages: [
    { id: "m1", role: "user", text: "这周还有哪些 DDL？" },
    { id: "m2", role: "assistant", text: "我先查一下。" },
  ],
  busy: false,
  streaming: false,
  phase: "idle",
  status: null,
  plan: null,
  activity: null,
  approval: null,
  updatedAt: Date.now(),
};

async function installMiniBridge(
  page: import("@playwright/test").Page,
  mode: "expanded" | "capsule",
  snapshot = SNAPSHOT
) {
  await page.addInitScript(
    ({ snapshot, mode }) => {
      const w = window as unknown as {
        classflowDesktop: unknown;
        __miniCalls: unknown[];
      };
      w.__miniCalls = [];
      const fsStub = {
        pickDirectory: async () => null,
        getGrantStatus: async () => ({ status: "unavailable" }),
        forgetGrant: async () => {},
        list: async () => [],
        stat: async () => null,
        readText: async () => "",
        readBytes: async () => new Uint8Array(),
        readTextPrefix: async () => "",
        createDirectory: async () => {},
        writeText: async () => {},
        writeBytes: async () => {},
        remove: async () => {},
        move: async () => {},
      };
      w.classflowDesktop = {
        version: 1,
        platform: "windows",
        filesystem: fsStub,
        mini: {
          show: () => {},
          hide: () => {},
          toggle: () => {},
          setAlwaysOnTop: () => {},
          isAlwaysOnTop: async () => ({ onTop: true }),
          setMode: (next: string) => w.__miniCalls.push({ type: "setMode", next }),
          getWindowState: async () => ({ mode, onTop: true }),
          sendRemote: async (payload: { requestId: string; text: string }) => {
            w.__miniCalls.push({ type: "sendRemote", text: payload.text });
            return { ok: true, requestId: payload.requestId };
          },
          stopRemote: () => {},
          newChat: () => w.__miniCalls.push({ type: "newChat" }),
          switchConversation: (id: string) => w.__miniCalls.push({ type: "switch", id }),
          focusMain: () => w.__miniCalls.push({ type: "focusMain" }),
          resolveApproval: (id: string, decision: string) =>
            w.__miniCalls.push({ type: "approval", id, decision }),
          publishState: () => {},
          getState: async () => snapshot,
          onState: () => () => {},
          onRemoteSend: () => () => {},
          completeRemoteSend: () => {},
          onRemoteStop: () => () => {},
          onRemoteNewChat: () => () => {},
          onRemoteSwitchConversation: () => () => {},
          onRemoteFocusConversation: () => () => {},
          onRemoteApproval: () => () => {},
        },
      };
    },
    { snapshot, mode }
  );
}

test("Kiro Mini V2：状态 / Plan / 低风险审批", async ({ page }) => {
  await installMiniBridge(page, "expanded");
  await page.setViewportSize({ width: 380, height: 640 });
  await page.goto("/?mini=1");

  await expect(page.getByTestId("kiro-mini-app")).toBeVisible();
  await expect(page.getByTestId("kiro-mini-header")).toContainText("计量经济学作业");
  await expect(page.getByTestId("kiro-mini-status")).toContainText("正在搜索网络");
  await expect(page.getByTestId("kiro-mini-plan")).toContainText("1/4");
  await expect(page.getByTestId("kiro-mini-plan")).toContainText("整理数据");
  await expect(page.getByTestId("kiro-mini-approval")).toContainText("Kiro 准备修改");
  await expect(page.getByTestId("kiro-mini-approval")).toContainText("允许一次");

  await page.getByRole("button", { name: "允许一次" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __miniCalls: { type: string; id?: string; decision?: string }[] }).__miniCalls)
    )
    .toContainEqual({ type: "approval", id: "approval-1", decision: "allow-once" });
});

test("Kiro Mini V2：快捷 Prompt 点击直接发送", async ({ page }) => {
  await installMiniBridge(page, "expanded", IDLE_SNAPSHOT);
  await page.setViewportSize({ width: 380, height: 640 });
  await page.goto("/?mini=1");
  await page.getByRole("button", { name: "今天要做什么" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __miniCalls: { type: string; text?: string }[] }).__miniCalls)
    )
    .toContainEqual({ type: "sendRemote", text: "今天要做什么" });
});

test("Kiro Mini V2：胶囊态", async ({ page }) => {
  await installMiniBridge(page, "capsule");
  await page.setViewportSize({ width: 72, height: 72 });
  await page.goto("/?mini=1");
  await expect(page.getByTestId("kiro-mini-capsule")).toBeVisible();
  await page.getByRole("button", { name: "展开 Kiro Mini" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __miniCalls: { type: string; next?: string }[] }).__miniCalls)
    )
    .toContainEqual({ type: "setMode", next: "expanded" });
});
