// @vitest-environment node
import { describe, it, expect } from "vitest";
import { resolveDesktopObservationCapability } from "@/lib/ai/computer/desktopObservationCapability";
import { validateComputerTurnSnapshot } from "@/lib/ai/computer/snapshot";
import { evaluateComputerPolicy } from "@/lib/ai/computer/policy";
import { AGENT_MODE_DEFAULTS } from "@/lib/ai/computer/capabilities";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { buildDesktopRuntimeCapabilityContext } from "@/lib/ai/computer/desktopCapabilityPrompt";

const baseSnapshot: KiroComputerTurnSnapshot = {
  enabled: true,
  workspaceId: "ws-1",
  agentMode: "workspace-auto",
  roots: [],
};

const AGENT_MODES = ["plan", "guided", "workspace-auto"] as const;

describe("resolveDesktopObservationCapability — 三道路径判定", () => {
  it("snapshot null → computer-disabled", () => {
    expect(resolveDesktopObservationCapability(null)).toEqual({
      available: false,
      reason: "computer-disabled",
    });
  });

  it("computer disabled → computer-disabled（即使其它全 true）", () => {
    expect(
      resolveDesktopObservationCapability({
        ...baseSnapshot,
        enabled: false,
        desktopControlEnabled: true,
        desktopControlAvailable: true,
      })
    ).toEqual({ available: false, reason: "computer-disabled" });
  });

  it("desktopControlEnabled=false → permission-disabled", () => {
    expect(
      resolveDesktopObservationCapability({
        ...baseSnapshot,
        desktopControlEnabled: false,
        desktopControlAvailable: true,
      })
    ).toEqual({ available: false, reason: "permission-disabled" });
  });

  it("desktopControlAvailable=false（Web runtime）→ runtime-unavailable", () => {
    expect(
      resolveDesktopObservationCapability({
        ...baseSnapshot,
        desktopControlEnabled: true,
        desktopControlAvailable: false,
      })
    ).toEqual({ available: false, reason: "runtime-unavailable" });
  });

  it("全部 true → ready", () => {
    expect(
      resolveDesktopObservationCapability({
        ...baseSnapshot,
        desktopControlEnabled: true,
        desktopControlAvailable: true,
      })
    ).toEqual({ available: true, reason: "ready" });
  });

  it("字段缺失视为 false", () => {
    expect(resolveDesktopObservationCapability(baseSnapshot)).toEqual({
      available: false,
      reason: "permission-disabled",
    });
  });
});

describe("Desktop Observe policy defaults — Plan / Guided / Workspace Auto 均允许只读观察", () => {
  it.each(AGENT_MODES)("%s：screen.observe / ui.inspect 默认 allow", (mode) => {
    expect(AGENT_MODE_DEFAULTS[mode]["screen.observe"]).toBe("allow");
    expect(AGENT_MODE_DEFAULTS[mode]["ui.inspect"]).toBe("allow");
  });

  it.each(AGENT_MODES)("%s：evaluateComputerPolicy 返回 allow（无规则）", (mode) => {
    for (const capability of ["screen.observe", "ui.inspect"] as const) {
      const decision = evaluateComputerPolicy({ capability, mode, rules: [] });
      expect(decision.effect).toBe("allow");
    }
  });

  it("explicit deny 规则优先于 mode default（observation 也可被拒绝）", () => {
    const decision = evaluateComputerPolicy({
      capability: "screen.observe",
      mode: "workspace-auto",
      rules: [
        {
          id: "deny-observe",
          effect: "deny",
          capability: "screen.observe",
          scope: "persistent",
        },
      ],
    });
    expect(decision.effect).toBe("deny");
  });

  it("规则只作用于声明 capability（不跨能力泄漏）", () => {
    const rules = [
      {
        id: "deny-read",
        effect: "deny" as const,
        capability: "fs.read" as const,
        scope: "persistent" as const,
      },
      {
        id: "deny-ui",
        effect: "deny" as const,
        capability: "ui.inspect" as const,
        scope: "persistent" as const,
      },
    ];
    expect(evaluateComputerPolicy({ capability: "screen.observe", mode: "guided", rules }).effect).toBe(
      "allow"
    );
    expect(evaluateComputerPolicy({ capability: "ui.inspect", mode: "guided", rules }).effect).toBe(
      "deny"
    );
    expect(evaluateComputerPolicy({ capability: "fs.read", mode: "guided", rules }).effect).toBe(
      "deny"
    );
  });

  it("screen.observe / ui.inspect 不在 hard deny 集合", () => {
    for (const mode of AGENT_MODES) {
      expect(AGENT_MODE_DEFAULTS[mode]["screen.observe"]).not.toBe("deny");
      expect(AGENT_MODE_DEFAULTS[mode]["ui.inspect"]).not.toBe("deny");
    }
  });
});

describe("Snapshot validation — desktopControl facts 白名单化", () => {
  const validSnapshot = {
    enabled: true,
    workspaceId: "ws-1",
    agentMode: "guided",
    roots: [],
  };

  it("合法 boolean → 保留", () => {
    const parsed = validateComputerTurnSnapshot({
      ...validSnapshot,
      desktopControlEnabled: true,
      desktopControlAvailable: false,
    });
    expect(parsed?.desktopControlEnabled).toBe(true);
    expect(parsed?.desktopControlAvailable).toBe(false);
  });

  it("非 boolean → 忽略（不拒绝快照）", () => {
    const parsed = validateComputerTurnSnapshot({
      ...validSnapshot,
      desktopControlEnabled: "yes",
      desktopControlAvailable: 1,
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.desktopControlEnabled).toBeUndefined();
    expect(parsed?.desktopControlAvailable).toBeUndefined();
  });

  it("client 注入的 native 标识绝不进入快照（hwnd/pid/nativePath/windowId）", () => {
    const parsed = validateComputerTurnSnapshot({
      ...validSnapshot,
      desktopControlEnabled: true,
      desktopControlAvailable: true,
      hwnd: 123456,
      HWND: 123456,
      pid: 4242,
      nativePath: "C:\\Windows\\System32",
      windowId: "win-abc123",
      elements: [{ elementId: "el-1", nativeRef: "42.1001" }],
    });
    expect(parsed).not.toBeNull();
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("hwnd");
    expect(serialized).not.toContain("pid");
    expect(serialized).not.toContain("nativePath");
    expect(serialized).not.toContain("win-abc123");
    expect(serialized).not.toContain("nativeRef");
    expect(serialized).not.toContain("123456");
    expect(serialized).not.toContain("4242");
  });

  it("malformed snapshot（agentMode 非法）仍被拒绝", () => {
    expect(
      validateComputerTurnSnapshot({
        enabled: true,
        workspaceId: "ws-1",
        agentMode: "full-access",
        roots: [],
        desktopControlEnabled: true,
      })
    ).toBeNull();
  });
});

describe("Capability Prompt — Observe only 边界声明", () => {
  it("ready → 声明 observe_desktop + 不可点击/输入", () => {
    const ctx = buildDesktopRuntimeCapabilityContext({
      ...baseSnapshot,
      desktopControlEnabled: true,
      desktopControlAvailable: true,
    });
    expect(ctx).toContain("Desktop Observation");
    expect(ctx).toContain("observe_desktop");
    expect(ctx).toContain("只观察");
    expect(ctx).toContain("不能执行 GUI 操作");
  });

  it("permission-disabled → 引导设置且不自动开启", () => {
    const ctx = buildDesktopRuntimeCapabilityContext({
      ...baseSnapshot,
      desktopControlEnabled: false,
      desktopControlAvailable: true,
    });
    expect(ctx).toContain("允许 Kiro 查看桌面");
    expect(ctx).toContain("设置 → Agent 与权限");
    expect(ctx).toContain("不要自动开启权限");
  });

  it("runtime-unavailable → 明确当前环境没有能力", () => {
    const ctx = buildDesktopRuntimeCapabilityContext({
      ...baseSnapshot,
      desktopControlEnabled: true,
      desktopControlAvailable: false,
    });
    expect(ctx).toContain("Runtime: unavailable");
    expect(ctx).not.toContain("observe_desktop（截图 + UI Automation 控件树）: available");
  });

  it("computer-disabled → 不出现 Desktop Observation 段", () => {
    const ctx = buildDesktopRuntimeCapabilityContext({ ...baseSnapshot, enabled: false });
    expect(ctx).not.toContain("Desktop Observation");
  });

  it("不泄漏 native path / hwnd / pid / adapterRef", () => {
    const PRIVACY = [
      /[A-Za-z]:\\/,
      /\\\\server/i,
      /\bhwnd\s*[:=]/i,
      /\bpid\s*[:=]\s*\d/i,
      /adapterRef/i,
      /grantId/i,
    ];
    const contexts = [
      buildDesktopRuntimeCapabilityContext({
        ...baseSnapshot,
        desktopControlEnabled: true,
        desktopControlAvailable: true,
      }),
      buildDesktopRuntimeCapabilityContext({
        ...baseSnapshot,
        desktopControlEnabled: false,
        desktopControlAvailable: true,
      }),
      buildDesktopRuntimeCapabilityContext({
        ...baseSnapshot,
        desktopControlEnabled: true,
        desktopControlAvailable: false,
      }),
    ];
    for (const ctx of contexts) {
      for (const re of PRIVACY) expect(ctx).not.toMatch(re);
    }
  });
});
