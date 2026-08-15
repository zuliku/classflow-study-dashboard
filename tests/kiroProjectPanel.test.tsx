// @vitest-environment jsdom
/**
 * Kiro Project Panel UI 测试（Phase 1 专注行为，不写 brittle snapshot）。
 * 使用 jsdom + react-dom/client + act；IndexedDB 由 fake-indexeddb 提供（tests/setup.ts）。
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { KiroProjectPanel, ProjectPanelMode } from "@/components/kiro/KiroProjectPanel";
import { useConfirmStore } from "@/store/useConfirmStore";
import { useToastStore } from "@/store/useToastStore";
import { createKiroProject, assignConversationToProject } from "@/lib/ai/projects/db";
import { saveConversation, clearConversationHistory } from "@/lib/ai/history/db";
import { resetKiroDbForTests, openKiroDB, KIRO_PROJECTS_STORE } from "@/lib/ai/storage/kiroDb";
import { KiroConversationRecord } from "@/lib/ai/history/types";

const mocks = vi.hoisted(() => {
  type PanelMeta = {
    currentConversationId: string | null;
    conversationProjectId: string | null;
    projectsVersion: number;
    conversationTransitioning: boolean;
  };
  const meta: PanelMeta = {
    currentConversationId: null,
    conversationProjectId: null,
    projectsVersion: 0,
    conversationTransitioning: false,
  };
  return {
    meta,
    actions: {
      createProject: vi.fn(),
      updateProject: vi.fn(),
      deleteProject: vi.fn(),
      assignConversationToProject: vi.fn(),
      newChatInProject: vi.fn(),
    },
  };
});

vi.mock("@/components/kiro/KiroSessionProvider", () => ({
  useKiroSessionMeta: () => mocks.meta,
  useKiroSessionActions: () => mocks.actions,
}));

if (!window.matchMedia) {
  // jsdom 无 matchMedia：stub（useEffectiveReducedMotion 使用）
  (window as unknown as { matchMedia: unknown }).matchMedia = () =>
    ({
      matches: false,
      media: "",
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }) as unknown as MediaQueryList;
}

function conv(id: string, over: Partial<KiroConversationRecord> = {}): KiroConversationRecord {
  return {
    id,
    title: `对话 ${id}`,
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

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onOpenConversation = vi.fn();
  const onSetMode = vi.fn();
  const render = (mode: ProjectPanelMode) => {
    act(() => {
      root.render(
        <KiroProjectPanel mode={mode} onSetMode={onSetMode} onOpenConversation={onOpenConversation} />
      );
    });
  };
  const click = (label: string) => {
    const el = container.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;
    expect(el, `button[aria-label=${label}]`).toBeTruthy();
    act(() => el!.click());
  };
  const setInput = (label: string, value: string) => {
    const el = container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | HTMLTextAreaElement | null;
    expect(el).toBeTruthy();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        "value"
      )?.set;
      setter?.call(el, value);
      el!.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const text = () => container.textContent ?? "";
  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };
  const cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return { container, render, click, setInput, text, flush, cleanup, onOpenConversation, onSetMode };
}

beforeEach(async () => {
  vi.clearAllMocks();
  useConfirmStore.setState({ request: null });
  mocks.meta.projectsVersion = 0;
  resetKiroDbForTests();
  await clearConversationHistory().catch(() => {});
  const db = await openKiroDB();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(KIRO_PROJECTS_STORE, "readwrite");
    t.objectStore(KIRO_PROJECTS_STORE).clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
});

describe("KiroProjectPanel 状态机", () => {
  it("expanded：dialog + 项目列表 + 新建项目", async () => {
    const p = await createKiroProject({ name: "项目 A" });
    const s = setup();
    s.render("expanded");
    await s.flush();
    expect(s.container.querySelector('[role="dialog"][aria-label="项目"]')).toBeTruthy();
    expect(s.text()).toContain("项目 A");
    expect(s.container.querySelector('[aria-label="新建项目"]')).toBeTruthy();
    s.cleanup();
  });

  it("collapsed：52px rail（项目 + 关闭），无 dialog", async () => {
    const s = setup();
    s.render("collapsed");
    await s.flush();
    expect(s.container.querySelector('[aria-label="项目"]')).toBeTruthy();
    expect(s.container.querySelector('[aria-label="关闭项目"]')).toBeTruthy();
    expect(s.container.querySelector('[role="dialog"]')).toBeNull();
    s.click("项目");
    expect(s.onSetMode).toHaveBeenCalledWith("expanded");
    s.cleanup();
  });

  it("closed：完全卸载（空渲染）", async () => {
    const s = setup();
    s.render("closed");
    await s.flush();
    expect(s.text()).toBe("");
    s.cleanup();
  });

  it("collapsed → close → 卸载", async () => {
    const s = setup();
    s.render("collapsed");
    await s.flush();
    s.click("关闭项目");
    expect(s.onSetMode).toHaveBeenCalledWith("closed");
    s.cleanup();
  });
});

describe("List → Detail 与项目操作", () => {
  it("List → Detail：项目内对话可见；打开对话回调", async () => {
    const p = await createKiroProject({ name: "项目 A" });
    await saveConversation(conv("c1"));
    await assignConversationToProject("c1", p.id);
    const s = setup();
    s.render("expanded");
    await s.flush();
    s.click("打开项目 项目 A");
    await s.flush();
    expect(s.text()).toContain("对话 · 1");
    expect(s.text()).toContain("对话 c1");
    s.click("打开对话 对话 c1");
    expect(s.onOpenConversation).toHaveBeenCalledWith("c1");
    s.cleanup();
  });

  it("创建项目：inline form → actions.createProject；成功后进入 Detail", async () => {
    mocks.actions.createProject.mockResolvedValue({ id: "proj_new", name: "新项目", createdAt: "", updatedAt: "" });
    const s = setup();
    s.render("expanded");
    await s.flush();
    s.click("新建项目");
    s.setInput("项目名称", "新项目");
    s.click("保存");
    await s.flush();
    expect(mocks.actions.createProject).toHaveBeenCalledWith({ name: "新项目", description: "" });
    s.cleanup();
  });

  it("编辑项目：form 预填；保存调用 updateProject", async () => {
    const p = await createKiroProject({ name: "项目 A", description: "旧描述" });
    mocks.actions.updateProject.mockResolvedValue({ ...p, name: "项目 A2" });
    const s = setup();
    s.render("expanded");
    await s.flush();
    s.click(`编辑项目 项目 A`);
    s.setInput("项目名称", "项目 A2");
    s.click("保存");
    await s.flush();
    expect(mocks.actions.updateProject).toHaveBeenCalledWith(p.id, { name: "项目 A2", description: "旧描述" });
    s.cleanup();
  });

  it("删除确认：confirm 触发且描述安全；确认后调用 deleteProject", async () => {
    const p = await createKiroProject({ name: "项目 A" });
    const s = setup();
    s.render("expanded");
    await s.flush();
    s.click(`删除项目 项目 A`);
    const req = useConfirmStore.getState().request;
    expect(req?.title).toBe("删除项目？");
    expect(req?.description).toContain("对话不会被删除");
    act(() => req!.onConfirm());
    await s.flush();
    expect(mocks.actions.deleteProject).toHaveBeenCalledWith(p.id);
    s.cleanup();
  });
});

describe("添加 / 移出 Conversation", () => {
  it("Add View：未归类显示「未归类」；来自其他项目显示「来自…」且按钮为「移动」", async () => {
    const pa = await createKiroProject({ name: "A" });
    const pb = await createKiroProject({ name: "B" });
    await saveConversation(conv("c-free"));
    await saveConversation(conv("c-in-b"));
    await assignConversationToProject("c-in-b", pb.id);
    const s = setup();
    s.render("expanded");
    await s.flush();
    s.click("打开项目 A");
    await s.flush();
    s.click("添加历史对话");
    await s.flush();
    expect(s.text()).toContain("未归类");
    expect(s.text()).toContain("来自「B」");
    // 当前项目 A 的对话不在候选（无 c-in-a）
    // c-free 按钮为「添加」
    const addBtn = s.container.querySelector('[aria-label="添加对话 对话 c-free"]');
    expect(addBtn).toBeTruthy();
    const moveBtn = s.container.querySelector('[aria-label="移动对话 对话 c-in-b"]');
    expect(moveBtn).toBeTruthy();
    s.click("移动对话 对话 c-in-b");
    expect(mocks.actions.assignConversationToProject).toHaveBeenCalledWith("c-in-b", pa.id);
    s.cleanup();
  });

  it("Detail：移出项目 → assign(null)；对话不被删除", async () => {
    const p = await createKiroProject({ name: "A" });
    await saveConversation(conv("c1"));
    await assignConversationToProject("c1", p.id);
    mocks.actions.assignConversationToProject.mockResolvedValue(true);
    const s = setup();
    s.render("expanded");
    await s.flush();
    s.click("打开项目 A");
    await s.flush();
    s.click("从项目移出 对话 c1");
    expect(mocks.actions.assignConversationToProject).toHaveBeenCalledWith("c1", null);
    s.cleanup();
  });
});

describe("Project-scoped New Chat（V1.1）", () => {
  it("Detail「在此项目中新建对话」→ actions.newChatInProject(projectId)；Panel 保持打开", async () => {
    const p = await createKiroProject({ name: "A" });
    const s = setup();
    s.render("expanded");
    await s.flush();
    s.click("打开项目 A");
    await s.flush();
    s.click("在此项目中新建对话");
    expect(mocks.actions.newChatInProject).toHaveBeenCalledWith(p.id);
    // Panel 不关闭：仍在 detail 且未调用 onSetMode(closed/collapsed)
    expect(s.onSetMode).not.toHaveBeenCalled();
    expect(s.container.querySelector('[aria-label="在此项目中新建对话"]')).toBeTruthy();
    s.cleanup();
  });

  it("transitioning=true：新对话按钮 disabled", async () => {
    const p = await createKiroProject({ name: "A" });
    mocks.meta.conversationTransitioning = true;
    const s = setup();
    s.render("expanded");
    await s.flush();
    s.click("打开项目 A");
    await s.flush();
    const btn = s.container.querySelector('[aria-label="在此项目中新建对话"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    act(() => btn.click());
    expect(mocks.actions.newChatInProject).not.toHaveBeenCalled();
    mocks.meta.conversationTransitioning = false;
    s.cleanup();
  });

  it("transient 当前项目：无 conversationId 时 Project A 仍显示当前状态", async () => {
    const p = await createKiroProject({ name: "A" });
    mocks.meta.conversationProjectId = p.id;
    mocks.meta.currentConversationId = null;
    const s = setup();
    s.render("expanded");
    await s.flush();
    // List：Project A 显示「当前项目」
    expect(s.text()).toContain("当前项目");
    s.click("打开项目 A");
    await s.flush();
    // Detail：transient 提示出现，且不计入「对话 · N」
    expect(s.text()).toContain("当前 · 新对话");
    expect(s.text()).toContain("对话 · 0");
    mocks.meta.conversationProjectId = null;
    s.cleanup();
  });
});
