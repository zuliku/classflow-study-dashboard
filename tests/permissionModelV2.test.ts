import { describe, it, expect } from "vitest";
import {
  resolvePermission,
  resolvePermissions,
  CapabilityActor,
  AgentMode,
  InvocationOrigin,
} from "@/lib/extensions/permissions";
import { KiroAgentMode } from "@/lib/ai/computer/types";

describe("Permission Model V2 — Task 06", () => {
  it("remote → skill → terminal = deny", () => {
    const actor: CapabilityActor = { kind: "skill", skillId: "course-notification" };
    expect(
      resolvePermission({ origin: "remote-channel", permission: "terminal", agentMode: "workspace-auto", actor }).allowed
    ).toBe(false);
    expect(
      resolvePermission({ origin: "remote-channel", permission: "terminal", agentMode: "workspace-auto", actor, actorGranted: true }).allowed
    ).toBe(false);
  });

  it("remote → mcp → write = deny", () => {
    const actor: CapabilityActor = { kind: "mcp", connectionId: "notion", toolName: "create_page" };
    expect(
      resolvePermission({ origin: "remote-channel", permission: "write", agentMode: "workspace-auto", actor, actorGranted: true }).allowed
    ).toBe(false);
  });

  it("remote + workspace-auto ≠ upgrade", () => {
    const perms = ["terminal", "filesystem", "filesystem-write", "delete", "write", "external-side-effect"] as const;
    for (const p of perms) {
      expect(
        resolvePermission({ origin: "remote-channel", permission: p, agentMode: "workspace-auto", actorGranted: true }).allowed,
        `remote ${p} in workspace-auto`
      ).toBe(false);
    }
  });

  it("local + skill 仍受 AgentMode 限制", () => {
    const actor: CapabilityActor = { kind: "skill", skillId: "s1" };
    // plan 下 local+skill 也不允许 terminal / filesystem-write
    expect(resolvePermission({ origin: "local-user", permission: "terminal", agentMode: "plan", actor }).allowed).toBe(false);
    expect(resolvePermission({ origin: "local-user", permission: "filesystem-write", agentMode: "guided", actor }).allowed).toBe(false);
    // workspace-auto 下允许（用户显式授权）
    expect(resolvePermission({ origin: "local-user", permission: "terminal", agentMode: "workspace-auto", actor }).allowed).toBe(true);
    // read / propose 始终允许
    expect(resolvePermission({ origin: "local-user", permission: "read", agentMode: "plan", actor }).allowed).toBe(true);
  });

  it("local + mcp 仍受 MCP grant 限制", () => {
    const actor: CapabilityActor = { kind: "mcp", connectionId: "notion", toolName: "search" };
    // actorGranted=false → deny（Extension Grant 层）
    expect(
      resolvePermission({ origin: "local-user", permission: "read", agentMode: "workspace-auto", actor, actorGranted: false }).allowed
    ).toBe(false);
    // actorGranted=true + workspace-auto → 允许
    expect(
      resolvePermission({ origin: "local-user", permission: "read", agentMode: "workspace-auto", actor, actorGranted: true }).allowed
    ).toBe(true);
    // actorGranted=true 但 plan → 高危仍 deny
    expect(
      resolvePermission({ origin: "local-user", permission: "delete", agentMode: "plan", actor, actorGranted: true }).allowed
    ).toBe(false);
  });

  it("deny overrides allow（remote read 被 actor grant 拒绝仍 deny）", () => {
    const actor: CapabilityActor = { kind: "mcp", connectionId: "x", toolName: "read_tool" };
    // read 是 remote allowlist 内，但 actorGranted=false → deny 覆盖 allow
    expect(
      resolvePermission({ origin: "remote-channel", permission: "read", agentMode: "workspace-auto", actor, actorGranted: false }).allowed
    ).toBe(false);
  });

  it("AgentMode 直接复用 KiroAgentMode（无 ask）", () => {
    const modes: AgentMode[] = ["plan", "guided", "workspace-auto"];
    const kiro: KiroAgentMode[] = ["plan", "guided", "workspace-auto"];
    expect(modes).toEqual(kiro);
    // 不再存在 "ask"
    expect(modes).not.toContain("ask" as never);
  });

  it("批量 resolvePermissions 正确", () => {
    const r = resolvePermissions("local-user", ["read", "write", "terminal", "delete"], {
      agentMode: "plan",
    });
    expect(r.read).toBe(true);
    expect(r.write).toBe(false);
    expect(r.terminal).toBe(false);
    expect(r.delete).toBe(false);
  });
});
