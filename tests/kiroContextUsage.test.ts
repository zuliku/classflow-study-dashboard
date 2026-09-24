// @vitest-environment node
/**
 * 上下文占用（Codex-style 指示）— 纯函数测试。
 *
 * 覆盖：快照构建 / tone 阈值（warn = 压缩阈值）/ 紧凑格式化 / 明细文案 /
 * 工具 schema 估算（bounded、函数忽略、循环安全）/ 持久化归一（version + 有界数字）。
 */
import { describe, it, expect } from "vitest";
import {
  CONTEXT_USAGE_VERSION,
  buildContextUsageSnapshot,
  estimateToolSchemaTokens,
  formatContextUsageDetail,
  formatContextUsageLabel,
  formatContextUsageTokens,
  normalizeContextUsageSnapshot,
  resolveContextUsageTone,
} from "@/lib/ai/contextBudget/usage";
import { CONTEXT_COMPACT_RATIO, DEFAULT_CONTEXT_BUDGET, shouldCompact } from "@/lib/ai/contextBudget/planner";

function snapshot(overrides: Partial<Parameters<typeof buildContextUsageSnapshot>[0]> = {}) {
  return buildContextUsageSnapshot({
    provider: "opencode-go",
    model: "deepseek-v4.1-flash",
    systemPromptTokens: 16342,
    toolSchemaTokens: 4200,
    conversationTokens: 9800,
    attachmentTokens: 1200,
    summaryTokens: 800,
    budget: DEFAULT_CONTEXT_BUDGET,
    compacted: false,
    at: Date.parse("2026-09-24T10:00:00.000Z"),
    ...overrides,
  });
}

describe("buildContextUsageSnapshot", () => {
  it("total = 系统提示 + 工具 + 对话；breakdown 原样保留；compactAt = 预算 × 75%", () => {
    const s = snapshot();
    expect(s.version).toBe(CONTEXT_USAGE_VERSION);
    expect(s.totalEstimatedTokens).toBe(16342 + 4200 + 9800);
    expect(s.breakdown).toEqual({
      systemPromptTokens: 16342,
      toolSchemaTokens: 4200,
      conversationTokens: 9800,
      attachmentTokens: 1200,
      summaryTokens: 800,
    });
    expect(s.conversationBudget.max).toBe(24_000);
    expect(s.conversationBudget.compactAt).toBe(18_000);
    expect(s.conversationBudget.compacted).toBe(false);
    expect(s.at).toBe("2026-09-24T10:00:00.000Z");
    expect(s.provider).toBe("opencode-go");
    expect(s.model).toBe("deepseek-v4.1-flash");
  });

  it("负数 / 非有限值被 clamp；compacted 透传", () => {
    const s = snapshot({ systemPromptTokens: -5, toolSchemaTokens: Number.NaN, compacted: true });
    expect(s.breakdown.systemPromptTokens).toBe(0);
    expect(Number.isFinite(s.breakdown.toolSchemaTokens)).toBe(true);
    expect(s.conversationBudget.compacted).toBe(true);
  });

  it("compactAt 与 shouldCompact 使用同一阈值（单一事实来源）", () => {
    const s = snapshot();
    expect(s.conversationBudget.compactAt).toBe(DEFAULT_CONTEXT_BUDGET.maxInputTokens * CONTEXT_COMPACT_RATIO);
    expect(shouldCompact(s.conversationBudget.compactAt, DEFAULT_CONTEXT_BUDGET)).toBe(true);
    expect(shouldCompact(s.conversationBudget.compactAt - 1, DEFAULT_CONTEXT_BUDGET)).toBe(false);
  });
});

describe("resolveContextUsageTone", () => {
  it("无快照 → unknown", () => {
    expect(resolveContextUsageTone(null)).toBe("unknown");
    expect(resolveContextUsageTone(undefined)).toBe("unknown");
  });

  it("< 75% → ok；≥ 75% → warn（将自动压缩）；> max → danger", () => {
    expect(resolveContextUsageTone(snapshot({ conversationTokens: 17_999 }))).toBe("ok");
    expect(resolveContextUsageTone(snapshot({ conversationTokens: 18_000 }))).toBe("warn");
    expect(resolveContextUsageTone(snapshot({ conversationTokens: 23_000 }))).toBe("warn");
    expect(resolveContextUsageTone(snapshot({ conversationTokens: 24_001 }))).toBe("danger");
  });
});

describe("格式化", () => {
  it("formatContextUsageTokens 紧凑显示", () => {
    expect(formatContextUsageTokens(0)).toBe("0");
    expect(formatContextUsageTokens(980)).toBe("980");
    expect(formatContextUsageTokens(9800)).toBe("9.8k");
    expect(formatContextUsageTokens(12_400)).toBe("12.4k");
    expect(formatContextUsageTokens(24_000)).toBe("24k");
    expect(formatContextUsageTokens(120_000)).toBe("120k");
  });

  it("formatContextUsageLabel：未知 / ok / warn / 超预算", () => {
    expect(formatContextUsageLabel(null)).toBe("上下文：等待首次请求");
    expect(formatContextUsageLabel(null, { overflow: true })).toBe("上下文：已超出输入预算");
    expect(formatContextUsageLabel(snapshot({ conversationTokens: 9800 }))).toBe("上下文 9.8k / 24k");
    expect(formatContextUsageLabel(snapshot({ conversationTokens: 19_000 }))).toBe(
      "上下文 19k / 24k · 较早对话将自动压缩"
    );
    expect(formatContextUsageLabel(snapshot({ conversationTokens: 25_000 }))).toContain("已超出输入预算");
    expect(formatContextUsageLabel(snapshot({ conversationTokens: 1000 }), { overflow: true })).toContain(
      "已超出输入预算"
    );
  });

  it("formatContextUsageDetail：对话 / 固定开销 / 压缩说明", () => {
    const detail = formatContextUsageDetail(snapshot())!;
    expect(detail.conversation).toBe("对话上下文 9.8k / 24k");
    expect(detail.fixed).toContain("固定开销（不计入压缩预算）");
    expect(detail.fixed).toContain("系统提示 ~16.3k");
    expect(detail.fixed).toContain("工具定义 ~4.2k");
    expect(detail.compact).toBe("达到 18k 时会自动压缩较早对话");
    expect(formatContextUsageDetail(null)).toBeNull();

    const compacted = formatContextUsageDetail(snapshot({ compacted: true }))!;
    expect(compacted.compact).toContain("本 Turn 已使用更激进的裁剪");
  });
});

describe("estimateToolSchemaTokens", () => {
  it("忽略函数字段；空输入 → 0", () => {
    expect(estimateToolSchemaTokens(null)).toBe(0);
    expect(estimateToolSchemaTokens(undefined)).toBe(0);
    expect(estimateToolSchemaTokens({})).toBeGreaterThan(0);
    const withFn = estimateToolSchemaTokens({
      a: { description: "x".repeat(300), inputSchema: { type: "object" }, execute: () => 1 },
    });
    const withoutFn = estimateToolSchemaTokens({
      a: { description: "x".repeat(300), inputSchema: { type: "object" } },
    });
    expect(withFn).toBe(withoutFn);
    expect(withFn).toBeGreaterThan(50);
  });

  it("循环引用不抛异常（返回 0）", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(estimateToolSchemaTokens(circular)).toBe(0);
  });
});

describe("normalizeContextUsageSnapshot（持久化防御）", () => {
  it("合法快照 round-trip", () => {
    const s = snapshot();
    expect(normalizeContextUsageSnapshot(s)).toEqual(s);
  });

  it("version 不匹配 / 缺字段 / 非法数字 / 非对象 → null", () => {
    expect(normalizeContextUsageSnapshot({ ...snapshot(), version: 2 })).toBeNull();
    expect(normalizeContextUsageSnapshot({})).toBeNull();
    expect(normalizeContextUsageSnapshot(null)).toBeNull();
    expect(normalizeContextUsageSnapshot("x")).toBeNull();
    const s = snapshot() as unknown as Record<string, unknown>;
    const broken = { ...s, breakdown: { ...(s.breakdown as object), systemPromptTokens: -1 } };
    expect(normalizeContextUsageSnapshot(broken)).toBeNull();
    const nan = { ...s, totalEstimatedTokens: Number.NaN };
    expect(normalizeContextUsageSnapshot(nan)).toBeNull();
  });

  it("字符串字段被截断（不读取自由文本）", () => {
    const s = snapshot() as unknown as Record<string, unknown>;
    const normalized = normalizeContextUsageSnapshot({
      ...s,
      at: "x".repeat(500),
      model: "m".repeat(500),
      provider: "p".repeat(500),
    })!;
    expect(normalized.at.length).toBe(40);
    expect(normalized.model.length).toBe(80);
    expect(normalized.provider.length).toBe(40);
  });

  it("超大数字被 clamp（有界）", () => {
    const s = snapshot() as unknown as Record<string, unknown>;
    const normalized = normalizeContextUsageSnapshot({
      ...s,
      totalEstimatedTokens: 1e15,
    })!;
    expect(normalized.totalEstimatedTokens).toBe(100_000_000);
  });
});
