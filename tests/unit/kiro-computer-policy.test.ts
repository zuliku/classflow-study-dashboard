import { describe, it, expect } from "vitest";
import { prepareComputerTool } from "@/lib/ai/computer/prepare";
import { evaluateComputerPolicy } from "@/lib/ai/computer/policy";
import { normalizeRelativeComputerPath } from "@/lib/ai/computer/workspace/resolver";
import { ComputerError } from "@/lib/ai/computer/errors";
import {
  KiroAgentMode,
  ComputerPermissionRule,
  KiroWorkspaceMeta,
} from "@/lib/ai/computer/types";

const workspace: KiroWorkspaceMeta = {
  id: "research",
  name: "论文研究",
  roots: [
    { id: "output", label: "输出", access: "read-write", adapterRef: "ref-output" },
    { id: "raw", label: "原始数据", access: "read-only", adapterRef: "ref-raw" },
  ],
  createdAt: "2026-08-13T00:00:00.000Z",
  updatedAt: "2026-08-13T00:00:00.000Z",
};

const noRules: ComputerPermissionRule[] = [];

function prep(
  mode: KiroAgentMode,
  capability: Parameters<typeof prepareComputerTool>[0]["capability"],
  resource: { rootId: string; path: string },
  rules: ComputerPermissionRule[] = noRules
) {
  return prepareComputerTool({
    mode,
    rules,
    workspace,
    capability,
    resource: { workspaceId: "research", ...resource },
  });
}

describe("agent mode defaults", () => {
  it("plan：read allow，create/modify deny", () => {
    expect(prep("plan", "fs.read", { rootId: "output", path: "a.md" }).effect).toBe("allow");
    expect(prep("plan", "fs.list", { rootId: "output", path: "x" }).effect).toBe("allow");
    expect(prep("plan", "fs.create", { rootId: "output", path: "a.md" }).effect).toBe("deny");
    expect(prep("plan", "fs.modify", { rootId: "output", path: "a.md" }).effect).toBe("deny");
    expect(prep("plan", "document.create", { rootId: "output", path: "a.docx" }).effect).toBe("deny");
  });

  it("guided：read/create allow，modify/move/delete ask", () => {
    expect(prep("guided", "fs.read", { rootId: "output", path: "a.md" }).effect).toBe("allow");
    expect(prep("guided", "fs.create", { rootId: "output", path: "a.md" }).effect).toBe("allow");
    expect(prep("guided", "fs.modify", { rootId: "output", path: "a.md" }).effect).toBe("ask");
    expect(prep("guided", "fs.move", { rootId: "output", path: "a.md" }).effect).toBe("ask");
    expect(prep("guided", "fs.delete", { rootId: "output", path: "a.md" }).effect).toBe("ask");
  });

  it("workspace-auto：read/create/modify/move/delete 全部 allow（V2.7 Workspace 内 Full Access）", () => {
    expect(prep("workspace-auto", "fs.read", { rootId: "output", path: "a.md" }).effect).toBe("allow");
    expect(prep("workspace-auto", "fs.create", { rootId: "output", path: "a.md" }).effect).toBe("allow");
    expect(prep("workspace-auto", "fs.modify", { rootId: "output", path: "a.md" }).effect).toBe("allow");
    expect(prep("workspace-auto", "fs.move", { rootId: "output", path: "a.md" }).effect).toBe("allow");
    expect(prep("workspace-auto", "fs.delete", { rootId: "output", path: "a.md" }).effect).toBe("allow");
    expect(prep("workspace-auto", "document.create", { rootId: "output", path: "a.docx" }).effect).toBe("allow");
    expect(prep("workspace-auto", "document.modify", { rootId: "output", path: "a.docx" }).effect).toBe("allow");
  });
});

describe("hard deny", () => {
  it("V1 hard deny 无视 agent mode（仅系统级能力；fs.delete 不是 hard deny）", () => {
    for (const mode of ["plan", "guided", "workspace-auto"] as KiroAgentMode[]) {
      for (const cap of ["app.open", "app.reveal", "shell.execute", "network.access"] as const) {
        expect(prep(mode, cap, { rootId: "output", path: "a.md" }).effect).toBe("deny");
      }
    }
  });

  it("read-only root：mutation hard deny（任何 mode；Workspace Auto 也不放开）", () => {
    for (const mode of ["plan", "guided", "workspace-auto"] as KiroAgentMode[]) {
      expect(prep(mode, "fs.create", { rootId: "raw", path: "x.md" }).effect).toBe("deny");
      expect(prep(mode, "fs.modify", { rootId: "raw", path: "x.md" }).effect).toBe("deny");
      expect(prep(mode, "fs.move", { rootId: "raw", path: "x.md" }).effect).toBe("deny");
      expect(prep(mode, "fs.delete", { rootId: "raw", path: "x.md" }).effect).toBe("deny");
    }
    // read-only root 的 read 仍允许
    expect(prep("guided", "fs.read", { rootId: "raw", path: "x.md" }).effect).toBe("allow");
  });

  it("explicit deny 优先于 mode allow（Workspace Auto 的 fs.delete allow 也不能覆盖）", () => {
    const rules: ComputerPermissionRule[] = [
      { id: "r1", effect: "deny", capability: "fs.delete", workspaceId: "research", rootId: "output", scope: "persistent" },
    ];
    const d = prep("workspace-auto", "fs.delete", { rootId: "output", path: "a.md" }, rules);
    expect(d.effect).toBe("deny");
    expect(d.matchedRuleId).toBe("r1");
  });

  it("explicit allow 覆盖 mode ask（Guided 的 fs.delete ask → allow；「此 Workspace 始终允许」真实生效）", () => {
    const rules: ComputerPermissionRule[] = [
      { id: "r1", effect: "allow", capability: "fs.delete", workspaceId: "research", scope: "persistent" },
    ];
    const d = prep("guided", "fs.delete", { rootId: "output", path: "b.txt" }, rules);
    expect(d.effect).toBe("allow");
    expect(d.matchedRuleId).toBe("r1");
  });

  it("explicit deny 优先于 mode allow", () => {
    const rules: ComputerPermissionRule[] = [
      { id: "r1", effect: "deny", capability: "fs.read", workspaceId: "research", scope: "persistent" },
    ];
    expect(prep("plan", "fs.read", { rootId: "output", path: "a.md" }, rules).effect).toBe("deny");
  });

  it("explicit allow 覆盖 mode ask（更 specific）", () => {
    const rules: ComputerPermissionRule[] = [
      { id: "r1", effect: "allow", capability: "fs.modify", workspaceId: "research", rootId: "output", scope: "session" },
    ];
    const d = prep("guided", "fs.modify", { rootId: "output", path: "a.md" }, rules);
    expect(d.effect).toBe("allow");
    expect(d.matchedRuleId).toBe("r1");
  });

  it("resourcePattern：exact 与 prefix/** 匹配", () => {
    const rules: ComputerPermissionRule[] = [
      { id: "r1", effect: "deny", capability: "fs.read", workspaceId: "research", resourcePattern: "notes/**", scope: "session" },
    ];
    expect(prep("plan", "fs.read", { rootId: "output", path: "notes/secret.md" }, rules).effect).toBe("deny");
    expect(prep("plan", "fs.read", { rootId: "output", path: "other.md" }, rules).effect).toBe("allow");
  });
});

describe("path safety", () => {
  it("safe relative path：分隔符归一 + 内部 . / a/../b 折叠", () => {
    expect(normalizeRelativeComputerPath("a\\b\\c.md").path).toBe("a/b/c.md");
    expect(normalizeRelativeComputerPath("./a/./b.md").path).toBe("a/b.md");
    expect(normalizeRelativeComputerPath("a/../b.md").path).toBe("b.md");
  });

  it("拒绝 traversal / absolute / drive / UNC / control / reserved", () => {
    const bad = [
      "../secret.txt",
      "/etc/passwd",
      "C:/Users/x",
      "c:\\Users\\x",
      "\\\\server\\share",
      "//server/share",
      "CON.txt",
      "PRN",
      "AUX.doc",
      "NUL.md",
      "COM1.txt",
      "LPT9.csv",
      "a\u0000b.md",
      "",
    ];
    for (const p of bad) {
      expect(() => normalizeRelativeComputerPath(p), p).toThrow(ComputerError);
    }
  });

  it("路径安全失败 = PATH_OUTSIDE_SANDBOX（权限审批不可覆盖）", () => {
    expect(() => normalizeRelativeComputerPath("../secret.txt")).toThrowError(
      expect.objectContaining({ code: "PATH_OUTSIDE_SANDBOX" })
    );
    // prepare 路径越界时抛错而非返回 allow
    expect(() =>
      prepareComputerTool({
        mode: "guided",
        rules: [],
        workspace,
        capability: "fs.read",
        resource: { workspaceId: "research", rootId: "output", path: "../escape.md" },
      })
    ).toThrow(ComputerError);
  });
});

describe("prepare computer tool preflight", () => {
  it("workspace/root 解析错误", () => {
    expect(() =>
      prepareComputerTool({
        mode: "guided",
        rules: [],
        workspace,
        capability: "fs.read",
        resource: { workspaceId: "other", rootId: "output", path: "a.md" },
      })
    ).toThrowError(expect.objectContaining({ code: "WORKSPACE_NOT_FOUND" }));

    expect(() =>
      prepareComputerTool({
        mode: "guided",
        rules: [],
        workspace,
        capability: "fs.read",
        resource: { workspaceId: "research", rootId: "missing", path: "a.md" },
      })
    ).toThrowError(expect.objectContaining({ code: "ROOT_NOT_FOUND" }));
  });

  it("无 resource 的 capability（workspace.list）走 mode default", () => {
    const d = evaluateComputerPolicy({
      capability: "workspace.list",
      mode: "plan",
      rules: [],
      workspaceId: "research",
    });
    expect(d.effect).toBe("allow");
  });
});
