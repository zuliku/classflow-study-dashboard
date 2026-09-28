// @vitest-environment jsdom
/**
 * Kiro Workspace Productization P1 — Unified Navigator 测试。
 *
 * 覆盖：collapsed/expanded 语义、lazy load（collapsed 不读 DB）、projectsVersion/historyVersion 刷新、
 * Thread 打开与 transition 守卫、Project Detail / Files lazy、项目 CRUD、统一搜索、
 * Runtime Status 呈现与 expanded/collapsed 解耦、Workspace 只挂载 Navigator（无右侧 Project Rail）。
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { KiroNavigator } from "@/components/kiro/navigation/KiroNavigator";
import { KiroSessionMetaContext, KiroSessionActionsContext } from "@/components/kiro/kiroSessionContext";
import type {
  KiroSessionActionsValue,
  KiroSessionMetaValue,
} from "@/components/kiro/KiroSessionProvider";
import type { KiroRuntimeStatus } from "@/lib/ai/ui/kiroRuntimeStatus";
import type { KiroConversationRecord } from "@/lib/ai/history/types";
import type { KiroProjectRecord } from "@/lib/ai/projects/types";
import type { KiroProjectFileRecord } from "@/lib/ai/projects/files/types";
import { useConfirmStore } from "@/store/useConfirmStore";

const dbSpies = vi.hoisted(() => ({
  listKiroProjects: vi.fn(),
  listProjectConversations: vi.fn(),
  listProjectFiles: vi.fn(),
  createProjectFile: vi.fn(),
  deleteProjectFile: vi.fn(),
  listConversations: vi.fn(),
}));

vi.mock("@/lib/ai/projects/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/projects/db")>();
  return {
    ...actual,
    listKiroProjects: dbSpies.listKiroProjects,
    listProjectConversations: dbSpies.listProjectConversations,
  };
});

vi.mock("@/lib/ai/history/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/history/db")>();
  return { ...actual, listConversations: dbSpies.listConversations };
});

vi.mock("@/lib/ai/projects/files/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/projects/files/db")>();
  return {
    ...actual,
    listProjectFiles: dbSpies.listProjectFiles,
    createProjectFile: dbSpies.createProjectFile,
    deleteProjectFile: dbSpies.deleteProjectFile,
  };
});

if (typeof window !== "undefined" && !window.matchMedia) {
  (window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

/* ---------------- fixtures ---------------- */

function project(id: string, name: string, over: Partial<KiroProjectRecord> = {}): KiroProjectRecord {
  return {
    id,
    name,
    description: `${name} 说明`,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-09T12:00:00.000Z",
    ...over,
  };
}

function conv(id: string, title: string, over: Partial<KiroConversationRecord> = {}): KiroConversationRecord {
  return {
    id,
    title,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-09T12:00:00.000Z",
    provider: "opencode-go",
    model: "kimi-k3",
    messages: [{ id: "u1", role: "user", content: "你好" }],
    manualRefs: [],
    entryRefs: [],
    ...over,
  };
}

function fileRecord(id: string, name: string): KiroProjectFileRecord {
  return {
    id,
    projectId: "p1",
    name,
    mimeType: "text/markdown",
    sizeBytes: 2048,
    kind: "text",
    storageKey: `sk-${id}`,
    createdAt: "2026-08-02T10:00:00.000Z",
  };
}

const metaState: {
  currentConversationId: string | null;
  conversationProjectId: string | null;
  projectsVersion: number;
  historyVersion: number;
  conversationTransitioning: boolean;
  transitionTarget: string | null;
  kiroRuntimeStatus: KiroRuntimeStatus;
  hasMessages: boolean;
} = {
  currentConversationId: null,
  conversationProjectId: null,
  projectsVersion: 0,
  historyVersion: 0,
  conversationTransitioning: false,
  transitionTarget: null,
  kiroRuntimeStatus: "idle",
  hasMessages: false,
};

const actionSpies = {
  newChat: vi.fn(),
  newChatInProject: vi.fn(),
  loadConversation: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  assignConversationToProject: vi.fn(async () => true),
  refreshProjects: vi.fn(),
  copyCurrentTranscript: vi.fn(async () => {}),
  exportCurrentTranscript: vi.fn(),
};

function metaValue(): KiroSessionMetaValue {
  return {
    currentConversationId: metaState.currentConversationId,
    conversationTitle: null,
    conversationCreatedAt: null,
    conversationSummary: null,
    historyVersion: metaState.historyVersion,
    sidecarOpen: false,
    sidecarMode: "closed",
    kiroBusy: metaState.kiroRuntimeStatus !== "idle",
    kiroRuntimeStatus: metaState.kiroRuntimeStatus,
    suggestionsKind: null,
    suggestionsGen: 0,
    lastUserTurnGen: 0,
    hasMessages: metaState.hasMessages,
    conversationTransitioning: metaState.conversationTransitioning,
    conversationTransition: {
      target: metaState.transitionTarget,
      phase: metaState.conversationTransitioning ? "stopping" : "idle",
      pending: metaState.conversationTransitioning,
    } as unknown as KiroSessionMetaValue["conversationTransition"],
    conversationProjectId: metaState.conversationProjectId,
    projectsVersion: metaState.projectsVersion,
    emptyIntroGeneration: 0,
  };
}

const actionsValue = actionSpies as unknown as KiroSessionActionsValue;

/* ---------------- harness ---------------- */

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderNavigator() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <KiroSessionMetaContext.Provider value={metaValue()}>
        <KiroSessionActionsContext.Provider value={actionsValue}>
          <KiroNavigator />
        </KiroSessionActionsContext.Provider>
      </KiroSessionMetaContext.Provider>
    );
  });
  await flush();
}

function rerenderNavigator() {
  act(() => {
    root!.render(
      <KiroSessionMetaContext.Provider value={metaValue()}>
        <KiroSessionActionsContext.Provider value={actionsValue}>
          <KiroNavigator />
        </KiroSessionActionsContext.Provider>
      </KiroSessionMetaContext.Provider>
    );
  });
}

function q(label: string): HTMLElement | null {
  return container!.querySelector(`[aria-label="${label}"]`);
}

async function click(label: string) {
  const el = q(label);
  expect(el, `aria-label=${label}`).toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await flush();
}

/** 展开：Logo button 的 aria-label 随 Runtime Status 变化 → 用 plate 定位 */
async function clickPlate() {
  const el = container!.querySelector("button.group\\/plate") as HTMLElement | null;
  expect(el, "logo plate button").toBeTruthy();
  await act(async () => {
    el!.click();
  });
  await flush();
}

/** 按可见文本点击（查看全部 等无 aria-label 的入口） */
async function clickText(label: string) {
  const el = Array.from(container!.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(label)
  ) as HTMLElement | undefined;
  expect(el, `button text=${label}`).toBeTruthy();
  await act(async () => {
    el!.click();
  });
  await flush();
}

/** 菜单项（DropdownMenuItem role=menuitem，无 aria-label） */
async function clickMenuItem(label: string) {
  const el = Array.from(container!.querySelectorAll('[role="menuitem"]')).find((b) =>
    (b.textContent ?? "").includes(label)
  ) as HTMLElement | undefined;
  expect(el, `menuitem=${label}`).toBeTruthy();
  await act(async () => {
    el!.click();
  });
  await flush();
}

async function setInput(label: string, value: string) {
  const el = q(label) as HTMLInputElement | HTMLTextAreaElement | null;
  expect(el, `input aria-label=${label}`).toBeTruthy();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(el, value);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}

function text(): string {
  return container?.textContent ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  metaState.currentConversationId = null;
  metaState.conversationProjectId = null;
  metaState.projectsVersion = 0;
  metaState.historyVersion = 0;
  metaState.conversationTransitioning = false;
  metaState.transitionTarget = null;
  metaState.kiroRuntimeStatus = "idle";
  metaState.hasMessages = false;
  dbSpies.listKiroProjects.mockResolvedValue([project("p1", "ClassFlow Desktop")]);
  dbSpies.listConversations.mockResolvedValue([conv("c1", "查找QQ班助群近期通知")]);
  dbSpies.listProjectConversations.mockResolvedValue([conv("c2", "Computer Use 实现")]);
  dbSpies.listProjectFiles.mockResolvedValue([fileRecord("f1", "architecture.md")]);
  dbSpies.createProjectFile.mockResolvedValue(undefined);
  dbSpies.deleteProjectFile.mockResolvedValue(undefined);
  actionSpies.createProject.mockResolvedValue(project("p9", "新项目"));
  actionSpies.updateProject.mockResolvedValue(project("p1", "ClassFlow Desktop v2"));
  actionSpies.deleteProject.mockResolvedValue(undefined);
  actionSpies.assignConversationToProject.mockResolvedValue(true);
  useConfirmStore.setState({
    confirm: ((request: { onConfirm?: () => void }) => {
      request.onConfirm?.();
    }) as never,
  });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

/* ---------------- tests ---------------- */

describe("Kiro Navigator — collapsed / expanded 语义", () => {
  it("默认 collapsed：52px shell + 折叠入口（Logo / 新对话 / 最近 / 搜索 / 项目 / 更多）", async () => {
    await renderNavigator();
    const shell = container!.querySelector('[data-testid="kiro-navigator-shell"]');
    expect(shell).toBeTruthy();
    expect(shell!.getAttribute("data-state")).toBe("collapsed");
    expect(shell!.className).toContain("w-[52px]");
    expect(q("展开对话")).toBeTruthy();
    expect(q("新对话")).toBeTruthy();
    expect(q("最近对话")).toBeTruthy();
    expect(q("搜索对话")).toBeTruthy();
    expect(q("打开项目")).toBeTruthy();
    expect(q("对话更多操作")).toBeTruthy();
  });

  it("collapsed 不读取 History / Projects DB", async () => {
    await renderNavigator();
    expect(dbSpies.listConversations).not.toHaveBeenCalled();
    expect(dbSpies.listKiroProjects).not.toHaveBeenCalled();
    expect(dbSpies.listProjectFiles).not.toHaveBeenCalled();
  });

  it("expanded 首次 lazy load：并行读取 History + Projects 并渲染项目与最近对话", async () => {
    await renderNavigator();
    await click("展开对话");
    const shell = container!.querySelector('[data-testid="kiro-navigator-shell"]')!;
    expect(shell.getAttribute("data-state")).toBe("expanded");
    expect(shell.className).toContain("288px");
    expect(dbSpies.listConversations).toHaveBeenCalledTimes(1);
    expect(dbSpies.listKiroProjects).toHaveBeenCalledTimes(1);
    expect(text()).toContain("ClassFlow Desktop");
    expect(text()).toContain("查找QQ班助群近期通知");
    // 项目资料只在 Detail 读取
    expect(dbSpies.listProjectFiles).not.toHaveBeenCalled();
  });

  it("expanded 后再次展开不重复读取（版本未变化）", async () => {
    await renderNavigator();
    await click("展开对话");
    await click("收起对话");
    await click("展开对话");
    expect(dbSpies.listConversations).toHaveBeenCalledTimes(1);
    expect(dbSpies.listKiroProjects).toHaveBeenCalledTimes(1);
  });

  it("projectsVersion 更新 → 刷新项目列表", async () => {
    await renderNavigator();
    await click("展开对话");
    dbSpies.listKiroProjects.mockResolvedValue([
      project("p1", "ClassFlow Desktop"),
      project("p2", "国贸竞赛"),
    ]);
    metaState.projectsVersion = 1;
    rerenderNavigator();
    await flush();
    expect(dbSpies.listKiroProjects).toHaveBeenCalledTimes(2);
    expect(text()).toContain("国贸竞赛");
    // 版本变化不影响 History 刷新计数
    expect(dbSpies.listConversations).toHaveBeenCalledTimes(1);
  });

  it("historyVersion 更新 → 刷新最近对话", async () => {
    await renderNavigator();
    await click("展开对话");
    dbSpies.listConversations.mockResolvedValue([
      conv("c1", "查找QQ班助群近期通知"),
      conv("c3", "制作GIF表情包"),
    ]);
    metaState.historyVersion = 1;
    rerenderNavigator();
    await flush();
    expect(dbSpies.listConversations).toHaveBeenCalledTimes(2);
    expect(text()).toContain("制作GIF表情包");
  });
});

describe("Kiro Navigator — Threads", () => {
  it("点击 Thread → loadConversation（且收起 Navigator）", async () => {
    await renderNavigator();
    await click("展开对话");
    const row = container!.querySelector('[aria-label="对话 查找QQ班助群近期通知 更多操作"]')!;
    expect(row).toBeTruthy();
    await act(async () => {
      (row.closest('[role="button"]') as HTMLElement).click();
    });
    await flush();
    expect(actionSpies.loadConversation).toHaveBeenCalledWith("c1");
  });

  it("conversationTransitioning 时禁止切换（不调用 loadConversation）", async () => {
    metaState.conversationTransitioning = true;
    await renderNavigator();
    await click("展开对话");
    const row = container!.querySelector('[role="button"][aria-disabled="true"]') as HTMLElement | null;
    expect(row, "transitioning thread row").toBeTruthy();
    await act(async () => {
      row!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(actionSpies.loadConversation).not.toHaveBeenCalled();
  });

  it("最近超过 8 条 → 默认折叠 + 查看全部", async () => {
    dbSpies.listConversations.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => conv(`c${index}`, `对话标题 ${index}`))
    );
    await renderNavigator();
    await click("展开对话");
    expect(text()).not.toContain("对话标题 9");
    await clickText("查看全部");
    expect(text()).toContain("对话标题 9");
  });
});

describe("Kiro Navigator — Projects / Detail", () => {
  it("点击项目 → 同一 shell 内进入 Project Detail（含 lazy 对话与资料）", async () => {
    await renderNavigator();
    await click("展开对话");
    await click("打开项目 ClassFlow Desktop");
    expect(container!.querySelector('[data-testid="kiro-navigator-project-detail"]')).toBeTruthy();
    expect(dbSpies.listProjectConversations).toHaveBeenCalledWith("p1");
    expect(dbSpies.listProjectFiles).toHaveBeenCalledWith("p1");
    expect(text()).toContain("Computer Use 实现");
    expect(text()).toContain("architecture.md");
    // 仍在同一 shell 内（未打开第二个 Panel）
    expect(container!.querySelectorAll('[data-testid="kiro-navigator-shell"]').length).toBe(1);
  });

  it("项目内新对话 → newChatInProject", async () => {
    await renderNavigator();
    await click("展开对话");
    await click("打开项目 ClassFlow Desktop");
    await click("在此项目中新建对话");
    expect(actionSpies.newChatInProject).toHaveBeenCalledWith("p1");
  });

  it("返回项目列表 → 回到 Home", async () => {
    await renderNavigator();
    await click("展开对话");
    await click("打开项目 ClassFlow Desktop");
    await click("返回项目列表");
    expect(container!.querySelector('[data-testid="kiro-navigator-home"]')).toBeTruthy();
  });

  it("新建项目：form → 保存 → createProject → 进入 Detail", async () => {
    await renderNavigator();
    await click("展开对话");
    await click("新建项目");
    expect(container!.querySelector('[data-testid="kiro-navigator-project-form"]')).toBeTruthy();
    await setInput("项目名称", "水稻低碳研究");
    await click("保存");
    expect(actionSpies.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "水稻低碳研究" })
    );
    expect(container!.querySelector('[data-testid="kiro-navigator-project-detail"]')).toBeTruthy();
  });

  it("编辑项目：Detail ⋯ → 编辑项目 → form 预填 → 保存 → updateProject", async () => {
    await renderNavigator();
    await click("展开对话");
    await click("打开项目 ClassFlow Desktop");
    await click("项目 ClassFlow Desktop 更多操作");
    await clickMenuItem("编辑项目");
    const nameInput = q("项目名称") as HTMLInputElement;
    expect(nameInput.value).toBe("ClassFlow Desktop");
    await setInput("项目名称", "ClassFlow Desktop v2");
    await click("保存");
    expect(actionSpies.updateProject).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ name: "ClassFlow Desktop v2" })
    );
  });

  it("删除项目：Detail ⋯ → 删除项目 → confirm → deleteProject（回到 Home）", async () => {
    await renderNavigator();
    await click("展开对话");
    await click("打开项目 ClassFlow Desktop");
    await click("项目 ClassFlow Desktop 更多操作");
    await clickMenuItem("删除项目");
    expect(actionSpies.deleteProject).toHaveBeenCalledWith("p1");
    expect(container!.querySelector('[data-testid="kiro-navigator-home"]')).toBeTruthy();
  });

  it("添加历史对话：视图内移动 → assignConversationToProject", async () => {
    dbSpies.listConversations.mockResolvedValue([conv("c9", "未归类对话")]);
    await renderNavigator();
    await click("展开对话");
    await click("打开项目 ClassFlow Desktop");
    await click("添加历史对话");
    expect(container!.querySelector('[data-testid="kiro-navigator-add-conversation"]')).toBeTruthy();
    await click("添加对话 未归类对话");
    expect(actionSpies.assignConversationToProject).toHaveBeenCalledWith("c9", "p1");
  });

  it("移出项目：assignConversationToProject(id, null)", async () => {
    await renderNavigator();
    await click("展开对话");
    await click("打开项目 ClassFlow Desktop");
    await click("从项目移出 Computer Use 实现");
    expect(actionSpies.assignConversationToProject).toHaveBeenCalledWith("c2", null);
  });
});

describe("Kiro Navigator — 统一搜索", () => {
  it("同一输入框同时过滤项目与对话", async () => {
    dbSpies.listKiroProjects.mockResolvedValue([
      project("p1", "ClassFlow Desktop"),
      project("p2", "国贸竞赛"),
    ]);
    dbSpies.listConversations.mockResolvedValue([conv("c1", "查找QQ班助群近期通知")]);
    await renderNavigator();
    await click("展开对话");
    await setInput("搜索对话与项目", "国贸");
    expect(text()).toContain("国贸竞赛");
    expect(text()).not.toContain("查找QQ班助群近期通知");
    await setInput("搜索对话与项目", "QQ");
    expect(text()).toContain("查找QQ班助群近期通知");
    expect(text()).not.toContain("国贸竞赛");
    await setInput("搜索对话与项目", "不存在的关键词");
    expect(container!.querySelector('[data-testid="kiro-navigator-search-empty"]')).toBeTruthy();
  });
});

describe("Kiro Navigator — Runtime Status（完整保留 + 与展开状态解耦）", () => {
  it.each([
    ["thinking", "正在思考"],
    ["computer-active", "正在操作电脑"],
    ["waiting-approval", "等待确认"],
  ] as const)("expanded 呈现 %s 状态小字与 data-kiro-status", async (status, label) => {
    metaState.kiroRuntimeStatus = status;
    await renderNavigator();
    await clickPlate();
    const plates = container!.querySelectorAll("[data-kiro-status]");
    expect(plates.length).toBeGreaterThan(0);
    for (const plate of Array.from(plates)) {
      expect(plate.getAttribute("data-kiro-status")).toBe(status);
    }
    expect(container!.querySelector('[data-testid="kiro-navigator-runtime-status-text"]')!.textContent).toBe(label);
  });

  it("expanded / collapsed 不改变 runtime status", async () => {
    metaState.kiroRuntimeStatus = "computer-active";
    await renderNavigator();
    const collapsedStatuses = new Set(
      Array.from(container!.querySelectorAll("[data-kiro-status]")).map((el) =>
        el.getAttribute("data-kiro-status")
      )
    );
    expect(collapsedStatuses).toEqual(new Set(["computer-active"]));
    await clickPlate();
    const expandedStatuses = new Set(
      Array.from(container!.querySelectorAll("[data-kiro-status]")).map((el) =>
        el.getAttribute("data-kiro-status")
      )
    );
    expect(expandedStatuses).toEqual(new Set(["computer-active"]));
  });

  it("S5 expanded/current 只通过 data-emphasized 表达（不改变 Runtime status）", async () => {
    metaState.kiroRuntimeStatus = "thinking";
    await renderNavigator();
    await clickPlate();
    const shell = container!.querySelector('[data-testid="kiro-navigator-shell"]')!;
    expect(shell.getAttribute("data-state")).toBe("expanded");
    const emphasized = shell.querySelectorAll("[data-emphasized]");
    expect(emphasized.length).toBeGreaterThan(0);
    for (const plate of Array.from(emphasized)) {
      expect(plate.getAttribute("data-kiro-status")).toBe("thinking");
    }
  });

  it("idle：collapsed title=Kiro 且 expanded 不显示状态小字", async () => {
    await renderNavigator();
    const button = container!.querySelector('button[aria-label="展开对话"]') as HTMLButtonElement;
    expect(button.getAttribute("title")).toBe("Kiro");
    await click("展开对话");
    expect(container!.querySelector('[data-testid="kiro-navigator-runtime-status-text"]')).toBeNull();
  });

  it("不新增动态圆点 / spinner badge（状态只用 perimeter + 文字）", async () => {
    metaState.kiroRuntimeStatus = "waiting-approval";
    await renderNavigator();
    await clickPlate();
    expect(container!.querySelector('[data-testid*="dot"]')).toBeNull();
    expect(container!.querySelector('[data-testid*="badge"]')).toBeNull();
  });
});

describe("Kiro Workspace — 结构契约（source lock）", () => {
  it("KiroWorkspace 只挂载 KiroNavigator，不再挂载 KiroThreadRail / KiroProjectPanel", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const workspace = readFileSync(join(process.cwd(), "components/kiro/KiroWorkspace.tsx"), "utf8");
    expect(workspace).toContain("<KiroNavigator />");
    expect(workspace).not.toContain("KiroThreadRail");
    expect(workspace).not.toContain("KiroProjectPanel");
    expect(workspace).not.toContain("projectPanelMode");
    // Chat Surface 不变
    expect(workspace).toContain("KiroChatSurface");
  });

  it("Navigator 复用 usePresence / Motion tokens（无新动画系统）", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const navigator = readFileSync(join(process.cwd(), "components/kiro/navigation/KiroNavigator.tsx"), "utf8");
    expect(navigator).toContain("usePresence");
    expect(navigator).toContain("MOTION_MS");
    expect(navigator).toContain("MOTION_EXIT_MS");
    expect(navigator).toContain("ux-kiro-view-enter");
    // 不在 Navigator 内推导 runtime status（只消费 meta）
    expect(navigator).toContain("meta.kiroRuntimeStatus");
    expect(navigator).not.toContain("resolveKiroRuntimeStatus(");
  });

  it("mobile History Sheet 保留（未回归）", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const workspace = readFileSync(join(process.cwd(), "components/kiro/KiroWorkspace.tsx"), "utf8");
    expect(workspace).toContain("KiroHistoryPanel");
    expect(workspace).toContain("md:hidden");
  });

  it("S5 遗留双入口文件已删除（Rail/Panel/ReasoningMenu/AgentModeMenu + 其测试）", async () => {
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const f of [
      "components/kiro/KiroThreadRail.tsx",
      "components/kiro/KiroProjectPanel.tsx",
      "components/kiro/computer/KiroReasoningMenu.tsx",
      "components/kiro/computer/KiroAgentModeMenu.tsx",
      "tests/kiroRailRuntimeStatus.test.tsx",
      "tests/kiroProjectPanel.test.tsx",
      "tests/kiroSidecarComposerIcons.test.tsx",
    ]) {
      expect(existsSync(join(process.cwd(), f)), f).toBe(false);
    }
  });
});

describe("Kiro Navigator — Home 层级（产品化）", () => {
  it("空项目：无“还没有项目”说明行，CTA 即空态", async () => {
    dbSpies.listKiroProjects.mockResolvedValue([]);
    dbSpies.listConversations.mockResolvedValue([]);
    await renderNavigator();
    await click("展开对话");
    expect(text()).not.toContain("还没有项目");
    // 新建入口仍在（标题栏 ＋ 与行 CTA，数量不变）
    expect(q("新建项目")).toBeTruthy();
    expect(text()).toContain("新建项目");
  });

  it("区块标题为大写微标题（uppercase + tracking，与内容拉开层级）", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const projects = readFileSync(
      join(process.cwd(), "components/kiro/navigation/KiroNavigatorProjects.tsx"),
      "utf8"
    );
    expect(projects).toMatch(/uppercase tracking-wider/);
    const search = readFileSync(
      join(process.cwd(), "components/kiro/navigation/KiroNavigatorSearch.tsx"),
      "utf8"
    );
    expect(search).toMatch(/uppercase tracking-wider/);
  });

  it("Thread 单行结构：标题 + 右侧时间 + 当前徽标（无第二行日期堆叠）", async () => {
    dbSpies.listKiroProjects.mockResolvedValue([]);
    await renderNavigator();
    await click("展开对话");
    const row = Array.from(container!.querySelectorAll('[role="button"]')).find((el) =>
      (el.textContent ?? "").includes("查找QQ班助群近期通知")
    ) as HTMLElement | undefined;
    expect(row, "thread row").toBeTruthy();
    // 单行 h-9 + 右侧等宽时间
    expect(row!.className).toMatch(/h-9/);
    const time = row!.querySelector("span.tabular-nums");
    expect(time, "right-aligned time").toBeTruthy();
  });

  it("当前对话徽标与项目一致（pill 形态，非纯文字）", async () => {
    metaState.currentConversationId = "c1";
    dbSpies.listKiroProjects.mockResolvedValue([]);
    await renderNavigator();
    await click("展开对话");
    const row = Array.from(container!.querySelectorAll('[role="button"]')).find((el) =>
      (el.textContent ?? "").includes("查找QQ班助群近期通知")
    ) as HTMLElement | undefined;
    expect(row, "current thread row").toBeTruthy();
    const badge = Array.from(row!.querySelectorAll("span")).find(
      (s) => s.textContent === "当前"
    ) as HTMLElement | undefined;
    expect(badge, "当前 pill").toBeTruthy();
    expect(badge!.className).toMatch(/rounded-full/);
  });
});

describe("Kiro Navigator — Project Detail 层级（产品化）", () => {
  it("指令/资料/对话三区块同一 header/action 语言", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const detail = readFileSync(
      join(process.cwd(), "components/kiro/navigation/KiroNavigatorProjectDetail.tsx"),
      "utf8"
    );
    // 指令区块复用 SectionHeader（不再手写 10px 标题行）
    expect(detail).toMatch(/<KiroNavigatorSectionHeader[\s\S]{0,200}?label="项目指令"/);
    // 三个 action pill 同一款式（satin-grey + alabaster）：指令/对话在 Detail，资料在 Files
    const pills = detail.match(/text-satin-grey bg-alabaster hover:bg-pastel-mint hover:text-charcoal/g) ?? [];
    expect(pills.length).toBeGreaterThanOrEqual(2);
    const files = readFileSync(
      join(process.cwd(), "components/kiro/navigation/KiroNavigatorProjectFiles.tsx"),
      "utf8"
    );
    expect(files).toContain("KiroNavigatorSectionHeader");
    expect(files).toMatch(/text-satin-grey bg-alabaster hover:bg-pastel-mint hover:text-charcoal/);
  });

  it("Detail 内打开项目资料区：空态保留，添加入口唯一", async () => {
    await renderNavigator();
    await click("展开对话");
    await click("打开项目 ClassFlow Desktop");
    expect(text()).toContain("项目指令");
    expect(text()).toContain("添加资料");
  });
});
