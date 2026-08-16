// @vitest-environment jsdom
/**
 * Kiro Motion System V1 —— Empty Intro 生命周期 + ChatSurface motion scope。
 * - claimEmptyIntroOnce：每 surface 每 generation 一次
 * - ChatSurface：workspace/sidecar scope class；Empty → Conversation contextual handoff
 *   （Empty 立即 semantic close，Conversation 立即 mount；Composer DOM 稳定）
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { claimEmptyIntroOnce } from "@/lib/kiro/motion/emptyIntro";
import { KiroChatSurface } from "@/components/kiro/KiroChatSurface";

const mocks = vi.hoisted(() => {
  const meta = {
    suggestionsKind: null,
    suggestionsGen: 0,
    lastUserTurnGen: 0,
    emptyIntroGeneration: 0,
    conversationTransitioning: false,
    conversationTransition: { phase: "idle" },
    conversationProjectId: null,
    projectsVersion: 0,
  };
  const actions = {
    claimEmptyIntro: vi.fn(() => true),
  };
  const chat = {
    messages: [] as unknown[],
    error: null,
    send: vi.fn(),
    retry: vi.fn(),
    consumeUndo: vi.fn(),
    editAndResend: vi.fn(),
    turnInFlight: false,
    streaming: false,
    status: "ready",
    stop: vi.fn(),
    configured: true,
    preparingVision: false,
    preparingSend: false,
    turnIntentFrozen: false,
    sources: [],
    visionEnabled: false,
    undoTask: vi.fn(),
  };
  return { meta, actions, chat };
});

vi.mock("@/components/kiro/KiroSessionProvider", () => ({
  useKiroRuntime: () => ({
    chat: mocks.chat,
    attachments: { views: [], hasProcessing: false, addFiles: vi.fn(), remove: vi.fn(), retry: vi.fn(), saveToCourse: vi.fn(), addMaterial: vi.fn() },
    activeRefs: [],
    removeContext: vi.fn(),
    addManualContext: vi.fn(),
  }),
  useKiroSessionMeta: () => mocks.meta,
  useKiroSessionActions: () => mocks.actions,
}));

if (!window.matchMedia) {
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
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

function renderSurface(variant: "workspace" | "sidecar") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<KiroChatSurface variant={variant} />);
  });
  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

beforeEach(() => {
  mocks.meta.emptyIntroGeneration = 0;
  mocks.meta.suggestionsKind = null;
  mocks.meta.suggestionsGen = 0;
  mocks.meta.lastUserTurnGen = 0;
  mocks.chat.messages = [];
  mocks.actions.claimEmptyIntro.mockClear();
  mocks.actions.claimEmptyIntro.mockReturnValue(true);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("claimEmptyIntroOnce", () => {
  it("同一 generation 同 surface：第一次 true，第二次 false（只 claim 一次）", () => {
    const seen = { workspace: -1, sidecar: -1 };
    expect(claimEmptyIntroOnce(seen, "workspace", 0)).toBe(true);
    expect(claimEmptyIntroOnce(seen, "workspace", 0)).toBe(false);
  });

  it("新 generation → 再次可 claim", () => {
    const seen = { workspace: -1, sidecar: -1 };
    expect(claimEmptyIntroOnce(seen, "workspace", 0)).toBe(true);
    expect(claimEmptyIntroOnce(seen, "workspace", 1)).toBe(true);
    expect(claimEmptyIntroOnce(seen, "workspace", 1)).toBe(false);
  });

  it("workspace / sidecar 独立 claim", () => {
    const seen = { workspace: -1, sidecar: -1 };
    expect(claimEmptyIntroOnce(seen, "workspace", 2)).toBe(true);
    expect(claimEmptyIntroOnce(seen, "sidecar", 2)).toBe(true);
    expect(claimEmptyIntroOnce(seen, "workspace", 2)).toBe(false);
    expect(claimEmptyIntroOnce(seen, "sidecar", 2)).toBe(false);
  });
});

describe("KiroChatSurface motion scope + handoff", () => {
  it("workspace → kiro-motion-workspace；sidecar → kiro-motion-sidecar", () => {
    const w = renderSurface("workspace");
    expect(w.container.querySelector(".kiro-motion-workspace")).not.toBeNull();
    w.cleanup();
    const s = renderSurface("sidecar");
    expect(s.container.querySelector(".kiro-motion-sidecar")).not.toBeNull();
    s.cleanup();
  });

  it("空对话 → Empty Experience 可见 + claimEmptyIntro(variant, generation) 被调用", () => {
    mocks.meta.emptyIntroGeneration = 0;
    const w = renderSurface("workspace");
    expect(w.container.querySelector('[data-testid="kiro-empty-experience"]')).not.toBeNull();
    expect(mocks.actions.claimEmptyIntro).toHaveBeenCalledWith("workspace", 0);
    w.cleanup();

    mocks.actions.claimEmptyIntro.mockClear();
    const s = renderSurface("sidecar");
    expect(mocks.actions.claimEmptyIntro).toHaveBeenCalledWith("sidecar", 0);
    s.cleanup();
  });

  it("有消息 → Conversation 立即存在，Empty Experience 立即 semantic close（aria-hidden + inert + pointer-events-none）", () => {
    const h = renderSurface("workspace");
    expect(h.container.querySelector('[data-testid="kiro-empty-experience"]')).not.toBeNull();
    const callsBefore = mocks.actions.claimEmptyIntro.mock.calls.length;
    // 第一条消息到达（handoff）：Empty 仍挂载（presence exit），但立即 semantic close
    act(() => {
      mocks.chat.messages = [{ id: "m1", role: "user" }];
      h.root.render(<KiroChatSurface variant="workspace" />);
    });
    const empty = h.container.querySelector('[data-testid="kiro-empty-experience"]') as HTMLElement;
    expect(empty).not.toBeNull();
    expect(empty.getAttribute("aria-hidden")).toBe("true");
    expect(empty.hasAttribute("inert")).toBe(true);
    expect(empty.className).toContain("pointer-events-none");
    // Conversation 立即 mount（不等 exit）
    expect(h.container.querySelector('[data-testid="kiro-conversation"]')).not.toBeNull();
    // 有消息后不再 claim（历史会话不播放 intro）
    expect(mocks.actions.claimEmptyIntro.mock.calls.length).toBe(callsBefore);
    h.cleanup();
  });

  it("Composer DOM identity 在 Empty → Conversation 切换中保持（不 remount）", () => {
    const h = renderSurface("workspace");
    const composerBefore = h.container.querySelector('[data-testid="kiro-composer"]');
    act(() => {
      mocks.chat.messages = [{ id: "m1", role: "user" }];
      h.root.render(<KiroChatSurface variant="workspace" />);
    });
    const composerAfter = h.container.querySelector('[data-testid="kiro-composer"]');
    expect(composerAfter).toBe(composerBefore);
    h.cleanup();
  });
});
