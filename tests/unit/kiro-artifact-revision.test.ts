import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  registerCreatedArtifact,
  adoptWorkspaceArtifact,
  getEditableArtifactRevisionState,
  commitArtifactRevision,
  restoreArtifactRevision,
  getArtifactSource,
  getArtifact,
} from "@/lib/ai/computer/artifacts/service";
import { KiroDocument } from "@/lib/ai/computer/documents/types";
import { ComputerError } from "@/lib/ai/computer/errors";

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

async function clearAll() {
  for (const ws of ["ws-a", "ws-b"]) {
    const { removeArtifactsForWorkspace } = await import("@/lib/ai/computer/artifacts/service");
    await removeArtifactsForWorkspace(ws);
  }
}

beforeEach(async () => {
  await clearAll();
});

describe("artifact revision state", () => {
  it("loads only Kiro-owned Markdown/DOCX artifacts with matching source IR", async () => {
    const a = await registerCreatedArtifact({
      workspaceId: "ws-a",
      rootId: "root-out",
      relativePath: "plan.md",
      type: "markdown",
      document: IR_V1,
    });
    const state = await getEditableArtifactRevisionState(a.id, 1);
    expect(state.artifact.revision).toBe(1);
    expect(state.source.revision).toBe(1);
    expect(state.source.document.title).toBe("研究方案");
  });

  it("rejects workspace-existing artifacts as ARTIFACT_NOT_EDITABLE", async () => {
    const a = await adoptWorkspaceArtifact({
      workspaceId: "ws-a",
      rootId: "root-out",
      relativePath: "existing.md",
      type: "markdown",
    });
    await expect(getEditableArtifactRevisionState(a.id, 1)).rejects.toThrowError(
      expect.objectContaining({ code: "ARTIFACT_NOT_EDITABLE" })
    );
  });

  it("rejects generic Kiro-created markdown without source IR as ARTIFACT_NOT_EDITABLE", async () => {
    const a = await registerCreatedArtifact({
      workspaceId: "ws-a",
      rootId: "root-out",
      relativePath: "generic.md",
      type: "markdown",
    });
    await expect(getEditableArtifactRevisionState(a.id, 1)).rejects.toThrowError(
      expect.objectContaining({ code: "ARTIFACT_NOT_EDITABLE" })
    );
  });

  it("rejects stale expectedRevision as ARTIFACT_REVISION_CONFLICT", async () => {
    const a = await registerCreatedArtifact({
      workspaceId: "ws-a",
      rootId: "root-out",
      relativePath: "plan.md",
      type: "markdown",
      document: IR_V1,
    });
    await commitArtifactRevision({ artifactId: a.id, expectedRevision: 1, document: IR_V2 });
    await expect(getEditableArtifactRevisionState(a.id, 1)).rejects.toThrowError(
      expect.objectContaining({ code: "ARTIFACT_REVISION_CONFLICT" })
    );
    // 正确 revision 可读取
    const state = await getEditableArtifactRevisionState(a.id, 2);
    expect(state.artifact.revision).toBe(2);
  });

  it("missing artifact is ARTIFACT_NOT_FOUND", async () => {
    await expect(getEditableArtifactRevisionState("artifact-missing", 1)).rejects.toThrowError(
      expect.objectContaining({ code: "ARTIFACT_NOT_FOUND" })
    );
  });
});

describe("atomic revision commit", () => {
  it("atomically commits metadata revision and Source IR revision together", async () => {
    const a = await registerCreatedArtifact({
      workspaceId: "ws-a",
      rootId: "root-out",
      relativePath: "plan.md",
      type: "markdown",
      document: IR_V1,
    });
    const updated = await commitArtifactRevision({ artifactId: a.id, expectedRevision: 1, document: IR_V2 });
    expect(updated.revision).toBe(2);
    expect(updated.id).toBe(a.id);
    const source = await getArtifactSource(a.id);
    expect(source?.revision).toBe(2);
    expect(source?.document.blocks[1]).toEqual(IR_V2.blocks[1]);
  });

  it("restoreArtifactRevision requires expected current revision and restores both stores", async () => {
    const a = await registerCreatedArtifact({
      workspaceId: "ws-a",
      rootId: "root-out",
      relativePath: "plan.md",
      type: "markdown",
      document: IR_V1,
    });
    await commitArtifactRevision({ artifactId: a.id, expectedRevision: 1, document: IR_V2 });
    // 错误 expectedCurrent → conflict
    await expect(
      restoreArtifactRevision({ artifactId: a.id, expectedCurrentRevision: 1, revision: 1, document: IR_V1 })
    ).rejects.toThrowError(expect.objectContaining({ code: "ARTIFACT_REVISION_CONFLICT" }));
    // 正确 → 双 store 恢复
    const restored = await restoreArtifactRevision({
      artifactId: a.id,
      expectedCurrentRevision: 2,
      revision: 1,
      document: IR_V1,
    });
    expect(restored.revision).toBe(1);
    const source = await getArtifactSource(a.id);
    expect(source?.revision).toBe(1);
    expect(source?.document.blocks[1]).toEqual(IR_V1.blocks[1]);
  });

  it("content revision keeps artifact id/root/path stable", async () => {
    const a = await registerCreatedArtifact({
      workspaceId: "ws-a",
      rootId: "root-out",
      relativePath: "plan.md",
      type: "markdown",
      document: IR_V1,
    });
    const updated = await commitArtifactRevision({ artifactId: a.id, expectedRevision: 1, document: IR_V2 });
    expect(updated.id).toBe(a.id);
    expect(updated.workspaceId).toBe("ws-a");
    expect(updated.rootId).toBe("root-out");
    expect(updated.relativePath).toBe("plan.md");
  });
});
