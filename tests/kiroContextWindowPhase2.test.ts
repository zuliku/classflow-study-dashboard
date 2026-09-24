// @vitest-environment node
/**
 * Phase 2 — 模型窗口 % + Inspector 上下文历史（纯函数）。
 *
 * 覆盖：官方可核实 contextWindowTokens（只填有文档的模型，缺失不猜）；M 级格式化；
 * resolveModelWindowUsage（分母 = 模型窗口，分子 = 本请求总估算输入）；Inspector 历史
 * （新 → 旧、bounded、ratio clamp、tone、compacted 标记、provider 透传）。
 */
import { describe, it, expect } from "vitest";
import {
  formatContextUsageTokens,
  resolveModelWindowUsage,
  buildContextUsageSnapshot,
} from "@/lib/ai/contextBudget/usage";
import { DEFAULT_CONTEXT_BUDGET } from "@/lib/ai/contextBudget/planner";
import { OPENCODE_MODELS } from "@/lib/ai/providers/openCodeGo";
import { DEEPSEEK_MODELS } from "@/lib/ai/providers/deepseek";
import { getModelContextWindowTokens } from "@/lib/ai/providers/registry";
import {
  INSPECTOR_CONTEXT_USAGE_LIMIT,
  buildInspectorContextUsageHistory,
} from "@/lib/ai/ui/kiroInspector";

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

describe("官方可核实 contextWindowTokens", () => {
  it("已核实的 OpenCode Go 模型（值来自厂商官方文档）", () => {
    const byId = new Map(OPENCODE_MODELS.map((m) => [m.id, m]));
    expect(byId.get("gpt-5.6-luna")?.contextWindowTokens).toBe(1_050_000); // OpenAI 模型页
    expect(byId.get("grok-4.7")?.contextWindowTokens).toBe(500_000); // xAI Models & Pricing
    expect(byId.get("grok-4.6")?.contextWindowTokens).toBe(500_000);
    expect(byId.get("kimi-k3")?.contextWindowTokens).toBe(1_000_000); // Kimi 官方 quickstart
    expect(byId.get("kimi-k2.7-code")?.contextWindowTokens).toBe(262_144); // Kimi 官方 256K
    expect(byId.get("deepseek-v4.1-flash")?.contextWindowTokens).toBe(1_000_000); // DeepSeek 官方 1M
    expect(byId.get("glm-5.3")?.contextWindowTokens).toBe(1_000_000); // Z.ai 官方 1M
    expect(byId.get("glm-5.3-flash")?.contextWindowTokens).toBe(1_000_000); // Z.ai 官方 1M
    expect(byId.get("qwen3.8-max")?.contextWindowTokens).toBe(1_000_000); // 阿里云百炼 1M
    expect(byId.get("qwen3.7-plus")?.contextWindowTokens).toBe(1_000_000);
    expect(byId.get("qwen3.8-flash")?.contextWindowTokens).toBe(1_000_000);
    expect(byId.get("minimax-m3")?.contextWindowTokens).toBe(1_000_000); // MiniMax 官方表
    expect(byId.get("minimax-m2.7")?.contextWindowTokens).toBe(204_800);
    expect(byId.get("mimo-v2-omni")?.contextWindowTokens).toBe(262_144); // 小米官方 256K
  });

  it("DeepSeek 内置 provider 模型同样标注（官方 1M）", () => {
    for (const model of DEEPSEEK_MODELS) {
      expect(model.contextWindowTokens, model.id).toBe(1_000_000);
    }
  });

  it("无官方证据的模型保持 undefined（绝不猜测）", () => {
    const byId = new Map(OPENCODE_MODELS.map((m) => [m.id, m]));
    for (const id of [
      "muse-spark-1.3-contributor",
      "mimo-v2.5",
      "mimo-v2.5-pro",
      "mimo-v2.6-pro",
      "hy3",
      "hy4-preview",
      "longcat-2.0",
    ]) {
      expect(byId.get(id)?.contextWindowTokens, id).toBeUndefined();
    }
  });

  it("getModelContextWindowTokens：provider 映射正确；custom / 未知 → undefined", () => {
    expect(getModelContextWindowTokens({ provider: "opencode-go", model: "kimi-k3" })).toBe(1_000_000);
    expect(getModelContextWindowTokens({ provider: "deepseek", model: "deepseek-v4-flash" })).toBe(1_000_000);
    expect(getModelContextWindowTokens({ provider: "opencode-go", model: "not-a-model" })).toBeUndefined();
    expect(getModelContextWindowTokens({ provider: "custom-openai", model: "kimi-k3" })).toBeUndefined();
  });
});

describe("formatContextUsageTokens（M 级）", () => {
  it("千 / 百万级紧凑显示", () => {
    expect(formatContextUsageTokens(500_000)).toBe("500k");
    expect(formatContextUsageTokens(1_000_000)).toBe("1M");
    expect(formatContextUsageTokens(1_050_000)).toBe("1.05M");
    expect(formatContextUsageTokens(204_800)).toBe("205k");
  });
});

describe("resolveModelWindowUsage", () => {
  it("无窗口 / 无快照 → null（UI 不显示百分比）", () => {
    expect(resolveModelWindowUsage(snapshot(), undefined)).toBeNull();
    expect(resolveModelWindowUsage(snapshot(), null)).toBeNull();
    expect(resolveModelWindowUsage(null, 1_000_000)).toBeNull();
    expect(resolveModelWindowUsage(snapshot(), 0)).toBeNull();
    expect(resolveModelWindowUsage(snapshot(), Number.NaN)).toBeNull();
  });

  it("分母 = 模型窗口；分子 = 系统提示 + 工具 + 对话", () => {
    const s = snapshot({ systemPromptTokens: 16_342, toolSchemaTokens: 4_200, conversationTokens: 9_800 });
    const usage = resolveModelWindowUsage(s, 1_050_000)!;
    const expectedPercent = ((16_342 + 4_200 + 9_800) / 1_050_000) * 100;
    expect(usage.percent).toBe(Math.round(expectedPercent * 10) / 10);
    expect(usage.label).toBe("占模型窗口 2.9%（估算 30.3k / 1.05M）");
  });

  it("占比超过 100% 也如实显示（不 clamp 到 100）", () => {
    const s = snapshot({ systemPromptTokens: 60_000, toolSchemaTokens: 0, conversationTokens: 60_000 });
    const usage = resolveModelWindowUsage(s, 100_000)!;
    expect(usage.percent).toBe(120);
    expect(usage.label).toContain("120%");
  });
});

describe("buildInspectorContextUsageHistory", () => {
  it("新 → 旧；序号按时间顺序；bounded（默认 8）", () => {
    const snapshots = Array.from({ length: 12 }, (_, i) =>
      snapshot({ conversationTokens: 1000 + i * 100, at: Date.parse("2026-09-24T10:00:00.000Z") + i * 60_000 })
    );
    const rows = buildInspectorContextUsageHistory(snapshots);
    expect(rows).toHaveLength(INSPECTOR_CONTEXT_USAGE_LIMIT);
    // 最新在最前（index = 12），最旧的在末尾（index = 5）
    expect(rows[0].index).toBe(12);
    expect(rows[rows.length - 1].index).toBe(5);
    expect(rows[0].used).toBe(1000 + 11 * 100);
  });

  it("ratio clamp 0..1；tone 与压缩阈值一致；compacted / provider 透传", () => {
    const rows = buildInspectorContextUsageHistory([
      snapshot({ conversationTokens: 5_000 }),
      snapshot({ conversationTokens: 19_000 }),
      snapshot({ conversationTokens: 26_000, compacted: true }),
    ]);
    // 新 → 旧
    expect(rows[0].tone).toBe("danger");
    expect(rows[0].compacted).toBe(true);
    expect(rows[0].ratio).toBe(1);
    expect(rows[1].tone).toBe("warn");
    expect(rows[2].tone).toBe("ok");
    expect(rows[0].provider).toBe("opencode-go");
    expect(rows[0].max).toBe(24_000);
  });

  it("空输入 → 空数组；limit 生效", () => {
    expect(buildInspectorContextUsageHistory([])).toEqual([]);
    const many = Array.from({ length: 5 }, () => snapshot());
    expect(buildInspectorContextUsageHistory(many, { limit: 2 })).toHaveLength(2);
  });
});
