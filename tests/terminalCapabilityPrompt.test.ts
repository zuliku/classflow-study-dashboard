import { describe, it, expect } from "vitest";
import { buildDesktopRuntimeCapabilityContext } from "@/lib/ai/computer/desktopCapabilityPrompt";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";

const baseSnapshot: KiroComputerTurnSnapshot = {
  enabled: true,
  workspaceId: "ws-1",
  agentMode: "workspace-auto",
  roots: [],
};

describe("buildDesktopRuntimeCapabilityContext — 四种状态表达", () => {
  it("ready → 声明 Terminal available + PowerShell/CMD + run_terminal_command", () => {
    const ctx = buildDesktopRuntimeCapabilityContext({
      ...baseSnapshot,
      terminalEnabled: true,
      terminalAvailable: true,
      hasNativeRoot: true,
    });
    expect(ctx).toContain("Terminal");
    expect(ctx).toContain("Runtime: available");
    expect(ctx).toContain("PowerShell / CMD command runner: available");
    expect(ctx).toContain("run_terminal_command");
    // 引导模型基于 runtime 回答，而不是静态否认
    expect(ctx).toContain("不得再回答");
  });

  it("permission-disabled → Runtime available + permission disabled", () => {
    const ctx = buildDesktopRuntimeCapabilityContext({
      ...baseSnapshot,
      terminalEnabled: false,
      terminalAvailable: true,
      hasNativeRoot: true,
    });
    expect(ctx).toContain("Runtime: available");
    expect(ctx).toContain("User permission: disabled");
    expect(ctx).toContain("设置 → Agent 与权限");
  });

  it("native-workspace-required → Terminal 已开启 + Native workspace 不可用", () => {
    const ctx = buildDesktopRuntimeCapabilityContext({
      ...baseSnapshot,
      terminalEnabled: true,
      terminalAvailable: true,
      hasNativeRoot: false,
    });
    expect(ctx).toContain("User permission: enabled");
    expect(ctx).toContain("Native workspace: unavailable");
    expect(ctx).toContain("需要先添加或切换到本地文件夹工作区");
  });

  it("runtime-unavailable → 不说 Terminal ready", () => {
    const ctx = buildDesktopRuntimeCapabilityContext({
      ...baseSnapshot,
      terminalEnabled: true,
      terminalAvailable: false,
      hasNativeRoot: true,
    });
    expect(ctx).toContain("Runtime: unavailable");
    // ready 专属短语不得出现
    expect(ctx).not.toContain("PowerShell / CMD command runner: available");
    expect(ctx).not.toContain("run_terminal_command");
  });

  it("computer-disabled → 表达 Computer 未启用", () => {
    const ctx = buildDesktopRuntimeCapabilityContext({ ...baseSnapshot, enabled: false });
    expect(ctx).toContain("Computer Agent 当前没有启用");
  });

  it("snapshot null → computer-disabled 表达", () => {
    const ctx = buildDesktopRuntimeCapabilityContext(null);
    expect(ctx).toContain("Computer Agent 当前没有启用");
  });
});

describe("Privacy — 不泄漏 native path / grantId / adapterRef", () => {
  const PRIVACY = [/[A-Za-z]:\\/, /\\\\server/i, /grantId/i, /native:[A-Za-z0-9_-]+/, /adapterRef/i, /C:\\/];

  it.each([
    buildDesktopRuntimeCapabilityContext({ ...baseSnapshot, terminalEnabled: true, terminalAvailable: true, hasNativeRoot: true }),
    buildDesktopRuntimeCapabilityContext({ ...baseSnapshot, terminalEnabled: false, terminalAvailable: true, hasNativeRoot: true }),
    buildDesktopRuntimeCapabilityContext({ ...baseSnapshot, terminalEnabled: true, terminalAvailable: true, hasNativeRoot: false }),
    buildDesktopRuntimeCapabilityContext({ ...baseSnapshot, terminalEnabled: true, terminalAvailable: false, hasNativeRoot: true }),
    buildDesktopRuntimeCapabilityContext({ ...baseSnapshot, enabled: false }),
    buildDesktopRuntimeCapabilityContext(null),
  ])("context 不含 %# 类敏感信息", (ctx) => {
    for (const re of PRIVACY) {
      expect(ctx).not.toMatch(re);
    }
  });
});
