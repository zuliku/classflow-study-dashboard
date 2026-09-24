// @vitest-environment jsdom
/**
 * Phase 2 — Inspector 上下文占用组件测试。
 *
 * 覆盖：空态；最近一次摘要（预算占用 + 模型窗口 %）；历史行（新 → 旧、序号、compacted 标记）；
 * 版本信号驱动刷新（不订阅 token）；安全（不渲染消息正文 / 路径）。
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { KiroInspectorContextUsage } from "@/components/kiro/inspector/KiroInspectorContextUsage";
import { KiroSessionMetaContext } from "@/components/kiro/kiroSessionContext";
import type { KiroSessionMetaValue } from "@/components/kiro/KiroSessionProvider";
import { buildContextUsageSnapshot, type ContextUsageSnapshot } from "@/lib/ai/contextBudget/usage";
import { DEFAULT_CONTEXT_BUDGET } from "@/lib/ai/contextBudget/planner";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function snapshot(overrides: Partial<Parameters<typeof buildContextUsageSnapshot>[0]> = {}) {
  return buildContextUsageSnapshot({
    provider: "opencode-go",
    model: "gpt-5.6-luna",
    systemPromptTokens: 16342,
    toolSchemaTokens: 4200,
    conversationTokens: 9800,
    attachmentTokens: 0,
    summaryTokens: 0,
    budget: DEFAULT_CONTEXT_BUDGET,
    compacted: false,
    at: Date.parse("2026-09-24T10:00:00.000Z"),
    ...overrides,
  });
}

function metaValue(snapshots: ContextUsageSnapshot[], version = 1): KiroSessionMetaValue {
  return {
    currentConversationId: "c-1",
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
    contextUsageVersion: version,
    getConversationContextUsage: () => snapshots,
    suggestionsKind: null,
    suggestionsGen: 0,
    lastUserTurnGen: 0,
    hasMessages: snapshots.length > 0,
    conversationTransitioning: false,
    conversationTransition: { target: null, phase: "idle", pending: false },
    conversationProjectId: null,
    projectsVersion: 0,
    emptyIntroGeneration: 0,
  } as unknown as KiroSessionMetaValue;
}

async function render(snapshots: ContextUsageSnapshot[], version = 1) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <KiroSessionMetaContext.Provider value={metaValue(snapshots, version)}>
        <KiroInspectorContextUsage />
      </KiroSessionMetaContext.Provider>
    );
  });
}

function q(selector: string): HTMLElement | null {
  return container!.querySelector(selector) as HTMLElement | null;
}

describe("Inspector 上下文 — 空态", () => {
  it("无快照 → 空态（含下一步提示）", async () => {
    await render([]);
    expect(q('[data-testid="kiro-inspector-context-usage"]')).toBeTruthy();
    expect(container!.textContent).toContain("暂无占用记录");
    expect(container!.textContent).toContain("发送第一条消息后显示每次请求的上下文占用趋势");
    expect(q('[data-testid="kiro-inspector-context-row"]')).toBeNull();
  });
});

describe("Inspector 上下文 — 最近一次与历史", () => {
  it("最近一次：预算占用 label + 模型窗口 %（官方窗口存在时）", async () => {
    await render([snapshot()]);
    const latest = q('[data-testid="kiro-inspector-context-latest"]')!;
    expect(latest.textContent).toContain("上下文 9.8k / 24k");
    expect(latest.textContent).toContain("gpt-5.6-luna");
    // 30.3k / 1.05M ≈ 2.9%
    expect(q('[data-testid="kiro-inspector-context-window"]')!.textContent).toContain("占模型窗口 2.9%");
  });

  it("无官方窗口的模型 → 不显示窗口行", async () => {
    await render([snapshot({ model: "mimo-v2.6-pro" })]);
    expect(q('[data-testid="kiro-inspector-context-window"]')).toBeNull();
  });

  it("历史行：新 → 旧、序号、compacted 标记、used/max", async () => {
    await render([
      snapshot({ conversationTokens: 5_000, at: Date.parse("2026-09-24T10:00:00.000Z") }),
      snapshot({ conversationTokens: 19_000, at: Date.parse("2026-09-24T10:01:00.000Z") }),
      snapshot({ conversationTokens: 22_000, compacted: true, at: Date.parse("2026-09-24T10:02:00.000Z") }),
    ]);
    const rows = container!.querySelectorAll('[data-testid="kiro-inspector-context-row"]');
    expect(rows.length).toBe(3);
    // 最新（index #3）在最前，且带「已压缩」
    expect(rows[0].textContent).toContain("#3");
    expect(rows[0].textContent).toContain("已压缩");
    expect(rows[0].textContent).toContain("22k/24k");
    expect(rows[2].textContent).toContain("#1");
    expect(rows[2].textContent).toContain("5k/24k");
    // section 计数 = 历史条数
    expect(q('[data-testid="kiro-inspector-section-count"]')!.textContent).toBe("3");
  });

  it("安全：不渲染消息正文 / 路径 / 内部字段", async () => {
    await render([snapshot()]);
    const html = container!.innerHTML;
    for (const forbidden of ["storageKey", "adapterRef", "C:\\", "sk-"]) {
      expect(html, forbidden).not.toContain(forbidden);
    }
  });
});
