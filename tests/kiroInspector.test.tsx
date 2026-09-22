// @vitest-environment jsdom
/**
 * Kiro Inspector V1 — 组件 / 接线测试。
 *
 * 覆盖：Outputs（Conversation scoped / 排序 / availability / 无 polling / Preview / Download / Delete / Ask Kiro）、
 * Sources（聚合 / 语义去重 / 安全 URL / 查看全部 / 低频重算）、Computer（真实状态 / 无假 screenshot）、
 * Workspace 接入（xl+ / Sidecar 不渲染 / Header fallback）、Source ownership（sanitize 持久化）。
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { KiroInspector } from "@/components/kiro/inspector/KiroInspector";
import { KiroSessionMetaContext, KiroSessionActionsContext } from "@/components/kiro/kiroSessionContext";
import type {
  KiroSessionActionsValue,
  KiroSessionMetaValue,
} from "@/components/kiro/KiroSessionProvider";
import type { KiroRuntimeStatus } from "@/lib/ai/ui/kiroRuntimeStatus";
import type { KiroSourceMeta } from "@/lib/ai/citations/types";
import type { KiroRecentArtifactEntry } from "@/lib/ai/computer/artifacts/access";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";
import { useKiroArtifactUiStore } from "@/store/useKiroArtifactUiStore";
import { useConfirmStore } from "@/store/useConfirmStore";

const artifactSpies = vi.hoisted(() => ({
  listArtifactEntriesForConversation: vi.fn(),
  listRecentArtifactEntries: vi.fn(),
  getArtifact: vi.fn(),
  removeArtifactRecord: vi.fn(),
  deleteWorkspaceFile: vi.fn(),
}));

vi.mock("@/lib/ai/computer/artifacts/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/computer/artifacts/access")>();
  return {
    ...actual,
    listArtifactEntriesForConversation: artifactSpies.listArtifactEntriesForConversation,
    listRecentArtifactEntries: artifactSpies.listRecentArtifactEntries,
  };
});

vi.mock("@/lib/ai/computer/artifacts/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/computer/artifacts/service")>();
  return {
    ...actual,
    getArtifact: artifactSpies.getArtifact,
    removeArtifactRecord: artifactSpies.removeArtifactRecord,
  };
});

vi.mock("@/lib/ai/computer/filesystem/deleteFile", () => ({
  deleteWorkspaceFile: artifactSpies.deleteWorkspaceFile,
}));

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

function artifactEntry(overrides: {
  id: string;
  name: string;
  conversationId?: string;
  revision?: number;
  updatedAt?: string;
  availability?: KiroRecentArtifactEntry["availability"];
  unavailableReason?: string;
}): KiroRecentArtifactEntry {
  return {
    artifact: {
      id: overrides.id,
      workspaceId: "ws-1",
      rootId: "root-1",
      relativePath: `docs/${overrides.name}`,
      type: "docx",
      title: overrides.name,
      displayName: overrides.name,
      source: "kiro-created",
      sourceConversationId: overrides.conversationId ?? "c1",
      revision: overrides.revision ?? 1,
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: overrides.updatedAt ?? "2026-08-09T12:00:00.000Z",
    },
    workspaceLabel: "课程资料",
    rootLabel: "资料",
    availability: overrides.availability ?? "available",
    ...(overrides.unavailableReason ? { unavailableReason: overrides.unavailableReason } : {}),
  };
}

const metaState: {
  currentConversationId: string | null;
  currentTurnSources: KiroSourceMeta[];
  conversationSourcesVersion: number;
  kiroRuntimeStatus: KiroRuntimeStatus;
} = {
  currentConversationId: "c1",
  currentTurnSources: [],
  conversationSourcesVersion: 0,
  kiroRuntimeStatus: "idle",
};

const actionSpies = {
  addManualContext: vi.fn(),
  getConversationSources: vi.fn((): KiroSourceMeta[] => []),
};

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
    kiroRuntimeStatus: metaState.kiroRuntimeStatus,
    currentTurnSources: metaState.currentTurnSources,
    conversationSourcesVersion: metaState.conversationSourcesVersion,
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

const actionsValue = actionSpies as unknown as KiroSessionActionsValue;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderInspector() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <KiroSessionMetaContext.Provider value={metaValue()}>
        <KiroSessionActionsContext.Provider value={actionsValue}>
          <KiroInspector open />
        </KiroSessionActionsContext.Provider>
      </KiroSessionMetaContext.Provider>
    );
  });
  await flush();
}

function rerenderInspector() {
  act(() => {
    root!.render(
      <KiroSessionMetaContext.Provider value={metaValue()}>
        <KiroSessionActionsContext.Provider value={actionsValue}>
          <KiroInspector open />
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

function text(): string {
  return container?.textContent ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  metaState.currentConversationId = "c1";
  metaState.currentTurnSources = [];
  metaState.conversationSourcesVersion = 0;
  metaState.kiroRuntimeStatus = "idle";
  useKiroComputerStore.setState({
    computerEnabled: true,
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
  useKiroArtifactUiStore.setState({ previewArtifactId: null, artifactUiVersion: 0 });
  artifactSpies.listArtifactEntriesForConversation.mockResolvedValue([
    artifactEntry({ id: "a2", name: "summary.md", updatedAt: "2026-08-09T12:00:00.000Z", revision: 2 }),
    artifactEntry({ id: "a1", name: "report.docx", updatedAt: "2026-08-08T12:00:00.000Z" }),
  ]);
  artifactSpies.listRecentArtifactEntries.mockResolvedValue([
    artifactEntry({ id: "w1", name: "其他对话文件.md", conversationId: "c9" }),
  ]);
  artifactSpies.getArtifact.mockImplementation(async (id: string) => {
    if (id === "a1") return artifactEntry({ id: "a1", name: "report.docx" }).artifact;
    if (id === "a2") return artifactEntry({ id: "a2", name: "summary.md" }).artifact;
    return null;
  });
  artifactSpies.removeArtifactRecord.mockResolvedValue(undefined);
  artifactSpies.deleteWorkspaceFile.mockResolvedValue(undefined);
  actionSpies.getConversationSources.mockReturnValue([]);
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

/* ---------------- Outputs ---------------- */

describe("Kiro Inspector — Outputs", () => {
  it("只显示当前 Conversation 的 Artifact（不把其他对话文件冒充本次输出）", async () => {
    await renderInspector();
    expect(artifactSpies.listArtifactEntriesForConversation).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1", conversationId: "c1" })
    );
    const rows = container!.querySelectorAll('[data-testid="kiro-inspector-output-row"]');
    expect(rows.length).toBe(2);
    expect(text()).toContain("summary.md");
    expect(text()).toContain("report.docx");
    // Workspace 级最近文件不在默认视图
    expect(text()).not.toContain("其他对话文件.md");
    expect(artifactSpies.listRecentArtifactEntries).not.toHaveBeenCalled();
  });

  it("Conversation 无输出 → 空态 + 低权重「最近文件」按需展开", async () => {
    artifactSpies.listArtifactEntriesForConversation.mockResolvedValue([]);
    await renderInspector();
    expect(text()).toContain("暂无本次对话输出");
    expect(artifactSpies.listRecentArtifactEntries).not.toHaveBeenCalled();
    const recent = Array.from(container!.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("最近文件")
    ) as HTMLElement;
    await act(async () => recent.click());
    await flush();
    expect(artifactSpies.listRecentArtifactEntries).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1", limit: 6 })
    );
    expect(text()).toContain("其他对话文件.md");
  });

  it("availability：missing 显示不可用文案且无预览按钮；unavailable 显示原因", async () => {
    artifactSpies.listArtifactEntriesForConversation.mockResolvedValue([
      artifactEntry({ id: "m1", name: "gone.md", availability: "missing" }),
      artifactEntry({ id: "u1", name: "locked.md", availability: "unavailable", unavailableReason: "暂时无法访问" }),
    ]);
    await renderInspector();
    expect(text()).toContain("文件不存在");
    expect(text()).toContain("暂时无法访问");
    expect(q("预览 gone.md")).toBeNull();
    expect(q("移除记录 gone.md")).toBeTruthy();
    // missing 记录移除走 removeArtifactRecord（不删文件系统）
    await click("移除记录 gone.md");
    expect(artifactSpies.removeArtifactRecord).toHaveBeenCalledWith("m1");
  });

  it("Preview 复用 Artifact UI Store（Preview Host 消费同一 store）", async () => {
    await renderInspector();
    await click("预览 summary.md");
    expect(useKiroArtifactUiStore.getState().previewArtifactId).toBe("a2");
  });

  it("Download 走 canonical Artifact 下载链（getArtifactDownloadPayload + triggerArtifactDownload）", async () => {
    const downloadModule = await import("@/lib/ai/computer/artifacts/download");
    const spy = vi.spyOn(downloadModule, "triggerArtifactDownload").mockImplementation(() => {});
    const accessModule = await import("@/lib/ai/computer/artifacts/access");
    const payloadSpy = vi
      .spyOn(accessModule, "getArtifactDownloadPayload")
      .mockResolvedValue({
        artifact: artifactEntry({ id: "a2", name: "summary.md" }).artifact,
        fileName: "summary.md",
        mimeType: "text/markdown",
        bytes: new Uint8Array([1]),
      });
    await renderInspector();
    await click("下载 summary.md");
    expect(payloadSpy).toHaveBeenCalledWith(expect.objectContaining({ artifactId: "a2" }));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    payloadSpy.mockRestore();
  });

  it("Delete 仍要求确认（confirm store）→ deleteWorkspaceFile + 刷新 Outputs", async () => {
    await renderInspector();
    await click("删除 report.docx");
    expect(artifactSpies.deleteWorkspaceFile).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1", rootId: "root-1", relativePath: "docs/report.docx" })
    );
    // UI invalidation → 再次查询（无 polling，仅删除后一次）
    expect(useKiroArtifactUiStore.getState().artifactUiVersion).toBe(1);
  });

  it("Ask Kiro 构造 canonical artifact context（不复制第二份逻辑）", async () => {
    await renderInspector();
    await click("Ask Kiro summary.md");
    expect(actionSpies.addManualContext).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "artifact",
        key: "manual-artifact-a2",
        source: "manual",
        artifact: expect.objectContaining({ artifactId: "a2", workspaceId: "ws-1", rootId: "root-1" }),
      })
    );
  });

  it("不做永久轮询（无 2s polling；仅低频 invalidation 触发查询）", async () => {
    vi.useFakeTimers();
    try {
      await renderInspector();
      const callsAfterMount = artifactSpies.listArtifactEntriesForConversation.mock.calls.length;
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      expect(artifactSpies.listArtifactEntriesForConversation.mock.calls.length).toBe(callsAfterMount);
      // 版本 signal 变化才刷新（turn settle / 删除 / 会话切换）
      metaState.conversationSourcesVersion = 1;
      rerenderInspector();
      await act(async () => {
        await Promise.resolve();
      });
      expect(artifactSpies.listArtifactEntriesForConversation.mock.calls.length).toBeGreaterThan(callsAfterMount);
    } finally {
      vi.useRealTimers();
    }
  });

  it("conversation 变化 → 重新查询（不会残留上一对话输出）", async () => {
    await renderInspector();
    artifactSpies.listArtifactEntriesForConversation.mockResolvedValue([]);
    metaState.currentConversationId = "c2";
    rerenderInspector();
    await flush();
    expect(artifactSpies.listArtifactEntriesForConversation).toHaveBeenLastCalledWith(
      expect.objectContaining({ conversationId: "c2" })
    );
    expect(container!.querySelectorAll('[data-testid="kiro-inspector-output-row"]').length).toBe(0);
  });
});

/* ---------------- Sources ---------------- */

describe("Kiro Inspector — Sources", () => {
  const webSource: KiroSourceMeta = {
    sourceId: "web-1",
    name: "OpenAI — Codex",
    source: "web",
    url: "https://openai.com/codex",
    domain: "openai.com",
  };
  const unsafeSource: KiroSourceMeta = {
    sourceId: "web-2",
    name: "不安全来源",
    source: "web",
    url: "javascript:alert(1)",
  };
  const materialSource: KiroSourceMeta = {
    sourceId: "material-1",
    name: "计量经济学第三章.pdf",
    source: "course-material",
    courseName: "中级计量经济学",
  };

  it("live Turn sources 优先 + 历史聚合 + 语义去重", async () => {
    metaState.currentTurnSources = [webSource];
    actionSpies.getConversationSources.mockReturnValue([
      { ...webSource, sourceId: "web-9", url: "https://openai.com/codex/" },
      materialSource,
    ]);
    await renderInspector();
    const rows = container!.querySelectorAll('[data-testid="kiro-inspector-source-row"]');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain("OpenAI — Codex");
    expect(rows[1].textContent).toContain("计量经济学第三章.pdf");
    expect(text()).toContain("课程资料 · 中级计量经济学");
  });

  it("不安全 URL 不渲染可点击链接", async () => {
    metaState.currentTurnSources = [unsafeSource];
    await renderInspector();
    expect(container!.querySelector('a[href^="javascript"]')).toBeNull();
    expect(q("打开来源：不安全来源")).toBeNull();
  });

  it("安全 URL 渲染外链（noopener）", async () => {
    metaState.currentTurnSources = [webSource];
    await renderInspector();
    const link = q("打开来源：OpenAI — Codex") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://openai.com/codex");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("超过 6 个 → 查看全部 disclosure（不新开 Modal）", async () => {
    metaState.currentTurnSources = Array.from({ length: 8 }, (_, index) => ({
      sourceId: `web-${index}`,
      name: `来源 ${index}`,
      source: "web" as const,
      url: `https://example.com/${index}`,
    }));
    await renderInspector();
    expect(container!.querySelectorAll('[data-testid="kiro-inspector-source-row"]').length).toBe(6);
    const more = Array.from(container!.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("查看全部")
    ) as HTMLElement;
    expect(more).toBeTruthy();
    await act(async () => more.click());
    await flush();
    expect(container!.querySelectorAll('[data-testid="kiro-inspector-source-row"]').length).toBe(8);
  });

  it("无来源 → 弱 empty state", async () => {
    await renderInspector();
    expect(text()).toContain("暂无来源");
  });

  it("runtime source 未变化时不重复聚合（低频重算）", async () => {
    metaState.currentTurnSources = [webSource];
    await renderInspector();
    const callsAfterMount = actionSpies.getConversationSources.mock.calls.length;
    rerenderInspector();
    await flush();
    rerenderInspector();
    await flush();
    expect(actionSpies.getConversationSources.mock.calls.length).toBe(callsAfterMount);
  });
});

/* ---------------- 结构契约（source lock） ---------------- */

describe("Kiro Inspector — Workspace / Header 接线", () => {
  it("Workspace 在 xl 结构挂载 Inspector，且 Inspector 仅 xl+ 显示", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const workspace = readFileSync(join(process.cwd(), "components/kiro/KiroWorkspace.tsx"), "utf8");
    expect(workspace).toContain("<KiroInspector open={inspectorOpen} />");
    expect(workspace).toContain("KIRO_INSPECTOR_SHORTCUT");
    const inspector = readFileSync(
      join(process.cwd(), "components/kiro/inspector/KiroInspector.tsx"),
      "utf8"
    );
    expect(inspector).toContain("w-[296px]");
    expect(inspector).toContain('"hidden xl:block');
    expect(inspector).not.toContain("KiroInspectorComputer");
  });

  it("Inspector 不出现在 Sidecar（Sidecar 不挂载 KiroInspector）", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const file of ["components/kiro/KiroSidecar.tsx", "components/kiro/sidecar/KiroSidecarShell.tsx"]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).not.toContain("KiroInspector");
    }
  });

  it("Header Recent Files：xl 隐藏、非 xl 保留 Popover fallback", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const header = readFileSync(join(process.cwd(), "components/kiro/KiroHeader.tsx"), "utf8");
    expect(header).toContain("KiroRecentArtifactsPopover");
    expect(header).toContain("xl:hidden");
  });

  it("Message More → 来源（KiroSourcesMenuView）保留（Inspector 不替代精确 Citation 入口）", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const message = readFileSync(join(process.cwd(), "components/kiro/KiroMessage.tsx"), "utf8");
    expect(message).toContain("KiroSourcesMenuView");
  });

  it("Inspector 不订阅 useKiroRuntime().chat（token-level rerender 防护）", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const file of [
      "components/kiro/inspector/KiroInspector.tsx",
      "components/kiro/inspector/KiroInspectorOutputs.tsx",
      "components/kiro/inspector/KiroInspectorSources.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source, file).not.toContain("useKiroRuntime()");
      expect(source, file).not.toContain("chat.messages");
    }
  });

  it("Artifact 刷新由低频 invalidation 驱动（源码无 setInterval）", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const outputs = readFileSync(
      join(process.cwd(), "components/kiro/inspector/KiroInspectorOutputs.tsx"),
      "utf8"
    );
    expect(outputs).not.toContain("setInterval");
    expect(outputs).toContain("artifactUiVersion");
  });
});

/* ---------------- Source ownership / persistence ---------------- */

describe("Kiro Inspector — Source ownership 链", () => {
  it("useKiroChat 在 turn settled 绑定 owning assistant message（源码契约）", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const chat = readFileSync(join(process.cwd(), "hooks/useKiroChat.ts"), "utf8");
    expect(chat).toContain("turnBoundSourcesRef");
    expect(chat).toContain("setConversationSourcesVersion");
    expect(chat).toContain("getConversationSources");
    // 绑定后经 messages memo 进入 view.sources（sanitizeConversation 才可落盘）
    expect(chat).toContain("turnBoundSourcesRef.current.get(m.id)");
  });

  it("bound message sources 能进入 sanitizeConversation（PersistedKiroMessage.sources）", async () => {
    const { sanitizeConversation } = await import("@/lib/ai/history/sanitize");
    const record = sanitizeConversation({
      id: "c1",
      title: "测试",
      createdAt: "2026-08-01T10:00:00.000Z",
      provider: "opencode-go",
      model: "m",
      messages: [
        { id: "u1", role: "user", content: "问题" },
        {
          id: "a1",
          role: "assistant",
          content: "回答",
          sources: [
            { sourceId: "web-1", name: "OpenAI", source: "web", url: "https://openai.com/x", domain: "openai.com" },
          ],
        },
      ],
      manualRefs: [],
      entryRefs: [],
      summary: null,
      projectId: null,
      visualProposalReceipts: [],
    } as never);
    const assistant = record.messages.find((m) => m.role === "assistant")!;
    expect(assistant.sources?.[0]).toMatchObject({ sourceId: "web-1", url: "https://openai.com/x" });
  });
});
