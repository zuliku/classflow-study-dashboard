import { describe, it, expect } from "vitest";
import { getKiroToolsForRequest } from "@/lib/ai/tools";
import { COMPUTER_READ_TOOLS, COMPUTER_TOOLS } from "@/lib/ai/computer/tools/registry";
import { ToolSet } from "ai";

function snapshot(
  overrides: {
    enabled?: boolean;
    agentMode?: "plan" | "guided" | "workspace-auto";
    desktopControlEnabled?: boolean;
    desktopControlAvailable?: boolean;
  } = {}
) {
  return {
    enabled: overrides.enabled ?? true,
    agentMode: overrides.agentMode ?? "workspace-auto",
    desktopControlEnabled: overrides.desktopControlEnabled,
    desktopControlAvailable: overrides.desktopControlAvailable,
  };
}

describe("observe_desktop Tool Exposure 与桌面临界 Capability 同源", () => {
  it.each(["plan", "guided", "workspace-auto"] as const)(
    "ready（全部 Gate true）+ %s → observe_desktop 暴露",
    (agentMode) => {
      const set = getKiroToolsForRequest({
        computerSnapshot: snapshot({
          agentMode,
          desktopControlEnabled: true,
          desktopControlAvailable: true,
        }),
      });
      expect(set).toHaveProperty("observe_desktop");
    }
  );

  it("computer disabled → 不暴露（基础 Kiro 工具仍在）", () => {
    const set = getKiroToolsForRequest({
      computerSnapshot: snapshot({ enabled: false, desktopControlEnabled: true, desktopControlAvailable: true }),
    });
    expect(set).not.toHaveProperty("observe_desktop");
    expect(set).toHaveProperty("begin_final_answer");
  });

  it("desktopControl disabled（用户未开启）→ 不暴露", () => {
    const set = getKiroToolsForRequest({
      computerSnapshot: snapshot({ desktopControlEnabled: false, desktopControlAvailable: true }),
    });
    expect(set).not.toHaveProperty("observe_desktop");
  });

  it("desktopControl unavailable（Web runtime / 无 Bridge）→ 不暴露", () => {
    const set = getKiroToolsForRequest({
      computerSnapshot: snapshot({ desktopControlEnabled: true, desktopControlAvailable: false }),
    });
    expect(set).not.toHaveProperty("observe_desktop");
  });

  it("字段缺失 → 不暴露（fail closed）", () => {
    const set = getKiroToolsForRequest({ computerSnapshot: snapshot({}) });
    expect(set).not.toHaveProperty("observe_desktop");
  });

  it("隐藏 observe_desktop 时其它 Computer 工具不受影响", () => {
    const set = getKiroToolsForRequest({
      computerSnapshot: snapshot({ desktopControlEnabled: false, desktopControlAvailable: false }),
    });
    expect(set).toHaveProperty("read_text");
    expect(set).toHaveProperty("create_directory");
    expect(set).toHaveProperty("list_workspace_roots");
  });

  it("类型检查：返回合法 ToolSet", () => {
    const set: ToolSet = getKiroToolsForRequest({
      computerSnapshot: snapshot({ desktopControlEnabled: true, desktopControlAvailable: true }),
    });
    expect(typeof set).toBe("object");
  });
});

describe("observe_desktop 工具定义", () => {
  it("注册为只读工具（capability=screen.observe；mutation=false）", () => {
    const def = COMPUTER_TOOLS.find((t) => t.name === "observe_desktop");
    expect(def).toBeDefined();
    expect(def?.capability).toBe("screen.observe");
    expect(def?.mutation).toBe(false);
    expect(COMPUTER_READ_TOOLS.some((t) => t.name === "observe_desktop")).toBe(true);
  });

  it("工具名不存在于 mutation 名单（不会触发 regenerate guard）", async () => {
    const { COMPUTER_MUTATION_TOOL_NAMES } = await import("@/lib/ai/computer/tools/registry");
    expect(COMPUTER_MUTATION_TOOL_NAMES.has("observe_desktop")).toBe(false);
  });
});
