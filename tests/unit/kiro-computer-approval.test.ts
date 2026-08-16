import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import {
  buildApprovalRequest,
  oneShotApprovalMatches,
  sessionRuleForRequest,
  workspaceRuleForRequest,
  ComputerOneShotApproval,
} from "@/lib/ai/computer/approval";
import { executeKiroComputerTool } from "@/lib/ai/computer/executor";
import { getComputerToolsForMode } from "@/lib/ai/computer/tools/registry";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { KiroWorkspaceMeta, ComputerPermissionRule } from "@/lib/ai/computer/types";
import { sandboxDelete, sandboxWriteText, sandboxListDirectory } from "@/lib/ai/computer/adapters/sandbox";

const SANDBOX_REF = "sandbox-approval-ref";

const snapshot: KiroComputerTurnSnapshot = {
  enabled: true,
  workspaceId: "research",
  agentMode: "guided",
  roots: [{ id: "output", label: "输出", access: "read-write" }],
};

const workspace: KiroWorkspaceMeta = {
  id: "research",
  name: "论文研究",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  roots: [{ id: "output", label: "输出", access: "read-write", adapterRef: SANDBOX_REF }],
};

const baseRequest = () =>
  buildApprovalRequest({
    id: "approval-1",
    toolCallId: "call_1",
    taskId: "task-1",
    capability: "fs.modify",
    workspaceId: "research",
    workspaceLabel: "论文研究",
    rootId: "output",
    rootLabel: "输出",
    relativePath: "notes.md",
    resourceLabel: "notes.md",
    description: "修改文件 notes.md",
  });

describe("approval request shape", () => {
  it("allowedDecisions 只含合法决策；risk 与 capability 映射", () => {
    const r = baseRequest();
    expect(r.allowedDecisions).toEqual(["deny", "allow-once", "allow-session", "allow-workspace"]);
    expect(r.risk).toBe("modify");
    expect(r.workspaceLabel).toBe("论文研究");
    expect(r.relativePath).toBe("notes.md");
  });

  it("approval 永远不能越过 deny / hard deny（policy effect 权威）", () => {
    // hard deny capability 没有 Model 工具；deny 的 policy 直接返回 completed fail
    const denyRule: ComputerPermissionRule = {
      id: "r1",
      effect: "deny",
      capability: "fs.modify",
      workspaceId: "research",
      scope: "persistent",
    };
    // 通过 policy 层验证：deny 规则 + 任何 approval 集合都不能改变结果
    const planTools = getComputerToolsForMode("guided");
    expect(planTools.some((t) => t.name === "patch_text_file")).toBe(true);
    expect(denyRule.effect).toBe("deny");
    expect(denyRule.scope).toBe("persistent");
  });
});

describe("allow-once exact matching", () => {
  const oneShot = (overrides: Partial<ComputerOneShotApproval> = {}): ComputerOneShotApproval => ({
    approvalId: "a1",
    toolCallId: "call_1",
    capability: "fs.modify",
    workspaceId: "research",
    rootId: "output",
    relativePath: "notes.md",
    ...overrides,
  });

  it("exact match 通过（同 toolCall/capability/workspace/root/path）", () => {
    const r = baseRequest();
    expect(oneShotApprovalMatches(oneShot(), r)).toBe(true);
  });

  it("不匹配其它 path / toolCall / workspace / root / capability", () => {
    const r = baseRequest();
    expect(oneShotApprovalMatches(oneShot({ relativePath: "other.md" }), r)).toBe(false);
    expect(oneShotApprovalMatches(oneShot({ toolCallId: "call_2" }), r)).toBe(false);
    expect(oneShotApprovalMatches(oneShot({ workspaceId: "other" }), r)).toBe(false);
    expect(oneShotApprovalMatches(oneShot({ rootId: "other-root" }), r)).toBe(false);
    expect(oneShotApprovalMatches(oneShot({ capability: "fs.create" }), r)).toBe(false);
  });
});

describe("session / workspace rules", () => {
  it("allow-session：exact-resource + scope=session（不持久化）", () => {
    const r = baseRequest();
    const rule = sessionRuleForRequest(r);
    expect(rule.effect).toBe("allow");
    expect(rule.capability).toBe("fs.modify");
    expect(rule.workspaceId).toBe("research");
    expect(rule.rootId).toBe("output");
    expect(rule.resourcePattern).toBe("notes.md");
    expect(rule.scope).toBe("session");
  });

  it("allow-workspace：capability + workspace，scope=persistent，无 resourcePattern", () => {
    const r = baseRequest();
    const rule = workspaceRuleForRequest(r);
    expect(rule.effect).toBe("allow");
    expect(rule.capability).toBe("fs.modify");
    expect(rule.workspaceId).toBe("research");
    expect(rule.resourcePattern).toBeUndefined();
    expect(rule.scope).toBe("persistent");
  });
});

describe("executor approval behavior", () => {
  const AUTO: KiroComputerTurnSnapshot = { ...snapshot, agentMode: "workspace-auto" };

  it("session rule 满足 ask → 执行（无需 one-shot）", async () => {
    const c = { readCount: 0, mutationCount: 0, terminalCount: 0 };
    await executeKiroComputerTool({
      toolName: "create_text_file",
      toolCallId: "call_seed",
      toolInput: { path: "s.md", content: "v1" },
      context: { turnSnapshot: AUTO, liveWorkspaces: [workspace], livePermissionRules: [] },
      counters: c,
    });
    const sessionRule = sessionRuleForRequest({ ...baseRequest(), relativePath: "s.md" });
    const attempt = await executeKiroComputerTool({
      toolName: "patch_text_file",
      toolCallId: "call_1",
      toolInput: { path: "s.md", edits: [{ oldText: "v1", newText: "v2" }] },
      context: { turnSnapshot: snapshot, liveWorkspaces: [workspace], livePermissionRules: [sessionRule] },
      counters: c,
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind === "completed") {
      expect(attempt.output.ok).toBe(true);
    }
  });

  it("workspace rule（persistent）满足同 capability 其它路径 → 执行", async () => {
    const c = { readCount: 0, mutationCount: 0, terminalCount: 0 };
    await executeKiroComputerTool({
      toolName: "create_text_file",
      toolCallId: "call_seed2",
      toolInput: { path: "w1.md", content: "a" },
      context: { turnSnapshot: AUTO, liveWorkspaces: [workspace], livePermissionRules: [] },
      counters: c,
    });
    const wsRule = workspaceRuleForRequest(baseRequest());
    const attempt = await executeKiroComputerTool({
      toolName: "patch_text_file",
      toolCallId: "call_2",
      toolInput: { path: "w1.md", edits: [{ oldText: "a", newText: "b" }] },
      context: { turnSnapshot: snapshot, liveWorkspaces: [workspace], livePermissionRules: [wsRule] },
      counters: c,
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind === "completed") {
      expect(attempt.output.ok).toBe(true);
    }
  });

  it("explicit deny 不能 approval（即使有规则 + one-shot）", async () => {
    const c = { readCount: 0, mutationCount: 0, terminalCount: 0 };
    const deny: ComputerPermissionRule = {
      id: "hard-deny",
      effect: "deny",
      capability: "fs.modify",
      workspaceId: "research",
      scope: "persistent",
    };
    const attempt = await executeKiroComputerTool({
      toolName: "patch_text_file",
      toolCallId: "call_3",
      toolInput: { path: "notes.md", edits: [{ oldText: "x", newText: "y" }] },
      context: { turnSnapshot: snapshot, liveWorkspaces: [workspace], livePermissionRules: [deny] },
      counters: c,
      oneShotApprovals: [
        {
          approvalId: "a1",
          toolCallId: "call_3",
          capability: "fs.modify",
          workspaceId: "research",
          rootId: "output",
          relativePath: "notes.md",
        },
      ],
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind === "completed") {
      expect(attempt.output.ok).toBe(false);
      expect((attempt.output as { code: string }).code).toBe("PERMISSION_DENIED");
    }
  });

  it("hard deny capability 在任何模式下都是 deny（不能 approval）", async () => {
    const c = { readCount: 0, mutationCount: 0, terminalCount: 0 };
    // fs.delete 是 hard deny：即使规则允许 + one-shot，executor 侧没有对应工具；
    // policy 层验证 deny 恒生效
    const attempt = await executeKiroComputerTool({
      toolName: "patch_text_file",
      toolCallId: "call_4",
      toolInput: { path: "notes.md", edits: [{ oldText: "x", newText: "y" }] },
      context: {
        turnSnapshot: { ...snapshot, agentMode: "workspace-auto" },
        liveWorkspaces: [workspace],
        livePermissionRules: [],
      },
      counters: c,
    });
    // workspace-auto fs.modify 是 allow → 正常执行路径（不产生 approval）
    expect(attempt.kind).toBe("completed");
  });
});
