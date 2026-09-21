// @vitest-environment node
import { describe, it, expect } from "vitest";
import { getKiroToolsForRequest } from "@/lib/ai/tools";
import { COMPUTER_MUTATION_TOOLS } from "@/lib/ai/computer/tools/registry";

function snapshot(
  overrides: {
    enabled?: boolean;
    agentMode?: "plan" | "guided" | "workspace-auto";
    desktopControlEnabled?: boolean;
    desktopControlAvailable?: boolean;
    desktopActionEnabled?: boolean;
    desktopActionAvailable?: boolean;
  } = {}
) {
  return {
    enabled: overrides.enabled ?? true,
    agentMode: overrides.agentMode ?? "workspace-auto",
    desktopControlEnabled: overrides.desktopControlEnabled ?? true,
    desktopControlAvailable: overrides.desktopControlAvailable ?? true,
    desktopActionEnabled: overrides.desktopActionEnabled ?? true,
    desktopActionAvailable: overrides.desktopActionAvailable ?? true,
  };
}

describe("desktop_action Tool Exposure", () => {
  it.each(["guided", "workspace-auto"] as const)("ready + %s → 暴露", (agentMode) => {
    const set = getKiroToolsForRequest({ computerSnapshot: snapshot({ agentMode }) });
    expect(set).toHaveProperty("desktop_action");
    expect(set).toHaveProperty("observe_desktop");
  });

  it("plan（只读）→ 不暴露 desktop_action（observe 仍暴露）", () => {
    const set = getKiroToolsForRequest({ computerSnapshot: snapshot({ agentMode: "plan" }) });
    expect(set).not.toHaveProperty("desktop_action");
    expect(set).toHaveProperty("observe_desktop");
  });

  it("Desktop control disabled（观察未开启）→ 不暴露", () => {
    const set = getKiroToolsForRequest({
      computerSnapshot: snapshot({ desktopControlEnabled: false }),
    });
    expect(set).not.toHaveProperty("desktop_action");
    expect(set).not.toHaveProperty("observe_desktop");
  });

  it("「允许 Kiro 操作电脑」未开启 → 不暴露（observe 仍暴露）", () => {
    const set = getKiroToolsForRequest({
      computerSnapshot: snapshot({ desktopActionEnabled: false }),
    });
    expect(set).not.toHaveProperty("desktop_action");
    expect(set).toHaveProperty("observe_desktop");
  });

  it("Web runtime / Desktop v1（无 Action Bridge）→ 不暴露", () => {
    const set = getKiroToolsForRequest({
      computerSnapshot: snapshot({ desktopActionAvailable: false }),
    });
    expect(set).not.toHaveProperty("desktop_action");
  });

  it("字段缺失 → 不暴露（fail closed）", () => {
    const set = getKiroToolsForRequest({
      computerSnapshot: {
        enabled: true,
        agentMode: "workspace-auto",
        desktopControlEnabled: true,
        desktopControlAvailable: true,
      },
    });
    expect(set).not.toHaveProperty("desktop_action");
  });

  it("computer disabled → 全部 desktop 工具不存在", () => {
    const set = getKiroToolsForRequest({ computerSnapshot: snapshot({ enabled: false }) });
    expect(set).not.toHaveProperty("desktop_action");
    expect(set).not.toHaveProperty("observe_desktop");
    expect(set).toHaveProperty("begin_final_answer");
  });

  it("隐藏 desktop_action 时其它 Computer 工具不受影响", () => {
    const set = getKiroToolsForRequest({
      computerSnapshot: snapshot({ desktopActionEnabled: false }),
    });
    expect(set).toHaveProperty("read_text");
    expect(set).toHaveProperty("create_directory");
  });
});

describe("desktop_action 工具定义", () => {
  it("注册为 mutation 工具（capability=ui.interact）", () => {
    const def = COMPUTER_MUTATION_TOOLS.find((t) => t.name === "desktop_action");
    expect(def).toBeDefined();
    expect(def?.capability).toBe("ui.interact");
    expect(def?.mutation).toBe(true);
  });

  it("plan mode 工具集不含 mutation（结构上也不暴露）", async () => {
    const { getComputerToolsForMode } = await import("@/lib/ai/computer/tools/registry");
    const names = getComputerToolsForMode("plan").map((t) => t.name);
    expect(names).not.toContain("desktop_action");
    expect(names).toContain("observe_desktop");
  });
});
