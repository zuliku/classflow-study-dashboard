// @vitest-environment node
import { describe, it, expect } from "vitest";
import { resolveGuiControlCapability } from "@/lib/ai/computer/gui/capability";
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
  desktopControlEnabled: true,
  desktopControlAvailable: true,
  desktopActionEnabled: true,
  desktopActionAvailable: true,
};

describe("resolveGuiControlCapability — Desktop Action 五道门", () => {
  it("snapshot null → computer-disabled", () => {
    expect(resolveGuiControlCapability(null)).toEqual({
      available: false,
      reason: "computer-disabled",
    });
  });

  it("computer disabled → computer-disabled", () => {
    expect(resolveGuiControlCapability({ ...baseSnapshot, enabled: false })).toEqual({
      available: false,
      reason: "computer-disabled",
    });
  });

  it("桌面观察未开启 → observe-disabled", () => {
    expect(resolveGuiControlCapability({ ...baseSnapshot, desktopControlEnabled: false })).toEqual({
      available: false,
      reason: "observe-disabled",
    });
  });

  it("「允许 Kiro 操作电脑」未开启 → permission-disabled", () => {
    expect(resolveGuiControlCapability({ ...baseSnapshot, desktopActionEnabled: false })).toEqual({
      available: false,
      reason: "permission-disabled",
    });
  });

  it("Action Bridge 缺失（Web / v1）→ runtime-unavailable", () => {
    expect(resolveGuiControlCapability({ ...baseSnapshot, desktopActionAvailable: false })).toEqual({
      available: false,
      reason: "runtime-unavailable",
    });
    expect(resolveGuiControlCapability({ ...baseSnapshot, desktopControlAvailable: false })).toEqual({
      available: false,
      reason: "runtime-unavailable",
    });
  });

  it("plan 模式 → mode-read-only（只能观察）", () => {
    expect(resolveGuiControlCapability({ ...baseSnapshot, agentMode: "plan" })).toEqual({
      available: false,
      reason: "mode-read-only",
    });
  });

  it("全部满足 → ready", () => {
    expect(resolveGuiControlCapability(baseSnapshot)).toEqual({ available: true, reason: "ready" });
  });
});

describe("ui.interact Policy — Plan deny / Guided ask / Workspace Auto allow", () => {
  it("mode defaults 表符合 Phase 2 约定", () => {
    expect(AGENT_MODE_DEFAULTS.plan["ui.interact"]).toBe("deny");
    expect(AGENT_MODE_DEFAULTS.guided["ui.interact"]).toBe("ask");
    expect(AGENT_MODE_DEFAULTS["workspace-auto"]["ui.interact"]).toBe("allow");
    // 观察能力在任何模式都保持 allow
    for (const mode of ["plan", "guided", "workspace-auto"] as const) {
      expect(AGENT_MODE_DEFAULTS[mode]["screen.observe"]).toBe("allow");
      expect(AGENT_MODE_DEFAULTS[mode]["ui.inspect"]).toBe("allow");
    }
  });

  it("evaluateComputerPolicy 与表一致", () => {
    expect(evaluateComputerPolicy({ capability: "ui.interact", mode: "plan", rules: [] }).effect).toBe(
      "deny"
    );
    expect(
      evaluateComputerPolicy({ capability: "ui.interact", mode: "guided", rules: [] }).effect
    ).toBe("ask");
    expect(
      evaluateComputerPolicy({ capability: "ui.interact", mode: "workspace-auto", rules: [] }).effect
    ).toBe("allow");
  });

  it("explicit deny 规则优先（自动模式也不能覆盖）", () => {
    const decision = evaluateComputerPolicy({
      capability: "ui.interact",
      mode: "workspace-auto",
      rules: [
        { id: "deny-gui", effect: "deny", capability: "ui.interact", scope: "persistent" },
      ],
    });
    expect(decision.effect).toBe("deny");
  });

  it("gui 规则不跨 capability 泄漏（observe 不受 ui.interact 规则影响）", () => {
    const rules = [
      { id: "deny-gui", effect: "deny" as const, capability: "ui.interact" as const, scope: "persistent" as const },
    ];
    expect(evaluateComputerPolicy({ capability: "screen.observe", mode: "guided", rules }).effect).toBe(
      "allow"
    );
  });
});

describe("Snapshot validation — Desktop Action facts 白名单化", () => {
  const validSnapshot = {
    enabled: true,
    workspaceId: "ws-1",
    agentMode: "guided",
    roots: [],
  };

  it("合法 boolean + sessionId → 保留", () => {
    const parsed = validateComputerTurnSnapshot({
      ...validSnapshot,
      desktopActionEnabled: true,
      desktopActionAvailable: false,
      desktopSessionId: "cs-11111111-2222-3333-4444-555555555555",
    });
    expect(parsed?.desktopActionEnabled).toBe(true);
    expect(parsed?.desktopActionAvailable).toBe(false);
    expect(parsed?.desktopSessionId).toBe("cs-11111111-2222-3333-4444-555555555555");
  });

  it("非 boolean / 非法 sessionId → 忽略（fail closed）", () => {
    const parsed = validateComputerTurnSnapshot({
      ...validSnapshot,
      desktopActionEnabled: "yes",
      desktopActionAvailable: 1,
      desktopSessionId: "../../etc/passwd",
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.desktopActionEnabled).toBeUndefined();
    expect(parsed?.desktopActionAvailable).toBeUndefined();
    expect(parsed?.desktopSessionId).toBeUndefined();
  });

  it("client 注入的 native 字段绝不进入快照", () => {
    const parsed = validateComputerTurnSnapshot({
      ...validSnapshot,
      desktopActionEnabled: true,
      desktopActionAvailable: true,
      hwnd: 987654,
      pid: 555,
      nativeRef: "42.1001",
      coordinates: { x: 100, y: 200 },
    });
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toMatch(/"hwnd"|"pid"|"nativeRef"|"987654"|"555"/);
  });
});

describe("Capability Prompt — Desktop Action 边界声明", () => {
  it("ready → Observe → Action → Observe 工作流 + 敏感输入禁止", () => {
    const ctx = buildDesktopRuntimeCapabilityContext(baseSnapshot);
    expect(ctx).toContain("Desktop Action");
    expect(ctx).toContain("desktop_action");
    expect(ctx).toContain("Observe → Action → Observe");
    expect(ctx).toContain("STALE_OBSERVATION");
    expect(ctx).toContain("密码、API Key、Token、Secret");
    expect(ctx).toContain("动作覆盖（V2.5）");
    expect(ctx).toContain("clipboard_read");
  });

  it("plan → 只读边界", () => {
    const ctx = buildDesktopRuntimeCapabilityContext({ ...baseSnapshot, agentMode: "plan" });
    expect(ctx).toContain("仅规划模式");
    expect(ctx).toContain("不能执行点击");
  });

  it("permission-disabled → 引导设置且不自动开启", () => {
    const ctx = buildDesktopRuntimeCapabilityContext({ ...baseSnapshot, desktopActionEnabled: false });
    expect(ctx).toContain("允许 Kiro 操作电脑");
    expect(ctx).toContain("不要自动开启权限");
  });

  it("observe-disabled → 说明观察是前提", () => {
    const ctx = buildDesktopRuntimeCapabilityContext({ ...baseSnapshot, desktopControlEnabled: false });
    expect(ctx).toContain("允许 Kiro 查看桌面");
  });

  it("runtime-unavailable → 不声称 desktop_action 可用", () => {
    const ctx = buildDesktopRuntimeCapabilityContext({ ...baseSnapshot, desktopActionAvailable: false });
    expect(ctx).toContain("Runtime: unavailable");
    expect(ctx).not.toContain("desktop_action（click / double_click");
  });

  it("不泄漏 hwnd / pid / 绝对路径 / grantId", () => {
    const PRIVACY = [/[A-Za-z]:\\/, /\\\\server/i, /\bhwnd\s*[:=]/i, /\bpid\s*[:=]\s*\d/i, /adapterRef/i, /grantId/i];
    const contexts = [
      buildDesktopRuntimeCapabilityContext(baseSnapshot),
      buildDesktopRuntimeCapabilityContext({ ...baseSnapshot, desktopActionEnabled: false }),
      buildDesktopRuntimeCapabilityContext({ ...baseSnapshot, desktopActionAvailable: false }),
      buildDesktopRuntimeCapabilityContext({ ...baseSnapshot, desktopControlEnabled: false }),
      buildDesktopRuntimeCapabilityContext({ ...baseSnapshot, agentMode: "plan" }),
    ];
    for (const ctx of contexts) {
      for (const re of PRIVACY) expect(ctx).not.toMatch(re);
    }
  });
});
