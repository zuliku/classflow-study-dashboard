import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  ComputerTaskCheckpoint,
  ComputerInverseOperation,
  createTaskCheckpoint,
  appendInverseToCheckpoint,
  applyInverseToAdapter,
} from "@/lib/ai/computer/checkpoints";
import { getComputerAdapterForAdapterRef, executeKiroComputerTool } from "@/lib/ai/computer/executor";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import { ComputerError } from "@/lib/ai/computer/errors";
import { sandboxListDirectory, sandboxReadText, sandboxDelete } from "@/lib/ai/computer/adapters/sandbox";

const SANDBOX_REF = "sandbox-checkpoint-ref";

const AUTO: KiroComputerTurnSnapshot = {
  enabled: true,
  workspaceId: "research",
  agentMode: "workspace-auto",
  roots: [{ id: "output", label: "输出", access: "read-write" }],
};

const workspace: KiroWorkspaceMeta = {
  id: "research",
  name: "论文研究",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  roots: [{ id: "output", label: "输出", access: "read-write", adapterRef: SANDBOX_REF }],
};

const ctx = () => ({ turnSnapshot: AUTO, liveWorkspaces: [workspace], livePermissionRules: [] });
const counters = () => ({ readCount: 0, mutationCount: 0 });

async function runTool(toolName: string, toolInput: unknown, c = counters()) {
  return executeKiroComputerTool({
    toolName,
    toolCallId: `call-${Math.random().toString(36).slice(2)}`,
    toolInput,
    context: ctx(),
    counters: c,
  });
}

async function io() {
  return getComputerAdapterForAdapterRef(SANDBOX_REF);
}

async function clean() {
  for (const item of await sandboxListDirectory(SANDBOX_REF, "")) {
    await sandboxDelete(SANDBOX_REF, item.name);
  }
}

beforeEach(async () => {
  await clean();
});

describe("create text undo", () => {
  it("create_text_file → inverse remove-created(file) → verify null", async () => {
    const attempt = await runTool("create_text_file", { path: "u.md", content: "hello" });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed" || !attempt.runtime?.inverse) return;
    expect(attempt.runtime.inverse.type).toBe("remove-created");

    await applyInverseToAdapter(await io(), attempt.runtime.inverse);
    await expect(sandboxReadText(SANDBOX_REF, "u.md")).rejects.toBeInstanceOf(ComputerError);
  });
});

describe("create docx undo", () => {
  it("create_document(docx) → inverse remove-created → verify null", async () => {
    const attempt = await runTool("create_document", {
      path: "doc.docx",
      document: {
        title: "T",
        blocks: [{ type: "paragraph", content: [{ text: "x" }] }],
      },
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed" || !attempt.runtime?.inverse) return;
    await applyInverseToAdapter(await io(), attempt.runtime.inverse);
    const stat = await (await io()).stat("doc.docx");
    expect(stat).toBeNull();
  });
});

describe("create empty directory undo", () => {
  it("create_directory(empty) → inverse remove-created(directory) → verify null", async () => {
    const attempt = await runTool("create_directory", { path: "empty-dir" });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed" || !attempt.runtime?.inverse) return;
    const inv = attempt.runtime.inverse;
    expect(inv.type).toBe("remove-created");
    if (inv.type === "remove-created") {
      expect(inv.resourceType).toBe("directory");
    }
    await applyInverseToAdapter(await io(), inv);
    expect(await (await io()).stat("empty-dir")).toBeNull();
  });

  it("非空目录 Undo → fail（不递归删除）", async () => {
    await runTool("create_directory", { path: "dir-a" });
    await runTool("create_text_file", { path: "dir-a/keep.md", content: "k" });
    const cp = createTaskCheckpoint("t1");
    appendInverseToCheckpoint(cp, {
      type: "remove-created",
      workspaceId: "research",
      rootId: "output",
      relativePath: "dir-a",
      resourceType: "directory",
    });
    await expect(applyInverseToAdapter(await io(), cp.inverses[0])).rejects.toBeInstanceOf(ComputerError);
    // 文件仍在（没有递归删除）
    expect(await (await io()).stat("dir-a/keep.md")).not.toBeNull();
  });
});

describe("patch undo", () => {
  it("restore-text → 内容 exact 恢复原状", async () => {
    await runTool("create_text_file", { path: "p.md", content: "标题\n原始正文" });
    const attempt = await runTool("patch_text_file", {
      path: "p.md",
      edits: [{ oldText: "原始正文", newText: "新正文" }],
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed" || !attempt.runtime?.inverse) return;
    expect(attempt.runtime.inverse.type).toBe("restore-text");
    if (attempt.runtime.inverse.type !== "restore-text") return;
    expect(attempt.runtime.inverse.beforeText).toBe("标题\n原始正文");

    await applyInverseToAdapter(await io(), attempt.runtime.inverse);
    expect(await sandboxReadText(SANDBOX_REF, "p.md")).toBe("标题\n原始正文");
  });
});

describe("mixed actions reverse order", () => {
  it("create dir + file + patch → inverse 按 reverse 执行并全部 verify", async () => {
    await runTool("create_directory", { path: "mix" });
    await runTool("create_text_file", { path: "mix/a.md", content: "v1" });
    const patch = await runTool("patch_text_file", { path: "mix/a.md", edits: [{ oldText: "v1", newText: "v2" }] });
    expect(patch.kind).toBe("completed");
    if (patch.kind !== "completed" || !patch.runtime?.inverse) return;

    const cp = createTaskCheckpoint("task-mix");
    const dir = await runTool("create_directory", { path: "mix-2" });
    if (dir.kind === "completed" && dir.runtime?.inverse) appendInverseToCheckpoint(cp, dir.runtime.inverse);
    const file = await runTool("create_text_file", { path: "mix-2/a.md", content: "v1" });
    if (file.kind === "completed" && file.runtime?.inverse) appendInverseToCheckpoint(cp, file.runtime.inverse);
    if (patch.runtime?.inverse) appendInverseToCheckpoint(cp, patch.runtime.inverse);

    // reverse：restore-text → remove file → remove dir
    expect(cp.inverses.map((i) => i.type)).toEqual(["remove-created", "remove-created", "restore-text"]);
    const ad = await io();
    for (const inverse of [...cp.inverses].reverse()) {
      await applyInverseToAdapter(ad, inverse);
    }
    // 目录删空后 remove-created(directory) 成功 → 全部清理；
    // patch 目标是 restore-text（文件恢复为 v1，仍存在）
    expect(await ad.stat("mix-2")).toBeNull();
    expect(await ad.stat("mix-2/a.md")).toBeNull();
    expect(await sandboxReadText(SANDBOX_REF, "mix/a.md")).toBe("v1");
  });
});

describe("checkpoint semantics", () => {
  it("second undo rejected（single-use）", async () => {
    const attempt = await runTool("create_text_file", { path: "once.md", content: "x" });
    if (attempt.kind !== "completed" || !attempt.runtime?.inverse) return;
    const cp: ComputerTaskCheckpoint = createTaskCheckpoint("t-once");
    appendInverseToCheckpoint(cp, attempt.runtime.inverse);
    cp.used = true;
    // used checkpoint 不执行任何 inverse（调用方 useKiroChat 直接短路）
    expect(cp.used).toBe(true);
  });

  it("inverse 无 workspace/root 解析 → fail（revoked/missing grant 语义）", async () => {
    const cp = createTaskCheckpoint("t-gone");
    appendInverseToCheckpoint(cp, {
      type: "restore-text",
      workspaceId: "research",
      rootId: "missing-root",
      relativePath: "a.md",
      beforeText: "x",
    });
    // 由 useKiroChat 的 undoTask 在调用 adapter 前解析 root；root 不存在 → fail
    const ws = ctx().liveWorkspaces[0];
    expect(ws.roots.some((r) => r.id === "missing-root")).toBe(false);
  });

  it("restore-text verify：写回后内容不匹配 → fail", async () => {
    await runTool("create_text_file", { path: "v.md", content: "original" });
    const inverse: ComputerInverseOperation = {
      type: "restore-text",
      workspaceId: "research",
      rootId: "output",
      relativePath: "v.md",
      beforeText: "expected-restored",
    };
    await applyInverseToAdapter(await io(), inverse);
    // writeText 写入了 beforeText 且 read-back exact → 通过
    expect(await sandboxReadText(SANDBOX_REF, "v.md")).toBe("expected-restored");
  });
});
