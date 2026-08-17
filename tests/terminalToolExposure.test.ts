import { describe, it, expect } from "vitest";
import { getKiroToolsForRequest } from "@/lib/ai/tools";
import { ToolSet } from "ai";

function snapshot(overrides: {
  enabled?: boolean;
  terminalEnabled?: boolean;
  terminalAvailable?: boolean;
  hasNativeRoot?: boolean;
  agentMode?: "plan" | "guided" | "workspace-auto";
} = {}) {
  return {
    enabled: overrides.enabled ?? true,
    agentMode: overrides.agentMode ?? "workspace-auto",
    terminalEnabled: overrides.terminalEnabled,
    terminalAvailable: overrides.terminalAvailable,
    hasNativeRoot: overrides.hasNativeRoot,
  };
}

describe("run_terminal_command Tool Exposure 与 Capability 同源", () => {
  it("ready（全部 Gate true）→ run_terminal_command 暴露", () => {
    const set = getKiroToolsForRequest({
      computerSnapshot: snapshot({ terminalEnabled: true, terminalAvailable: true, hasNativeRoot: true }),
    });
    expect(set).toHaveProperty("run_terminal_command");
  });

  it("computer disabled → 不暴露（基础 Kiro 工具仍在）", () => {
    const set = getKiroToolsForRequest({ computerSnapshot: snapshot({ enabled: false }) });
    expect(set).not.toHaveProperty("run_terminal_command");
    // Computer 工具整体不暴露（read_text 属 Computer 工具集），但 Kiro 基础工具仍在
    expect(set).toHaveProperty("begin_final_answer");
    expect(set).not.toHaveProperty("read_text");
  });

  it("permission disabled（terminalEnabled=false）→ 不暴露", () => {
    const set = getKiroToolsForRequest({
      computerSnapshot: snapshot({ terminalEnabled: false, terminalAvailable: true, hasNativeRoot: true }),
    });
    expect(set).not.toHaveProperty("run_terminal_command");
  });

  it("runtime unavailable（terminalAvailable=false）→ 不暴露", () => {
    const set = getKiroToolsForRequest({
      computerSnapshot: snapshot({ terminalEnabled: true, terminalAvailable: false, hasNativeRoot: true }),
    });
    expect(set).not.toHaveProperty("run_terminal_command");
  });

  it("native workspace missing（hasNativeRoot=false）→ 不暴露", () => {
    const set = getKiroToolsForRequest({
      computerSnapshot: snapshot({ terminalEnabled: true, terminalAvailable: true, hasNativeRoot: false }),
    });
    expect(set).not.toHaveProperty("run_terminal_command");
  });

  it("filesystem / document tools 在 terminal hidden 时保持存在", () => {
    const set = getKiroToolsForRequest({
      computerSnapshot: snapshot({ terminalEnabled: true, terminalAvailable: true, hasNativeRoot: false }),
    });
    expect(set).toHaveProperty("read_text");
    expect(set).toHaveProperty("create_directory");
    expect(set).toHaveProperty("create_document");
  });
});

describe("ToolSet 类型检查（编译期）", () => {
  it("返回类型是合法 ToolSet", () => {
    const set: ToolSet = getKiroToolsForRequest({
      computerSnapshot: snapshot({ terminalEnabled: true, terminalAvailable: true, hasNativeRoot: true }),
    });
    expect(typeof set).toBe("object");
  });
});
