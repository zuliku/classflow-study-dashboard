// @vitest-environment node
/**
 * Phase 2 — 官方可核实 contextWindowTokens + 模型窗口口径（纯函数）。
 *
 * 覆盖：只填有官方文档的模型（缺失不猜）；M 级格式化；紧凑三段式在「有窗口 / 无窗口」下的分母切换。
 */
import { describe, it, expect } from "vitest";
import {
  buildContextUsageCompactView,
  buildContextUsageSnapshot,
  formatContextUsageTokens,
} from "@/lib/ai/contextBudget/usage";
import { DEFAULT_CONTEXT_BUDGET } from "@/lib/ai/contextBudget/planner";
import { OPENCODE_MODELS } from "@/lib/ai/providers/openCodeGo";
import { DEEPSEEK_MODELS } from "@/lib/ai/providers/deepseek";
import { getModelContextWindowTokens } from "@/lib/ai/providers/registry";

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
    expect(byId.get("kimi-k3")?.contextWindowTokens).toBe(1_000_000); // Kimi 官方 quickstart
    expect(byId.get("kimi-k2.7-code")?.contextWindowTokens).toBe(262_144); // Kimi 官方 256K
    expect(byId.get("deepseek-v4.1-flash")?.contextWindowTokens).toBe(1_000_000); // DeepSeek 官方 1M
    expect(byId.get("glm-5.3")?.contextWindowTokens).toBe(1_000_000); // Z.ai 官方 1M
    expect(byId.get("glm-5.3-flash")?.contextWindowTokens).toBe(1_000_000); // Z.ai 官方 1M
    expect(byId.get("qwen3.8-max")?.contextWindowTokens).toBe(1_000_000); // 阿里云百炼 1M
    expect(byId.get("qwen3.7-plus")?.contextWindowTokens).toBe(1_000_000);
    expect(byId.get("qwen3.8-flash")?.contextWindowTokens).toBe(1_000_000);
    expect(byId.get("minimax-m3")?.contextWindowTokens).toBe(1_000_000); // MiniMax 官方表
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
      "kimi-k3.1-pro",
      "minimax-m3.1-flash",
      "gemini-4-argon",
      "claude-haiku-5-5",
      "step-5-preview",
      "deepseek-v4-pro",
      "glm-5.2",
      "muse-spark-1.2-contributor",
    ]) {
      expect(byId.get(id)?.contextWindowTokens, id).toBeUndefined();
    }
  });

  it("getModelContextWindowTokens：provider 映射正确；custom / 未知 → undefined", () => {
    expect(getModelContextWindowTokens({ provider: "opencode-go", model: "kimi-k3" })).toBe(1_000_000);
    expect(getModelContextWindowTokens({ provider: "deepseek", model: "deepseek-flash" })).toBe(1_000_000);
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

describe("紧凑三段式：分母切换", () => {
  it("有官方窗口 → 以模型窗口为分母", () => {
    const view = buildContextUsageCompactView(snapshot(), 1_050_000)!;
    expect(view.title).toBe("上下文窗口：");
    expect(view.percentLine).toBe("3% 已用（剩余 97%）");
    expect(view.tokensLine).toBe("已用 30.3k tokens，共 1.05M");
  });

  it("无窗口 → 以输入预算为分母（对话上下文）", () => {
    const view = buildContextUsageCompactView(snapshot(), undefined)!;
    expect(view.title).toBe("对话上下文：");
    expect(view.percentLine).toBe("41% 已用（剩余 59%）");
    expect(view.tokensLine).toBe("已用 9.8k tokens，共 24k");
  });
});
