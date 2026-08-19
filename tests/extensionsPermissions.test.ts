import { describe, it, expect } from "vitest";
import { resolvePermission, REMOTE_ORIGIN_POLICY } from "@/lib/extensions/permissions";

describe("Extensions Permission — deterministic policy", () => {
  it("remote-channel 无 terminal 权限", () => {
    expect(resolvePermission({ origin: "remote-channel", permission: "terminal" }).allowed).toBe(false);
    expect(resolvePermission({ origin: "remote-channel", permission: "terminal", agentMode: "workspace-auto" }).allowed).toBe(false);
  });

  it("remote-channel 无 direct filesystem 权限", () => {
    expect(resolvePermission({ origin: "remote-channel", permission: "filesystem" }).allowed).toBe(false);
    expect(resolvePermission({ origin: "remote-channel", permission: "filesystem-write" }).allowed).toBe(false);
    // 即使 workspace-auto 也不提升
    expect(resolvePermission({ origin: "remote-channel", permission: "filesystem", agentMode: "workspace-auto" }).allowed).toBe(false);
    expect(resolvePermission({ origin: "remote-channel", permission: "filesystem-write", agentMode: "workspace-auto" }).allowed).toBe(false);
  });

  it("remote-channel 无 silent destructive write/delete", () => {
    expect(resolvePermission({ origin: "remote-channel", permission: "delete" }).allowed).toBe(false);
    expect(resolvePermission({ origin: "remote-channel", permission: "write" }).allowed).toBe(false);
    expect(resolvePermission({ origin: "remote-channel", permission: "external-side-effect" }).allowed).toBe(false);
  });

  it("workspace-auto 不能覆盖 remote restriction", () => {
    const perms = ["terminal", "filesystem", "filesystem-write", "delete", "write", "external-side-effect"] as const;
    for (const p of perms) {
      expect(resolvePermission({ origin: "remote-channel", permission: p, agentMode: "workspace-auto" }).allowed, `remote ${p} in workspace-auto`).toBe(false);
    }
  });

  it("remote-channel 允许 read / propose", () => {
    expect(resolvePermission({ origin: "remote-channel", permission: "read" }).allowed).toBe(true);
    expect(resolvePermission({ origin: "remote-channel", permission: "propose" }).allowed).toBe(true);
  });

  it("local-user 拥有全部权限", () => {
    expect(resolvePermission({ origin: "local-user", permission: "terminal" }).allowed).toBe(true);
    expect(resolvePermission({ origin: "local-user", permission: "filesystem" }).allowed).toBe(true);
    expect(resolvePermission({ origin: "local-user", permission: "write" }).allowed).toBe(true);
    expect(resolvePermission({ origin: "local-user", permission: "delete" }).allowed).toBe(true);
  });

  it("Remote Origin Policy 文本存在且与实现一致", () => {
    expect(REMOTE_ORIGIN_POLICY.origin).toBe("remote-channel");
    expect(REMOTE_ORIGIN_POLICY.allowed).toContain("read ClassFlow facts");
    expect(REMOTE_ORIGIN_POLICY.denied).toContain("direct terminal");
    expect(REMOTE_ORIGIN_POLICY.denied).toContain("direct filesystem");
  });
});
