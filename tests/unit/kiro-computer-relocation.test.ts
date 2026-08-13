import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { executeKiroComputerTool } from "@/lib/ai/computer/executor";
import { isValidRenameBasename } from "@/lib/ai/computer/executor";
import { relocateFile } from "@/lib/ai/computer/filesystem/relocate";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { KiroWorkspaceMeta, ComputerPermissionRule } from "@/lib/ai/computer/types";
import { ComputerOneShotApproval } from "@/lib/ai/computer/approval";
import {
  sandboxListDirectory,
  sandboxReadText,
  sandboxWriteText,
  sandboxDelete,
  sandboxRemove,
  clearSandboxAdapter,
} from "@/lib/ai/computer/adapters/sandbox";
import {
  registerCreatedArtifact,
  findArtifactByLocation,
  getArtifact,
} from "@/lib/ai/computer/artifacts/service";

const SANDBOX_A = "sandbox-relo-a";
const SANDBOX_B = "sandbox-relo-b";

const AUTO: KiroComputerTurnSnapshot = {
  enabled: true,
  workspaceId: "research",
  agentMode: "workspace-auto",
  roots: [
    { id: "output", label: "输出", access: "read-write" },
    { id: "archive", label: "归档", access: "read-write" },
  ],
};

const workspace: KiroWorkspaceMeta = {
  id: "research",
  name: "论文研究",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  roots: [
    { id: "output", label: "输出", access: "read-write", adapterRef: SANDBOX_A },
    { id: "archive", label: "归档", access: "read-write", adapterRef: SANDBOX_B },
  ],
};

const readOnlyWorkspace: KiroWorkspaceMeta = {
  ...workspace,
  roots: [
    { id: "output", label: "输出", access: "read-write", adapterRef: SANDBOX_A },
    { id: "archive", label: "归档", access: "read-only", adapterRef: SANDBOX_B },
  ],
};

function ctx(ws: KiroWorkspaceMeta = workspace, rules: ComputerPermissionRule[] = [], mode: KiroComputerTurnSnapshot["agentMode"] = "workspace-auto") {
  return { turnSnapshot: { ...AUTO, agentMode: mode }, liveWorkspaces: [ws], livePermissionRules: rules };
}

function counters() {
  return { readCount: 0, mutationCount: 0 };
}

async function clean() {
  await clearSandboxAdapter(SANDBOX_A);
  await clearSandboxAdapter(SANDBOX_B);
}

beforeEach(async () => {
  await clean();
});

/** 默认带 allow-once（fs.move 在 Workspace Auto 也 ask）：执行类测试直接通过；审批测试显式传 [] */
async function run(toolName: string, toolInput: unknown, c = counters(), oneShots?: ComputerOneShotApproval[]) {
  const toolCallId = `call-${Math.random().toString(36).slice(2)}`;
  const shots =
    oneShots ??
    ([
      {
        approvalId: `a-${toolCallId}`,
        toolCallId,
        capability: "fs.move" as const,
        workspaceId: "research",
        rootId: "output",
        relativePath: String((toolInput as { path?: string }).path ?? ""),
      },
    ] as ComputerOneShotApproval[]);
  return executeKiroComputerTool({
    toolName,
    toolCallId,
    toolInput: { rootId: "output", ...(toolInput as object) },
    context: ctx(),
    counters: c,
    oneShotApprovals: shots,
  });
}

describe("basename validation", () => {
  it("rejects slash / backslash / dot-dot / control chars / Windows reserved names", () => {
    expect(isValidRenameBasename("final.md")).toBe(true);
    expect(isValidRenameBasename("a/b.md")).toBe(false);
    expect(isValidRenameBasename("a\\b.md")).toBe(false);
    expect(isValidRenameBasename("..")).toBe(false);
    expect(isValidRenameBasename(".")).toBe(false);
    expect(isValidRenameBasename("")).toBe(false);
    expect(isValidRenameBasename("con")).toBe(false);
    expect(isValidRenameBasename("CON.txt")).toBe(false);
    expect(isValidRenameBasename("nul")).toBe(false);
    expect(isValidRenameBasename("com1")).toBe(false);
    expect(isValidRenameBasename("lpt9")).toBe(false);
    expect(isValidRenameBasename("bad\u0000name")).toBe(false);
  });
});

describe("rename_file", () => {
  it("rename verifies source absent + target present", async () => {
    await sandboxWriteText(SANDBOX_A, "draft.md", "content-v1");
    const attempt = await run("rename_file", { path: "draft.md", newName: "final.md" });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(true);
    expect(await sandboxReadText(SANDBOX_A, "final.md")).toBe("content-v1");
    await expect(sandboxReadText(SANDBOX_A, "draft.md")).rejects.toThrow();
    // move-back inverse 携带 artifactId 字段
    expect(attempt.runtime?.inverse?.type).toBe("move-back");
    if (attempt.runtime?.inverse?.type === "move-back") {
      expect(attempt.runtime.inverse.fromPath).toBe("draft.md");
      expect(attempt.runtime.inverse.toPath).toBe("final.md");
    }
  });

  it("rejects existing destination", async () => {
    await sandboxWriteText(SANDBOX_A, "draft.md", "d");
    await sandboxWriteText(SANDBOX_A, "final.md", "existing");
    const attempt = await run("rename_file", { path: "draft.md", newName: "final.md" });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
    expect((attempt.output as { code: string }).code).toBe("RESOURCE_ALREADY_EXISTS");
  });

  it("rejects invalid basename", async () => {
    const attempt = await run("rename_file", { path: "draft.md", newName: "../escape.md" });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
    expect((attempt.output as { code: string }).code).toBe("INVALID_INPUT");
  });

  it("rename keeps artifact id and revision (location synced)", async () => {
    await sandboxWriteText(SANDBOX_A, "draft.md", "content-v1");
    const created = await registerCreatedArtifact({
      workspaceId: "research",
      rootId: "output",
      relativePath: "draft.md",
      type: "markdown",
    });
    const attempt = await run("rename_file", { path: "draft.md", newName: "final.md" });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    const synced = await findArtifactByLocation("research", "output", "final.md");
    expect(synced?.id).toBe(created.id);
    expect(synced?.revision).toBe(1);
    expect(await findArtifactByLocation("research", "output", "draft.md")).toBeNull();
  });
});

describe("move_file", () => {
  it("moves across two read-write roots in the same Workspace", async () => {
    await sandboxWriteText(SANDBOX_A, "notes.md", "n");
    const attempt = await run("move_file", {
      path: "notes.md",
      destinationRootId: "archive",
      destinationPath: "notes.md",
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(true);
    expect(await sandboxReadText(SANDBOX_B, "notes.md")).toBe("n");
    await expect(sandboxReadText(SANDBOX_A, "notes.md")).rejects.toThrow();
  });

  it("cannot resolve destination from another Workspace (root not found)", async () => {
    const attempt = await run("move_file", {
      path: "notes.md",
      destinationRootId: "other-ws-root",
      destinationPath: "notes.md",
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
    expect((attempt.output as { code: string }).code).toBe("ROOT_NOT_FOUND");
  });

  it("rejects existing destination (no implicit overwrite)", async () => {
    await sandboxWriteText(SANDBOX_A, "notes.md", "n");
    await sandboxWriteText(SANDBOX_B, "archive/notes.md", "taken");
    const attempt = await run("move_file", {
      path: "notes.md",
      destinationRootId: "archive",
      destinationPath: "archive/notes.md",
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
    expect((attempt.output as { code: string }).code).toBe("RESOURCE_ALREADY_EXISTS");
  });
});

describe("dual-resource permission", () => {
  it("read-only source root denies", async () => {
    const roWorkspace: KiroWorkspaceMeta = {
      ...workspace,
      roots: [
        { id: "output", label: "输出", access: "read-only", adapterRef: SANDBOX_A },
        { id: "archive", label: "归档", access: "read-write", adapterRef: SANDBOX_B },
      ],
    };
    await sandboxWriteText(SANDBOX_A, "a.md", "x");
    const attempt = await executeKiroComputerTool({
      toolName: "move_file",
      toolCallId: "call-ro-src",
      toolInput: { rootId: "output", path: "a.md", destinationRootId: "archive", destinationPath: "a.md" },
      context: ctx(roWorkspace),
      counters: counters(),
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
  });

  it("read-only destination root denies", async () => {
    await sandboxWriteText(SANDBOX_A, "a.md", "x");
    const attempt = await executeKiroComputerTool({
      toolName: "move_file",
      toolCallId: "call-ro-dst",
      toolInput: { rootId: "output", path: "a.md", destinationRootId: "archive", destinationPath: "a.md" },
      context: ctx(readOnlyWorkspace),
      counters: counters(),
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
  });

  it("explicit deny on source denies", async () => {
    await sandboxWriteText(SANDBOX_A, "a.md", "x");
    const deny: ComputerPermissionRule = {
      id: "deny-src",
      effect: "deny",
      capability: "fs.move",
      workspaceId: "research",
      rootId: "output",
      resourcePattern: "a.md",
      scope: "persistent",
    };
    const attempt = await executeKiroComputerTool({
      toolName: "rename_file",
      toolCallId: "call-den-src",
      toolInput: { rootId: "output", path: "a.md", newName: "b.md" },
      context: ctx(workspace, [deny]),
      counters: counters(),
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
    expect((attempt.output as { code: string }).code).toBe("PERMISSION_DENIED");
  });

  it("explicit deny on destination denies even when source allows (no bypass)", async () => {
    await sandboxWriteText(SANDBOX_A, "out.md", "x");
    const denyDest: ComputerPermissionRule = {
      id: "deny-dst",
      effect: "deny",
      capability: "fs.move",
      workspaceId: "research",
      rootId: "archive",
      resourcePattern: "protected.md",
      scope: "persistent",
    };
    const attempt = await executeKiroComputerTool({
      toolName: "move_file",
      toolCallId: "call-den-dst",
      toolInput: { rootId: "output", path: "out.md", destinationRootId: "archive", destinationPath: "protected.md" },
      context: ctx(workspace, [denyDest]),
      counters: counters(),
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
    expect((attempt.output as { code: string }).code).toBe("PERMISSION_DENIED");
    // 文件未被移动
    expect(await sandboxReadText(SANDBOX_A, "out.md")).toBe("x");
  });
});

describe("relocation approval", () => {
  it("Guided rename returns approval-required before IO", async () => {
    await sandboxWriteText(SANDBOX_A, "draft.md", "d");
    const attempt = await executeKiroComputerTool({
      toolName: "rename_file",
      toolCallId: "call-gd",
      toolInput: { rootId: "output", path: "draft.md", newName: "final.md" },
      context: ctx(workspace, [], "guided"),
      counters: counters(),
    });
    expect(attempt.kind).toBe("approval-required");
    if (attempt.kind !== "approval-required") return;
    expect(attempt.request.capability).toBe("fs.move");
    expect(attempt.request.description).toContain("重命名 draft.md → final.md");
    // 无 IO
    expect(await sandboxReadText(SANDBOX_A, "draft.md")).toBe("d");
  });

  it("Workspace Auto move still returns approval-required before IO", async () => {
    await sandboxWriteText(SANDBOX_A, "notes.md", "n");
    const attempt = await run("move_file", {
      path: "notes.md",
      destinationRootId: "archive",
      destinationPath: "notes.md",
    }, counters(), []);
    expect(attempt.kind).toBe("approval-required");
    if (attempt.kind !== "approval-required") return;
    expect(attempt.request.description).toContain("移动 notes.md → notes.md");
    expect(await sandboxReadText(SANDBOX_A, "notes.md")).toBe("n");
  });

  it("allow-once resumes the exact frozen Tool Call", async () => {
    await sandboxWriteText(SANDBOX_A, "notes.md", "n");
    const oneShots: ComputerOneShotApproval[] = [
      {
        approvalId: "a1",
        toolCallId: "call-resume",
        capability: "fs.move",
        workspaceId: "research",
        rootId: "output",
        relativePath: "notes.md",
      },
    ];
    const attempt = await executeKiroComputerTool({
      toolName: "move_file",
      toolCallId: "call-resume",
      toolInput: { rootId: "output", path: "notes.md", destinationRootId: "archive", destinationPath: "notes.md" },
      context: ctx(),
      counters: counters(),
      oneShotApprovals: oneShots,
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(true);
    expect(oneShots.length).toBe(0);
  });
});

describe("relocation undo / artifact sync", () => {
  it("move-back restores original file and Artifact location", async () => {
    await sandboxWriteText(SANDBOX_A, "notes.md", "n");
    const created = await registerCreatedArtifact({
      workspaceId: "research",
      rootId: "output",
      relativePath: "notes.md",
      type: "markdown",
    });
    const oneShots: ComputerOneShotApproval[] = [
      { approvalId: "a2", toolCallId: "call-undo", capability: "fs.move", workspaceId: "research", rootId: "output", relativePath: "notes.md" },
    ];
    const attempt = await executeKiroComputerTool({
      toolName: "move_file",
      toolCallId: "call-undo",
      toolInput: { path: "notes.md", destinationRootId: "archive", destinationPath: "notes.md" },
      context: ctx(),
      counters: counters(),
      oneShotApprovals: oneShots,
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed" || !attempt.runtime?.inverse) return;
    // 已同步到目标位置
    expect((await findArtifactByLocation("research", "archive", "notes.md"))?.id).toBe(created.id);
    // move-back：验证 Artifact 位置还原（文件在 archive，移回 output）
    const inverse = attempt.runtime.inverse;
    expect(inverse.type).toBe("move-back");
    if (inverse.type !== "move-back") return;
    // 直接执行 move-back（与 useKiroChat undoTask 相同语义：verified relocate back + artifact restore）
    const { getComputerAdapterForAdapterRef } = await import("@/lib/ai/computer/executor");
    const src = getComputerAdapterForAdapterRef(SANDBOX_B);
    const dst = getComputerAdapterForAdapterRef(SANDBOX_A);
    await relocateFile({ source: src, sourcePath: "notes.md", destination: dst, destinationPath: "notes.md" });
    expect(await sandboxReadText(SANDBOX_A, "notes.md")).toBe("n");
    await expect(sandboxReadText(SANDBOX_B, "notes.md")).rejects.toThrow();
    const restoredArtifact = await getArtifact(inverse.artifactId ?? "");
    expect(restoredArtifact?.relativePath).toBe("notes.md");
    expect(restoredArtifact?.rootId).toBe("output");
    expect(restoredArtifact?.id).toBe(created.id);
  });

  it("partial cross-adapter failure never returns success", async () => {
    await sandboxWriteText(SANDBOX_A, "a.md", "payload");
    // 目标 adapter 不可写（不存在）→ relocate 失败 → 不返回成功
    const attempt = await executeKiroComputerTool({
      toolName: "move_file",
      toolCallId: "call-fail",
      toolInput: { rootId: "output", path: "a.md", destinationRootId: "archive", destinationPath: "a.md" },
      context: ctx({
        ...workspace,
        roots: [
          { id: "output", label: "输出", access: "read-write", adapterRef: SANDBOX_A },
          { id: "archive", label: "归档", access: "read-write", adapterRef: "browser-grant-missing" },
        ],
      }),
      counters: counters(),
      oneShotApprovals: [
        { approvalId: "a3", toolCallId: "call-fail", capability: "fs.move", workspaceId: "research", rootId: "output", relativePath: "a.md" },
      ],
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed") return;
    expect(attempt.output.ok).toBe(false);
  });
});
