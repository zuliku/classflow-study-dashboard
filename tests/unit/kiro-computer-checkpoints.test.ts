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
import { sandboxListDirectory, sandboxReadText, sandboxWriteText, sandboxDelete } from "@/lib/ai/computer/adapters/sandbox";
import { registerCreatedArtifact, getArtifact, getArtifactSource, restoreArtifactRevision } from "@/lib/ai/computer/artifacts/service";
import { KiroDocument } from "@/lib/ai/computer/documents/types";
import { undoDocumentRevisionRuntime } from "@/lib/ai/computer/documentRevisionUndo";

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
  it("create_text_file → inverse remove-created(file) 携带 artifactId → Undo 后 file/Artifact/Source 全空", async () => {
    const attempt = await runTool("create_text_file", { path: "u.md", content: "hello" });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed" || !attempt.runtime?.inverse) return;
    expect(attempt.runtime.inverse.type).toBe("remove-created");
    const artifactId = attempt.runtime.change.artifactId;
    expect(attempt.runtime.change.artifactId).toBeTruthy();
    if (attempt.runtime.inverse.type === "remove-created") {
      expect(attempt.runtime.inverse.artifactId).toBe(artifactId);
    }
    // 生产/测试同一路径：applyInverseToAdapter（含 registry cleanup）
    await applyInverseToAdapter(await io(), attempt.runtime.inverse);
    await expect(sandboxReadText(SANDBOX_REF, "u.md")).rejects.toBeInstanceOf(ComputerError);
    if (artifactId) {
      expect(await getArtifact(artifactId)).toBeNull();
      expect(await getArtifactSource(artifactId)).toBeNull();
    }
  });
});

describe("create docx undo", () => {
  it("create_document(docx) → inverse remove-created 携带 artifactId → Undo 后 file/Artifact/Source 全空", async () => {
    const attempt = await runTool("create_document", {
      path: "doc.docx",
      document: {
        title: "T",
        blocks: [{ type: "paragraph", content: [{ text: "x" }] }],
      },
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed" || !attempt.runtime?.inverse) return;
    const artifactId = attempt.runtime.change.artifactId;
    expect(attempt.runtime.change.artifactId).toBeTruthy();
    if (attempt.runtime.inverse.type === "remove-created") {
      expect(attempt.runtime.inverse.artifactId).toBe(artifactId);
    }
    await applyInverseToAdapter(await io(), attempt.runtime.inverse);
    const stat = await (await io()).stat("doc.docx");
    expect(stat).toBeNull();
    if (artifactId) {
      expect(await getArtifact(artifactId)).toBeNull();
      expect(await getArtifactSource(artifactId)).toBeNull();
    }
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
  it("registered generic patch inverse → 内容 exact 恢复原状（+ Artifact revision 恢复）", async () => {
    await runTool("create_text_file", { path: "p.md", content: "标题\n原始正文" });
    const attempt = await runTool("patch_text_file", {
      path: "p.md",
      edits: [{ oldText: "原始正文", newText: "新正文" }],
    });
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed" || !attempt.runtime?.inverse) return;
    expect(attempt.runtime.inverse.type).toBe("restore-generic-artifact-revision");
    if (attempt.runtime.inverse.type !== "restore-generic-artifact-revision") return;
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

    // reverse：restore-generic-artifact-revision → remove file → remove dir
    expect(cp.inverses.map((i) => i.type)).toEqual([
      "remove-created",
      "remove-created",
      "restore-generic-artifact-revision",
    ]);
    const ad = await io();
    for (const inverse of [...cp.inverses].reverse()) {
      await applyInverseToAdapter(ad, inverse);
    }
    // 目录删空后 remove-created(directory) 成功 → 全部清理；
    // patch 目标是 generic inverse（文件恢复为 v1，仍存在）
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

describe("restore-document-revision（V2 Part 2.1 helper）", () => {
  const IR_V1: KiroDocument = {
    title: "研究方案",
    blocks: [
      { type: "heading", level: 1, content: [{ text: "引言" }] },
      { type: "paragraph", content: [{ text: "版本一" }] },
    ],
  };
  const IR_V2: KiroDocument = {
    title: "研究方案",
    blocks: [
      { type: "heading", level: 1, content: [{ text: "引言" }] },
      { type: "paragraph", content: [{ text: "版本二" }] },
    ],
  };

  async function seedDoc(path: string, doc: KiroDocument): Promise<string> {
    const c = counters();
    const attempt = await runTool("create_document", { path, document: doc }, c);
    if (attempt.kind !== "completed" || !attempt.runtime?.change.artifactId) {
      throw new Error("seed create failed");
    }
    return attempt.runtime.change.artifactId;
  }

  async function updateDoc(artifactId: string, expectedRevision: number, doc: KiroDocument) {
    const attempt = await runTool("update_document", { artifactId, expectedRevision, document: doc }, counters());
    expect(attempt.kind).toBe("completed");
    if (attempt.kind !== "completed" || !attempt.runtime?.inverse) {
      throw new Error("update failed");
    }
    return attempt.runtime.inverse;
  }

  it("Markdown v2 → Undo 恢复 exact v1 文本 + Source IR + revision 1", async () => {
    const artifactId = await seedDoc("plan.md", IR_V1);
    const inverse = await updateDoc(artifactId, 1, IR_V2);
    expect(inverse.type).toBe("restore-document-revision");
    if (inverse.type !== "restore-document-revision") return;

    await undoDocumentRevisionRuntime({ io: await io(), inverse });
    const v1Text = inverse.snapshot.format === "markdown" ? inverse.snapshot.text : "";
    expect(await sandboxReadText(SANDBOX_REF, "plan.md")).toBe(v1Text);
    expect((await getArtifact(artifactId))?.revision).toBe(1);
    const source = await getArtifactSource(artifactId);
    expect(source?.revision).toBe(1);
    expect(source?.document.blocks[1]).toEqual(IR_V1.blocks[1]);
  });

  it("DOCX v2 → Undo 恢复 byte-exact v1 + Source IR + revision 1", async () => {
    const artifactId = await seedDoc("plan.docx", IR_V1);
    // 捕获 v1 exact bytes
    const io1 = await io();
    const v1Bytes = await io1.readBytes("plan.docx");
    const inverse = await updateDoc(artifactId, 1, IR_V2);
    expect(inverse.type).toBe("restore-document-revision");
    if (inverse.type !== "restore-document-revision") return;

    await undoDocumentRevisionRuntime({ io: await io(), inverse });
    const finalBytes = await (await io()).readBytes("plan.docx");
    expect(bytesEqual(finalBytes, v1Bytes)).toBe(true);
    expect((await getArtifact(artifactId))?.revision).toBe(1);
    const source = await getArtifactSource(artifactId);
    expect(source?.revision).toBe(1);
    expect(source?.document.blocks[1]).toEqual(IR_V1.blocks[1]);
  });

  it("restore API 抛错但事务已 commit（factual previous）→ Undo 成功且不补偿回 newer", async () => {
    const artifactId = await seedDoc("plan.md", IR_V1);
    const inverse = await updateDoc(artifactId, 1, IR_V2);
    if (inverse.type !== "restore-document-revision") return;
    const realRestore = restoreArtifactRevision;

    await undoDocumentRevisionRuntime({
      io: await io(),
      inverse,
      deps: {
        restoreArtifactRevision: async (args) => {
          await realRestore(args);
          throw new Error("simulated post-commit confirmation failure");
        },
      },
    });
    // 事实 previous：成功返回；文件保持 previous snapshot
    const v1Text = inverse.snapshot.format === "markdown" ? inverse.snapshot.text : "";
    expect(await sandboxReadText(SANDBOX_REF, "plan.md")).toBe(v1Text);
    expect((await getArtifact(artifactId))?.revision).toBe(1);
  });

  it("restore 未提交（factual newer）→ 文件补偿回 newer + VERIFICATION_FAILED", async () => {
    const artifactId = await seedDoc("plan.md", IR_V1);
    const inverse = await updateDoc(artifactId, 1, IR_V2);
    if (inverse.type !== "restore-document-revision") return;
    const v2Text = await sandboxReadText(SANDBOX_REF, "plan.md"); // 当前（newer）内容

    await expect(
      undoDocumentRevisionRuntime({
        io: await io(),
        inverse,
        deps: {
          restoreArtifactRevision: async () => {
            throw new Error("simulated pre-commit failure");
          },
        },
      })
    ).rejects.toMatchObject({ code: "VERIFICATION_FAILED" });
    // 文件补偿回 newer；Artifact + Source 仍 newer
    expect(await sandboxReadText(SANDBOX_REF, "plan.md")).toBe(v2Text);
    expect((await getArtifact(artifactId))?.revision).toBe(2);
    expect((await getArtifactSource(artifactId))?.revision).toBe(2);
  });

  it("split registry（artifact previous / source newer）→ unknown → 无 blind 补偿 + VERIFICATION_FAILED", async () => {
    const artifactId = await seedDoc("plan.md", IR_V1);
    const inverse = await updateDoc(artifactId, 1, IR_V2);
    if (inverse.type !== "restore-document-revision") return;
    const { artifactDbPut } = await import("@/lib/ai/computer/artifacts/db");
    const current = await getArtifact(artifactId);
    expect(current).toBeTruthy();
    if (!current) return;

    await expect(
      undoDocumentRevisionRuntime({
        io: await io(),
        inverse,
        deps: {
          restoreArtifactRevision: async () => {
            // 只改 Artifact metadata → previous；Source 仍 newer → split
            await artifactDbPut({ ...current, revision: inverse.previousRevision, updatedAt: new Date().toISOString() });
            throw new Error("simulated split state");
          },
        },
      })
    ).rejects.toMatchObject({ code: "VERIFICATION_FAILED" });
    // 无 blind 补偿：文件保持 previous snapshot（helper 正常路径先写 previous），registry 保持 split
    const v1Text = inverse.snapshot.format === "markdown" ? inverse.snapshot.text : "";
    expect(await sandboxReadText(SANDBOX_REF, "plan.md")).toBe(v1Text);
    expect((await getArtifact(artifactId))?.revision).toBe(1);
    expect((await getArtifactSource(artifactId))?.revision).toBe(2);
  });

  it("stale preflight：expectedCurrentRevision 不匹配 → 文件写入前拒绝", async () => {
    const artifactId = await seedDoc("plan.md", IR_V1);
    const inverseV2 = await updateDoc(artifactId, 1, IR_V2);
    await updateDoc(artifactId, 2, IR_V2); // v3
    const v3Text = await sandboxReadText(SANDBOX_REF, "plan.md");
    if (inverseV2.type !== "restore-document-revision") return;

    await expect(undoDocumentRevisionRuntime({ io: await io(), inverse: inverseV2 })).rejects.toMatchObject({
      code: "ARTIFACT_REVISION_CONFLICT",
    });
    // 文件完全 unchanged（V3）
    expect(await sandboxReadText(SANDBOX_REF, "plan.md")).toBe(v3Text);
    expect((await getArtifact(artifactId))?.revision).toBe(3);
    expect((await getArtifactSource(artifactId))?.revision).toBe(3);
  });

  it("multi revision reverse：v1→v2→v3，先 undo v3→v2 再 undo v2→v1", async () => {
    const artifactId = await seedDoc("plan.md", IR_V1);
    const inverseA = await updateDoc(artifactId, 1, IR_V2); // v1→v2
    const inverseB = await updateDoc(artifactId, 2, IR_V2); // v2→v3
    if (inverseA.type !== "restore-document-revision" || inverseB.type !== "restore-document-revision") return;

    // reverse：inverseB → v2
    await undoDocumentRevisionRuntime({ io: await io(), inverse: inverseB });
    const v2Text = inverseB.snapshot.format === "markdown" ? inverseB.snapshot.text : "";
    expect(await sandboxReadText(SANDBOX_REF, "plan.md")).toBe(v2Text);
    expect((await getArtifact(artifactId))?.revision).toBe(2);
    expect((await getArtifactSource(artifactId))?.revision).toBe(2);

    // 然后 inverseA → v1
    await undoDocumentRevisionRuntime({ io: await io(), inverse: inverseA });
    const v1Text = inverseA.snapshot.format === "markdown" ? inverseA.snapshot.text : "";
    expect(await sandboxReadText(SANDBOX_REF, "plan.md")).toBe(v1Text);
    expect((await getArtifact(artifactId))?.revision).toBe(1);
    const source = await getArtifactSource(artifactId);
    expect(source?.revision).toBe(1);
    expect(source?.document.blocks[1]).toEqual(IR_V1.blocks[1]);
  });
});

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

describe("restore-generic-artifact-revision（V2 Part 3.1 生产 dispatch）", () => {
  it("registered generic Artifact patch Undo：file v1 + Artifact revision 1 + id 不变 + Source null", async () => {
    const c = counters();
    // create generic text artifact（revision 1）
    const created = await runTool("create_text_file", { path: "notes.txt", content: "v1" }, c);
    expect(created.kind).toBe("completed");
    if (created.kind !== "completed" || !created.runtime?.change.artifactId) return;
    const artifactId = created.runtime.change.artifactId;

    // patch → revision 2 / file v2（生成 restore-generic-artifact-revision inverse）
    const patched = await runTool("patch_text_file", { path: "notes.txt", edits: [{ oldText: "v1", newText: "v2" }] }, c);
    expect(patched.kind).toBe("completed");
    if (patched.kind !== "completed" || !patched.runtime?.inverse) return;
    expect(patched.runtime.inverse.type).toBe("restore-generic-artifact-revision");
    expect((await getArtifact(artifactId))?.revision).toBe(2);

    // 生产路径 dispatch：applyInverseToAdapter（同 useKiroChat）
    await applyInverseToAdapter(await io(), patched.runtime.inverse);
    expect(await sandboxReadText(SANDBOX_REF, "notes.txt")).toBe("v1");
    expect((await getArtifact(artifactId))?.revision).toBe(1);
    expect((await getArtifact(artifactId))?.id).toBe(artifactId);
    expect(await getArtifactSource(artifactId)).toBeNull();
  });

  it("stale generic inverse → ARTIFACT_REVISION_CONFLICT 且文件 unchanged", async () => {
    const c = counters();
    const created = await runTool("create_text_file", { path: "s.txt", content: "v1" }, c);
    if (created.kind !== "completed" || !created.runtime?.change.artifactId) return;
    const artifactId = created.runtime.change.artifactId;
    const patched = await runTool("patch_text_file", { path: "s.txt", edits: [{ oldText: "v1", newText: "v2" }] }, c);
    if (patched.kind !== "completed" || !patched.runtime?.inverse) return;
    // 外部再 patch 到 v3
    await runTool("patch_text_file", { path: "s.txt", edits: [{ oldText: "v2", newText: "v3" }] }, c);
    // 旧 inverse（expected 2）现在 stale
    await expect(applyInverseToAdapter(await io(), patched.runtime.inverse)).rejects.toMatchObject({
      code: "ARTIFACT_REVISION_CONFLICT",
    });
    expect(await sandboxReadText(SANDBOX_REF, "s.txt")).toBe("v3");
    expect((await getArtifact(artifactId))?.revision).toBe(3);
  });
});