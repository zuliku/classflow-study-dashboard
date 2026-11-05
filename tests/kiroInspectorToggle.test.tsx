// @vitest-environment jsdom
/**
 * Kiro Inspector V1.1 — 开关 / 动画 / 尺寸契约测试。
 *
 * - 快捷键（Cmd/Ctrl+I）与 Header 按钮开关；默认关闭（非常驻）
 * - 同一 shell width morph（0 ↔ 296px）+ presence 退出后卸载（流畅动画）
 * - 右侧栏目不再包含 Computer section
 * - 弹窗（Artifact Preview）宽高随内容自适应（max-h 封顶，无固定高度）
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { KiroInspector } from "@/components/kiro/inspector/KiroInspector";
import { KiroHeader } from "@/components/kiro/KiroHeader";
import {
  KiroSessionContext,
  KiroSessionMetaContext,
  KiroSessionActionsContext,
} from "@/components/kiro/kiroSessionContext";
import type {
  KiroSessionActionsValue,
  KiroSessionMetaValue,
  KiroSessionValue,
} from "@/components/kiro/KiroSessionProvider";
import { SHORTCUT_GUIDE } from "@/lib/commands";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";

const artifactSpies = vi.hoisted(() => ({
  listArtifactEntriesForConversation: vi.fn(async () => []),
  listRecentArtifactEntries: vi.fn(async () => []),
}));

vi.mock("@/lib/ai/computer/artifacts/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/computer/artifacts/access")>();
  return {
    ...actual,
    listArtifactEntriesForConversation: artifactSpies.listArtifactEntriesForConversation,
    listRecentArtifactEntries: artifactSpies.listRecentArtifactEntries,
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

const metaState = { currentConversationId: null as string | null };

function metaValue(): KiroSessionMetaValue {
  return {
    currentConversationId: metaState.currentConversationId,
    conversationTitle: null,
  conversationCreatedAt: null,
  conversationSummary: null,
  historyVersion: 0,
  sidecarOpen: false,
  sidecarMode: "closed",
  kiroBusy: false,
  kiroRuntimeStatus: "idle",
  currentTurnSources: [],
  conversationSourcesVersion: 0,
  suggestionsKind: null,
  suggestionsGen: 0,
  lastUserTurnGen: 0,
  hasMessages: false,
  conversationTransitioning: false,
  conversationTransition: {
    target: null,
    phase: "idle",
    pending: false,
  } as unknown as KiroSessionMetaValue["conversationTransition"],
    conversationProjectId: null,
    projectsVersion: 0,
    emptyIntroGeneration: 0,
  };
}

const actionsValue = {
  newChat: () => {},
  copyCurrentTranscript: async () => {},
  exportCurrentTranscript: () => {},
  clearHistory: () => {},
  refreshHistory: () => {},
  getConversationSources: () => [],
  addManualContext: () => {},
} as unknown as KiroSessionActionsValue;

const sessionValue = { conversationTitle: "测试对话" } as unknown as KiroSessionValue;

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <KiroSessionContext.Provider value={sessionValue}>
      <KiroSessionMetaContext.Provider value={metaValue()}>
        <KiroSessionActionsContext.Provider value={actionsValue}>
          {children}
        </KiroSessionActionsContext.Provider>
      </KiroSessionMetaContext.Provider>
    </KiroSessionContext.Provider>
  );
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function render(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<Providers>{node}</Providers>);
  });
  await flush();
}

function rerender(node: React.ReactNode) {
  act(() => {
    root!.render(<Providers>{node}</Providers>);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("Kiro Inspector — 开关（非常驻）", () => {
  it("默认关闭：shell data-state=closed、宽度 0、内容未挂载", async () => {
    await render(<KiroInspector open={false} />);
    const shell = container!.querySelector('[data-testid="kiro-inspector-shell"]')!;
    expect(shell.getAttribute("data-state")).toBe("closed");
    expect(shell.className).toContain("w-0");
    expect(shell.className).not.toContain("w-[296px]");
    expect(container!.querySelector('[data-testid="kiro-inspector"]')).toBeNull();
  });

  it("打开：shell data-state=open、宽度 296、内容挂载（同一 shell 做 width morph）", async () => {
    await render(<KiroInspector open />);
    const shell = container!.querySelector('[data-testid="kiro-inspector-shell"]')!;
    expect(shell.getAttribute("data-state")).toBe("open");
    expect(shell.className).toContain("w-[296px]");
    expect(shell.className).toContain("transition-[width]");
    expect(container!.querySelector('[data-testid="kiro-inspector"]')).toBeTruthy();
    // 同一个 shell 节点（非 mount 两个 Panel）
    rerender(<KiroInspector open={false} />);
    expect(container!.querySelectorAll('[data-testid="kiro-inspector-shell"]').length).toBe(1);
  });

  it("关闭：退出动画期间保持挂载，动画结束后 presence 卸载", async () => {
    vi.useFakeTimers();
    try {
      await render(<KiroInspector open />);
      expect(container!.querySelector('[data-testid="kiro-inspector"]')).toBeTruthy();
      rerender(<KiroInspector open={false} />);
      // 退出中：shell 立即进入 closed（width 开始 morph），内容仍在（淡出）
      const shell = container!.querySelector('[data-testid="kiro-inspector-shell"]')!;
      expect(shell.getAttribute("data-state")).toBe("closed");
      expect(container!.querySelector('[data-testid="kiro-inspector"]')).toBeTruthy();
      // 退出时长后卸载
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      expect(container!.querySelector('[data-testid="kiro-inspector"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Header 开关：aria-label / aria-expanded / aria-keyshortcuts / 点击回调", async () => {
    const onToggle = vi.fn();
    await render(<KiroHeader onNewChat={() => {}} onOpenHistory={() => {}} inspectorOpen={false} onToggleInspector={onToggle} />);
    const button = container!.querySelector('[data-testid="kiro-inspector-toggle"]') as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.getAttribute("aria-label")).toBe("打开输出与来源");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-keyshortcuts")).toContain("Control+I");
    expect(button.className).toContain("hidden xl:flex");
    await act(async () => button.click());
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <KiroHeader onNewChat={() => {}} onOpenHistory={() => {}} inspectorOpen onToggleInspector={onToggle} />
    );
    const openButton = container!.querySelector('[data-testid="kiro-inspector-toggle"]') as HTMLButtonElement;
    expect(openButton.getAttribute("aria-label")).toBe("收起输出与来源");
    expect(openButton.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("Kiro Inspector — 快捷键契约", () => {
  it("Workspace 注册 Cmd/Ctrl+I（源码契约）并默认关闭", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const workspace = readFileSync(join(process.cwd(), "components/kiro/KiroWorkspace.tsx"), "utf8");
    expect(workspace).toContain('KIRO_INSPECTOR_SHORTCUT = { key: "i", shift: false }');
    expect(workspace).toContain("metaKey || e.ctrlKey");
    expect(workspace).toContain("useState(false)");
    expect(workspace).toContain("setInspectorOpen((v) => !v)");
  });

  it("快捷键指南包含 Kiro 面板条目", () => {
    const kiro = SHORTCUT_GUIDE.find((section) => section.group === "Kiro");
    expect(kiro).toBeTruthy();
    const labels = kiro!.items.map((item) => `${item.keys} ${item.label}`).join(" | ");
    expect(labels).toContain("⌘I");
    expect(labels).toContain("输出与来源");
  });
});

describe("Kiro Inspector — 无 Computer section / 弹窗尺寸自适应", () => {
  it("右侧栏目只有 Outputs + Sources（无 Computer）", async () => {
    await render(<KiroInspector open />);
    const inspector = container!.querySelector('[data-testid="kiro-inspector"]')!;
    expect(inspector.querySelector('[data-testid="kiro-inspector-outputs"]')).toBeTruthy();
    expect(inspector.querySelector('[data-testid="kiro-inspector-sources"]')).toBeTruthy();
    expect(inspector.querySelector('[data-testid="kiro-inspector-computer"]')).toBeNull();
    expect(inspector.textContent).not.toContain("Computer");
  });

  it("Artifact Preview 弹窗：高度封顶 + 内容自适应，无固定高度/固定最大宽度", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const host = readFileSync(
      join(process.cwd(), "components/kiro/computer/KiroArtifactPreviewDialogHost.tsx"),
      "utf8"
    );
    expect(host).toContain("max-h-[82vh]");
    expect(host).toContain("w-auto");
    expect(host).toContain("min-w-[min(560px");
    expect(host).toContain("max-w-[min(768px");
    // 不引入固定高度（只允许 max-h 封顶）
    expect(host).not.toMatch(/(?:^|\s)h-\[\d+vh\]/);
  });
});

describe("Kiro Inspector — 高度自适应 / 排版层级", () => {
  it("面板高度随内容自适应（self-start + max-h 封顶 + 内部滚动；不拉伸整列）", async () => {
    await render(<KiroInspector open />);
    const shell = container!.querySelector('[data-testid="kiro-inspector-shell"]')!;
    expect(shell.className).toContain("self-start");
    const wrapper = shell.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("max-h-[calc(100dvh-120px)]");
    const aside = container!.querySelector('[data-testid="kiro-inspector"]') as HTMLElement;
    expect(aside.className).toContain("max-h-full");
    expect(aside.className.split(" ")).not.toContain("h-full");
    expect(aside.className).toContain("overflow-hidden");
    // 内容超出时才在内部滚动
    expect(aside.firstElementChild?.className).toContain("overflow-y-auto");
  });

  it("Section 层级：header hairline 结构 + 计数 pill（0 不显示）", async () => {
    metaState.currentConversationId = "c1";
    useKiroComputerStore.setState({
      activeWorkspaceId: "ws-1",
      workspaces: [
        {
          id: "ws-1",
          name: "课程资料",
          roots: [{ id: "root-1", label: "资料", access: "read-write", adapterRef: "sandbox-default" }],
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
    });
    artifactSpies.listArtifactEntriesForConversation.mockResolvedValue([
      {
        artifact: {
          id: "a1",
          workspaceId: "ws-1",
          rootId: "root-1",
          relativePath: "docs/report.docx",
          type: "docx",
          title: "report.docx",
          displayName: "report.docx",
          source: "kiro-created",
          sourceConversationId: "c1",
          revision: 2,
          createdAt: "2026-08-01T10:00:00.000Z",
          updatedAt: "2026-08-09T12:00:00.000Z",
        },
        workspaceLabel: "课程资料",
        rootLabel: "资料",
        availability: "available",
      },
    ]);
    await render(<KiroInspector open />);
    const headers = container!.querySelectorAll('[data-testid="kiro-inspector-section-header"]');
    // Outputs / 子代理 / Sources
    expect(headers.length).toBe(3);
    // Outputs 有 1 条 → 计数 pill；子代理 / Sources 为 0 → 不显示
    const counts = container!.querySelectorAll('[data-testid="kiro-inspector-section-count"]');
    expect(counts.length).toBe(1);
    expect(counts[0].textContent).toBe("1");
    // 行排版：标题 + 低权重 meta（类型 · revision · 时间）
    const row = container!.querySelector('[data-testid="kiro-inspector-output-row"]')!;
    expect(row.textContent).toContain("report.docx");
    expect(row.textContent).toContain("Word · v2");
  });
});
