// @vitest-environment node
/**
 * 上下文占用（Codex-style 指示）— 客户端 view / 持久化 / 恢复 round-trip。
 *
 * 覆盖：UIMessage metadata → view（归一化 / 非法忽略）；sanitizeConversation 持久化
 * 有界快照；历史记录无字段 → 不写入（旧记录免迁移）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildKiroMessageView } from "@/hooks/useKiroChat";
import { sanitizeConversation } from "@/lib/ai/history/sanitize";
import { buildContextUsageSnapshot } from "@/lib/ai/contextBudget/usage";
import { DEFAULT_CONTEXT_BUDGET } from "@/lib/ai/contextBudget/planner";
import type { KiroChatMessageView } from "@/hooks/useKiroChat";

function usage(overrides: Partial<Parameters<typeof buildContextUsageSnapshot>[0]> = {}) {
  return buildContextUsageSnapshot({
    provider: "opencode-go",
    model: "deepseek-v4.1-flash",
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

function assistantMessage(metadata?: Record<string, unknown>) {
  return {
    id: "m-1",
    role: "assistant" as const,
    parts: [{ type: "text", text: "answer" }],
    metadata,
  };
}

describe("buildKiroMessageView — 快照读取", () => {
  it("metadata.contextUsage → view.contextUsage（归一化后）", () => {
    const view = buildKiroMessageView(assistantMessage({ contextUsage: usage() }) as never, false);
    expect(view.contextUsage).toEqual(usage());
    expect(view.content).toBe("answer");
  });

  it("无 metadata / 非法快照 → undefined（不猜测，不崩溃）", () => {
    expect(buildKiroMessageView(assistantMessage() as never, false).contextUsage).toBeUndefined();
    expect(
      buildKiroMessageView(assistantMessage({ contextUsage: { version: 99 } }) as never, false).contextUsage
    ).toBeUndefined();
    expect(
      buildKiroMessageView(assistantMessage({ contextUsage: "not-an-object" }) as never, false).contextUsage
    ).toBeUndefined();
  });

  it("user message 不携带快照（快照只属于 assistant 请求结果）", () => {
    const view = buildKiroMessageView(
      { id: "u-1", role: "user", parts: [{ type: "text", text: "hi" }], metadata: { contextUsage: usage() } } as never,
      false
    );
    expect(view.contextUsage).toBeUndefined();
  });

  it("历史恢复消息（restored=1）同样读取快照", () => {
    const view = buildKiroMessageView(
      assistantMessage({ restored: "1", contextUsage: usage({ conversationTokens: 19_000 }) }) as never,
      false
    );
    expect(view.contextUsage?.conversationBudget.used).toBe(19_000);
    expect(view.restored).toBe(true);
  });
});

describe("接线守卫（源码锁定）", () => {
  it("chat route：算完 plan / tools 后构建快照，并通过 messageMetadata 下发", () => {
    const route = readFileSync(join(process.cwd(), "app/api/ai/chat/route.ts"), "utf8");
    expect(route).toContain("buildContextUsageSnapshot(");
    // 工具两层暴露：快照按实际下发集计量（tierFull 全量 / 首轮 core 集），不用无条件全量
    expect(route).toContain("estimateToolSchemaTokens(snapshotTools)");
    expect(route).toContain("const snapshotTools = tierFull");
    expect(route).toContain("messageMetadata:");
    expect(route).toContain('part.type === "start" || part.type === "finish"');
    // 只传数字（不把消息正文 / 附件名放进快照）
    expect(route).toContain("conversationTokens: plan.budgetReport.estimatedTokens");
    expect(route).not.toContain("contextUsage: { messages");
  });

  it("hook：view 构建与历史恢复都走归一化", () => {
    const hook = readFileSync(join(process.cwd(), "hooks/useKiroChat.ts"), "utf8");
    expect(hook).toContain("normalizeContextUsageSnapshot(");
    // S-fix：恢复 metadata 经 buildRestoredMessageMetadata 构造（含 restored 标记 + toolScope 透传）
    expect(hook).toContain("buildRestoredMessageMetadata(pm)");
    expect(hook).toContain("contextUsage: latestContextUsage");
    expect(hook).toContain('contextOverflow: normalizedError?.code === "CONTEXT_TOO_LARGE"');
  });

  it("Composer / Surface：ring 位于右组（思考程度之前），由 Surface 注入快照", () => {
    const composer = readFileSync(join(process.cwd(), "components/kiro/KiroComposer.tsx"), "utf8");
    const usageIndex = composer.indexOf("<KiroComposerContextUsage");
    const reasoningIndex = composer.indexOf("<KiroComposerReasoningControl");
    expect(usageIndex).toBeGreaterThan(-1);
    expect(reasoningIndex).toBeGreaterThan(usageIndex);
    const surface = readFileSync(join(process.cwd(), "components/kiro/KiroChatSurface.tsx"), "utf8");
    expect(surface).toContain("contextUsage={chat.contextUsage}");
    expect(surface).toContain("contextOverflow={chat.contextOverflow}");
  });

  it("展示层不写预算 / 压缩逻辑（只读快照）", () => {
    for (const file of [
      "components/kiro/composer/KiroComposerContextUsage.tsx",
      "lib/ai/contextBudget/usage.ts",
    ]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source, file).not.toContain("shouldCompact(");
      expect(source, file).not.toContain("maxInputTokens =");
    }
  });
});

describe("sanitizeConversation — 快照持久化", () => {
  function viewWithUsage(overrides: Partial<KiroChatMessageView> = {}): KiroChatMessageView {
    return {
      id: "m-1",
      role: "assistant",
      content: "answer",
      streaming: false,
      canRegenerate: false,
      contextUsage: usage(),
      ...overrides,
    } as KiroChatMessageView;
  }

  function sanitize(messages: KiroChatMessageView[]) {
    return sanitizeConversation({
      id: "c-1",
      title: "t",
      createdAt: "2026-09-24T09:00:00.000Z",
      provider: "opencode-go",
      model: "deepseek-v4.1-flash",
      messages,
      manualRefs: [],
      entryRefs: [],
    });
  }

  it("assistant 快照写入持久化记录（有界字段）", () => {
    const record = sanitize([viewWithUsage()]);
    expect(record.messages[0].contextUsage).toEqual(usage());
  });

  it("无快照 → 不写字段（旧记录形态保持）", () => {
    const record = sanitize([viewWithUsage({ contextUsage: undefined })]);
    expect(record.messages[0].contextUsage).toBeUndefined();
    expect("contextUsage" in record.messages[0]).toBe(false);
  });

  it("非法快照（被篡改 / 旧版本）→ 丢弃，不写入", () => {
    const record = sanitize([
      viewWithUsage({ contextUsage: { version: 99, totalEstimatedTokens: -1 } as never }),
    ]);
    expect(record.messages[0].contextUsage).toBeUndefined();
  });

  it("持久化内容不含消息正文 / 附件名（只数字 + model）", () => {
    const record = sanitize([viewWithUsage({ content: "secret answer" })]);
    const serialized = JSON.stringify(record.messages[0].contextUsage);
    expect(serialized).not.toContain("secret answer");
    expect(serialized).not.toContain("sk-");
    expect(Object.keys(record.messages[0].contextUsage!).sort()).toEqual(
      ["at", "breakdown", "conversationBudget", "model", "provider", "totalEstimatedTokens", "version"].sort()
    );
  });
});
