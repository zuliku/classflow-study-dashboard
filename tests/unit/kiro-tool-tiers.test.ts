import { describe, it, expect } from "vitest";
import {
  DEFERRED_TOOL_NAMES,
  isDeferredTool,
  turnHasBusinessToolCalls,
  resolveTieredActiveTools,
} from "@/lib/ai/tools/tiers";
import { getKiroToolsForRequest } from "@/lib/ai/tools";
import { estimateToolSchemaTokens } from "@/lib/ai/contextBudget/usage";

const BOUNDARY = "tool-begin_final_answer";

describe("turnHasBusinessToolCalls（本轮业务工具判定）", () => {
  it("无 user / 空 → false；终答边界信号不算", () => {
    expect(turnHasBusinessToolCalls([])).toBe(false);
    expect(
      turnHasBusinessToolCalls([{ role: "assistant", parts: [{ type: BOUNDARY }] }])
    ).toBe(false);
    expect(
      turnHasBusinessToolCalls([
        { role: "user", parts: [{ type: "text" }] },
        { role: "assistant", parts: [{ type: BOUNDARY }] },
      ])
    ).toBe(false);
  });
  it("本轮业务工具 → true；历史轮工具不算", () => {
    expect(
      turnHasBusinessToolCalls([
        { role: "user", parts: [{ type: "text" }] },
        { role: "assistant", parts: [{ type: "tool-search_assignments" }] },
      ])
    ).toBe(true);
    expect(
      turnHasBusinessToolCalls([
        { role: "assistant", parts: [{ type: "tool-read_text" }] },
        { role: "user", parts: [{ type: "text" }] },
        { role: "assistant", parts: [{ type: "text" }] },
      ])
    ).toBe(false);
  });
});

describe("resolveTieredActiveTools", () => {
  const names = ["read_text", "create_document", "begin_final_answer"];
  it("全量/已解锁 → null（不限制）；tiered 未解锁 → core 名单", () => {
    expect(resolveTieredActiveTools({ tiered: false, unlocked: false, toolNames: names })).toBeNull();
    expect(resolveTieredActiveTools({ tiered: true, unlocked: true, toolNames: names })).toBeNull();
    expect(resolveTieredActiveTools({ tiered: true, unlocked: false, toolNames: names })).toEqual([
      "read_text",
      "begin_final_answer",
    ]);
  });
  it("空 core → null（绝不发空 activeTools）", () => {
    expect(resolveTieredActiveTools({ tiered: true, unlocked: false, toolNames: ["create_document"] })).toBeNull();
    expect(resolveTieredActiveTools({ tiered: true, unlocked: false, toolNames: [] })).toBeNull();
  });
});

describe("deferred 名单卫生 + 节省量", () => {
  it("deferred 全部存在于全量暴露集；begin_final_answer 永不延迟", () => {
    const full = getKiroToolsForRequest({
      computerSnapshot: {
        enabled: true,
        agentMode: "workspace-auto",
        terminalEnabled: true,
        terminalAvailable: true,
        hasNativeRoot: true,
        desktopControlEnabled: true,
        desktopControlAvailable: true,
        desktopActionEnabled: true,
        desktopActionAvailable: true,
      } as never,
    }) as Record<string, unknown>;
    const fullNames = Object.keys(full);
    for (const name of DEFERRED_TOOL_NAMES) {
      expect(fullNames, name).toContain(name);
    }
    expect(isDeferredTool("begin_final_answer")).toBe(false);
    // 节省量护栏：deferred 剔除后估算下降显著（防名单被悄悄掏空导致特性名存实亡）
    const core = Object.fromEntries(Object.entries(full).filter(([n]) => !isDeferredTool(n)));
    const saved = estimateToolSchemaTokens(full) - estimateToolSchemaTokens(core);
    console.log(`[tiers] full=${estimateToolSchemaTokens(full)} core=${estimateToolSchemaTokens(core)} saved=${saved}`);
    expect(saved).toBeGreaterThan(20_000);
  });
});
