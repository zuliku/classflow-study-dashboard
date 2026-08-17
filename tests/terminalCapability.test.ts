import { describe, it, expect } from "vitest";
import { resolveTerminalCapability } from "@/lib/ai/computer/terminalCapability";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";

const baseSnapshot: KiroComputerTurnSnapshot = {
  enabled: true,
  workspaceId: "ws-1",
  agentMode: "workspace-auto",
  roots: [],
};

describe("resolveTerminalCapability — 四道 Gate 判定", () => {
  it("snapshot 为 null → computer-disabled", () => {
    expect(resolveTerminalCapability(null)).toEqual({
      available: false,
      reason: "computer-disabled",
    });
  });

  it("computer disabled → computer-disabled（即使其它全 true）", () => {
    expect(
      resolveTerminalCapability({
        ...baseSnapshot,
        enabled: false,
        terminalEnabled: true,
        terminalAvailable: true,
        hasNativeRoot: true,
      })
    ).toEqual({ available: false, reason: "computer-disabled" });
  });

  it("terminalEnabled=false → permission-disabled", () => {
    expect(
      resolveTerminalCapability({
        ...baseSnapshot,
        terminalEnabled: false,
        terminalAvailable: true,
        hasNativeRoot: true,
      })
    ).toEqual({ available: false, reason: "permission-disabled" });
  });

  it("terminalAvailable=false → runtime-unavailable", () => {
    expect(
      resolveTerminalCapability({
        ...baseSnapshot,
        terminalEnabled: true,
        terminalAvailable: false,
        hasNativeRoot: true,
      })
    ).toEqual({ available: false, reason: "runtime-unavailable" });
  });

  it("hasNativeRoot=false → native-workspace-required", () => {
    expect(
      resolveTerminalCapability({
        ...baseSnapshot,
        terminalEnabled: true,
        terminalAvailable: true,
        hasNativeRoot: false,
      })
    ).toEqual({ available: false, reason: "native-workspace-required" });
  });

  it("全部 true → ready", () => {
    expect(
      resolveTerminalCapability({
        ...baseSnapshot,
        terminalEnabled: true,
        terminalAvailable: true,
        hasNativeRoot: true,
      })
    ).toEqual({ available: true, reason: "ready" });
  });

  it("缺失字段（undefined）视为 false 的 Gate", () => {
    // terminalEnabled / terminalAvailable / hasNativeRoot 未提供 → 按 false 判定
    expect(resolveTerminalCapability(baseSnapshot)).toEqual({
      available: false,
      reason: "permission-disabled",
    });
  });
});
