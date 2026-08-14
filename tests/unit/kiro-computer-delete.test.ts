import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { executeKiroComputerTool, getComputerAdapterForAdapterRef } from "@/lib/ai/computer/executor";
import { getComputerToolsForMode } from "@/lib/ai/computer/tools/registry";
import { ComputerOneShotApproval } from "@/lib/ai/computer/approval";
import { sandboxWriteText, sandboxCreateDirectory, clearSandboxAdapter } from "@/lib/ai/computer/adapters/sandbox";
import { registerCreatedArtifact, getArtifact, getArtifactSource, findArtifactByLocation } from "@/lib/ai/computer/artifacts/service";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { KiroWorkspaceMeta, ComputerPermissionRule } from "@/lib/ai/computer/types";
import { deleteWorkspaceFile } from "@/lib/ai/computer/filesystem/deleteFile";
import { getKnowledgeWorkspaceState, putKnowledgeWorkspaceState } from "@/lib/ai/computer/knowledge/db";

const SANDBOX_REF = "sandbox-delete-ref";

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

const readOnlyWorkspace: KiroWorkspaceMeta = {
  ...workspace,
  roots: [{ id: "raw", label: "原始数据", access: "read-only", adapterRef: SANDBOX_REF }],
};

function ctx(snap: KiroComputerTurnSnapshot = snapshot, ws: KiroWorkspaceMeta = workspace, rs: ComputerPermissionRule[] = []) {
  return { turnSnapshot: snap, liveWorkspaces: [ws], livePermissionRules: rs };
}
function counters() {
  return { readCount: 0, mutationCount: 0 };
}
const AUTO_SNAPSHOT: KiroComputerTurnSnapshot = { ...snapshot, agentMode: "workspace-auto" };

beforeEach(async () => {
  await clearSandboxAdapter(SANDBOX_REF);
});

describe("delete_file policy", () => {
  it("Plan：fs.delete = deny（无 approval、零 IO）", async () => {
    const c = counters();
    const attempt = await executeKiroComputerTool({
      toolName: "delete_file",
      toolCallId: "call-del-plan",
      toolInput: { rootId: "output", path: "x.txt" },
      context: ctx({ ...snapshot, agentMode: "plan" }),
      counters: c,
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
    expect((attempt.output as { code: string }).code).toBe("PERMISSION_DENIED");
    expect(c.mutationCount).toBe(0);
  });

  it("Guided：ask → approval-required（approval 前零 IO、文件仍在）", async () => {
    await sandboxWriteText(SANDBOX_REF, "x.txt", "内容");
    const c = counters();
    const attempt = await executeKiroComputerTool({
      toolName: "delete_file",
      toolCallId: "call-del-guided",
      toolInput: { rootId: "output", path: "x.txt" },
      context: ctx(),
      counters: c,
    });
    expect(attempt.kind).toBe("approval-required");
    if (attempt.kind !== "approval-required") return;
    expect(attempt.request.capability).toBe("fs.delete");
    expect(attempt.request.description).toContain("删除后无法通过 Kiro 撤销");
    expect(c.mutationCount).toBe(0);
    const io = getComputerAdapterForAdapterRef(SANDBOX_REF);
    expect(await io.stat("x.txt")).not.toBeNull();
  });

  it("Workspace Auto：fs.delete = allow → 直接删除（无 approval、mutation 一次）", async () => {
    await sandboxWriteText(SANDBOX_REF, "y.txt", "内容");
    const c = counters();
    const attempt = await executeKiroComputerTool({
      toolName: "delete_file",
      toolCallId: "call-del-auto",
      toolInput: { rootId: "output", path: "y.txt" },
      context: ctx(AUTO_SNAPSHOT),
      counters: c,
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(true);
    expect(c.mutationCount).toBe(1);
    expect(await getComputerAdapterForAdapterRef(SANDBOX_REF).stat("y.txt")).toBeNull();
  });

  it("Guided + explicit allow rule → allow（「此 Workspace 始终允许」真实生效，不弹 approval）", async () => {
    await sandboxWriteText(SANDBOX_REF, "z.txt", "内容");
    const allowRule: ComputerPermissionRule = {
      id: "allow-del",
      workspaceId: "research",
      rootId: "output",
      capability: "fs.delete",
      effect: "allow",
      scope: "persistent",
    };
    const attempt = await executeKiroComputerTool({
      toolName: "delete_file",
      toolCallId: "call-del-allow-rule",
      toolInput: { rootId: "output", path: "z.txt" },
      context: ctx(snapshot, workspace, [allowRule]), // guided
      counters: counters(),
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(true);
    expect(await getComputerAdapterForAdapterRef(SANDBOX_REF).stat("z.txt")).toBeNull();
  });

  it("explicit deny > Workspace Auto default allow（用户 deny 最高优先）", async () => {
    await sandboxWriteText(SANDBOX_REF, "d.txt", "内容");
    const denyRule: ComputerPermissionRule = {
      id: "deny-del",
      workspaceId: "research",
      rootId: "output",
      capability: "fs.delete",
      effect: "deny",
      scope: "persistent",
    };
    const attempt = await executeKiroComputerTool({
      toolName: "delete_file",
      toolCallId: "call-del-deny-rule",
      toolInput: { rootId: "output", path: "d.txt" },
      context: ctx(AUTO_SNAPSHOT, workspace, [denyRule]),
      counters: counters(),
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
    expect((attempt.output as { code: string }).code).toBe("PERMISSION_DENIED");
    expect(await getComputerAdapterForAdapterRef(SANDBOX_REF).stat("d.txt")).not.toBeNull();
  });

  it("approval（allow-once）后真正删除：stat null + mutation 计数一次", async () => {
    await sandboxWriteText(SANDBOX_REF, "del.txt", "要删除");
    const c = counters();
    const pending = await executeKiroComputerTool({
      toolName: "delete_file",
      toolCallId: "call-del-resume",
      toolInput: { rootId: "output", path: "del.txt" },
      context: ctx(snapshot), // guided → ask
      counters: c,
    });
    expect(pending.kind).toBe("approval-required");
    const oneShots: ComputerOneShotApproval[] = [{
      approvalId: "del-a1",
      toolCallId: "call-del-resume",
      capability: "fs.delete",
      workspaceId: "research",
      rootId: "output",
      relativePath: "del.txt",
    }];
    const resumed = await executeKiroComputerTool({
      toolName: "delete_file",
      toolCallId: "call-del-resume",
      toolInput: { rootId: "output", path: "del.txt" },
      context: ctx(snapshot),
      counters: c,
      oneShotApprovals: oneShots,
    });
    expect(resumed.kind).toBe("completed");
    if (resumed.kind !== "completed") return;
    expect(resumed.output.ok).toBe(true);
    expect(c.mutationCount).toBe(1);
    // runtime：operation delete、无 inverse（no Undo）
    expect(resumed.runtime?.change.operation).toBe("delete");
    expect(resumed.runtime?.inverse).toBeUndefined();
    const io = getComputerAdapterForAdapterRef(SANDBOX_REF);
    expect(await io.stat("del.txt")).toBeNull();
  });
});

describe("delete_file execution guards", () => {
  it("目录 → UNSUPPORTED_FILE_TYPE", async () => {
    await sandboxCreateDirectory(SANDBOX_REF, "folder");
    const attempt = await executeKiroComputerTool({
      toolName: "delete_file",
      toolCallId: "call-del-dir",
      toolInput: { rootId: "output", path: "folder" },
      context: ctx(AUTO_SNAPSHOT),
      counters: counters(),
      oneShotApprovals: [{ approvalId: "a", toolCallId: "call-del-dir", capability: "fs.delete", workspaceId: "research", rootId: "output", relativePath: "folder" }],
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
    expect((attempt.output as { code: string }).code).toBe("UNSUPPORTED_FILE_TYPE");
    const io = getComputerAdapterForAdapterRef(SANDBOX_REF);
    expect(await io.stat("folder")).not.toBeNull(); // 目录仍在
  });

  it("read-only root → denied（approval 也不能覆盖）", async () => {
    await sandboxWriteText(SANDBOX_REF, "ro.txt", "x");
    const attempt = await executeKiroComputerTool({
      toolName: "delete_file",
      toolCallId: "call-del-ro",
      toolInput: { rootId: "raw", path: "ro.txt" },
      context: ctx(AUTO_SNAPSHOT, readOnlyWorkspace),
      counters: counters(),
      oneShotApprovals: [{ approvalId: "a", toolCallId: "call-del-ro", capability: "fs.delete", workspaceId: "research", rootId: "raw", relativePath: "ro.txt" }],
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
    expect((attempt.output as { code: string }).code).toBe("PERMISSION_DENIED");
    expect(await getComputerAdapterForAdapterRef(SANDBOX_REF).stat("ro.txt")).not.toBeNull();
  });

  it("PATH_OUTSIDE_SANDBOX：escape 路径被拒", async () => {
    const attempt = await executeKiroComputerTool({
      toolName: "delete_file",
      toolCallId: "call-del-escape",
      toolInput: { rootId: "output", path: "../outside.txt" },
      context: ctx(AUTO_SNAPSHOT),
      counters: counters(),
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
    expect((attempt.output as { code: string }).code).toBe("PATH_OUTSIDE_SANDBOX");
  });

  it("Artifact 同步清理 + Knowledge dirty", async () => {
    // 先建立知识索引状态（markWorkspaceKnowledgeDirty 只在存在状态时置 dirty）
    await putKnowledgeWorkspaceState({
      workspaceId: "research",
      lastIndexedAt: "2026-01-01T00:00:00.000Z",
      fileCount: 1,
      chunkCount: 1,
      partial: false,
      dirty: false,
      unavailableRootIds: [],
    });
    const artifact = await registerCreatedArtifact({
      workspaceId: "research",
      rootId: "output",
      relativePath: "art.txt",
      type: "text",
      title: "归档",
    });
    await sandboxWriteText(SANDBOX_REF, "art.txt", "内容");
    const attempt = await executeKiroComputerTool({
      toolName: "delete_file",
      toolCallId: "call-del-art",
      toolInput: { rootId: "output", path: "art.txt" },
      context: ctx(AUTO_SNAPSHOT),
      counters: counters(),
      oneShotApprovals: [{ approvalId: "a", toolCallId: "call-del-art", capability: "fs.delete", workspaceId: "research", rootId: "output", relativePath: "art.txt" }],
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(true);
    // Registry + Source 已清理（filesystem 成功后才清理）
    expect(await getArtifact(artifact.id)).toBeNull();
    expect(await getArtifactSource(artifact.id)).toBeNull();
    expect(await findArtifactByLocation("research", "output", "art.txt")).toBeNull();
    // Knowledge dirty
    const state = await getKnowledgeWorkspaceState("research");
    expect(state?.dirty).toBe(true);
  });
});

describe("deleteWorkspaceFile（用户手动删除，共享 primitive）", () => {
  it("确认后删除文件 + Artifact 清理（不需要 Agent approval）", async () => {
    const artifact = await registerCreatedArtifact({
      workspaceId: "research",
      rootId: "output",
      relativePath: "manual.txt",
      type: "text",
      title: "手动",
    });
    await sandboxWriteText(SANDBOX_REF, "manual.txt", "内容");
    await deleteWorkspaceFile({
      workspaceId: "research",
      rootId: "output",
      relativePath: "manual.txt",
      workspaces: [workspace],
    });
    expect(await getComputerAdapterForAdapterRef(SANDBOX_REF).stat("manual.txt")).toBeNull();
    expect(await getArtifact(artifact.id)).toBeNull();
  });

  it("文件不存在 → RESOURCE_NOT_FOUND", async () => {
    await expect(
      deleteWorkspaceFile({ workspaceId: "research", rootId: "output", relativePath: "nope.txt", workspaces: [workspace] })
    ).rejects.toThrowError(expect.objectContaining({ code: "RESOURCE_NOT_FOUND" }));
  });
});

describe("registry：delete_file 工具定义", () => {
  it("getComputerToolsForMode 暴露 delete_file（plan 不暴露）", () => {
    expect(getComputerToolsForMode("workspace-auto").some((t) => t.name === "delete_file")).toBe(true);
    expect(getComputerToolsForMode("guided").some((t) => t.name === "delete_file")).toBe(true);
    expect(getComputerToolsForMode("plan").some((t) => t.name === "delete_file")).toBe(false);
  });
});
