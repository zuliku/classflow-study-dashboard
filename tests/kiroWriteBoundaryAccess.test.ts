import { describe, expect, it } from "vitest";
import {
  getKiroToolsForRequest,
  resolveKiroBusinessWriteAccess,
} from "@/lib/ai/tools";
import { buildKiroWriteAccessSection } from "@/lib/ai/prompts/kiroSystemPrompt";

/**
 * Kiro 写边界：
 * - Plan（Computer ON + agentMode=plan）→ 业务写只读；
 * - 默认（Chat / guided / workspace-auto）→ approval，保持既有写能力；
 * - 只读时读取 / proposal 工具仍存在，Write Tools 与 apply_change_set 不暴露。
 */
describe("Kiro business write access", () => {
  it("Plan 模式 → none；其它模式 → approval", () => {
    expect(resolveKiroBusinessWriteAccess({ enabled: true, agentMode: "plan" })).toBe("none");
    expect(resolveKiroBusinessWriteAccess({ enabled: true, agentMode: "guided" })).toBe("approval");
    expect(resolveKiroBusinessWriteAccess({ enabled: true, agentMode: "workspace-auto" })).toBe("approval");
    expect(resolveKiroBusinessWriteAccess({ enabled: false, agentMode: "plan" })).toBe("approval");
  });

  it("writeAccess=none 移除全部业务写工具，但保留读取 / proposal", () => {
    const tools = getKiroToolsForRequest({
      computerSnapshot: { enabled: true, agentMode: "plan" },
      businessWriteAccess: "none",
    });
    expect(tools.create_assignment).toBeUndefined();
    expect(tools.apply_change_set).toBeUndefined();
    expect(tools.set_assignment_status).toBeUndefined();
    expect(tools.search_assignments).toBeDefined();
    expect(tools.propose_study_plan).toBeDefined();
    expect(tools.get_weekly_brief).toBeDefined();
  });

  it("writeAccess=approval 保留写工具（默认行为不变）", () => {
    const tools = getKiroToolsForRequest({});
    expect(tools.create_assignment).toBeDefined();
    expect(tools.apply_change_set).toBeDefined();
    expect(tools.set_assignment_status).toBeDefined();
  });

  it("Plan prompt 明确解释只读；approval 不追加噪音", () => {
    const readonly = buildKiroWriteAccessSection("none");
    expect(readonly).toContain("只读");
    expect(readonly).toContain("不会提供任何业务写工具");
    expect(buildKiroWriteAccessSection("approval")).toBe("");
  });
});
