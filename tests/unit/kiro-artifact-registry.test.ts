import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  registerCreatedArtifact,
  adoptWorkspaceArtifact,
  getArtifact,
  findArtifactByLocation,
  listArtifactsForWorkspace,
  updateArtifactLocation,
  getArtifactSource,
  removeArtifactsForWorkspace,
} from "@/lib/ai/computer/artifacts/service";
import { KiroDocument } from "@/lib/ai/computer/documents/types";

const doc: KiroDocument = {
  title: "研究方案",
  blocks: [
    { type: "heading", level: 1, content: [{ text: "引言" }] },
    { type: "paragraph", content: [{ text: "正文" }] },
  ],
};

async function clearAll() {
  await removeArtifactsForWorkspace("ws-a");
  await removeArtifactsForWorkspace("ws-b");
}

beforeEach(async () => {
  await clearAll();
});

describe("artifact registry", () => {
  it("registers Kiro-created Markdown with revision 1 and source IR", async () => {
    const a = await registerCreatedArtifact({
      workspaceId: "ws-a",
      rootId: "root-out",
      relativePath: "方案.md",
      type: "markdown",
      title: "研究方案",
      sourceTaskId: "task-1",
      document: doc,
    });
    expect(a.id).toMatch(/^artifact-/);
    expect(a.revision).toBe(1);
    expect(a.source).toBe("kiro-created");
    expect(a.sourceTaskId).toBe("task-1");
    const source = await getArtifactSource(a.id);
    expect(source?.document.title).toBe("研究方案");
    expect(source?.revision).toBe(1);
  });

  it("generic text Artifact stores no source IR", async () => {
    const a = await registerCreatedArtifact({
      workspaceId: "ws-a",
      rootId: "root-out",
      relativePath: "notes.txt",
      type: "text",
    });
    expect(a.type).toBe("text");
    expect(await getArtifactSource(a.id)).toBeNull();
  });

  it("adopted workspace Artifact stores no source IR", async () => {
    const a = await adoptWorkspaceArtifact({
      workspaceId: "ws-a",
      rootId: "root-out",
      relativePath: "existing.md",
      type: "markdown",
    });
    expect(a.source).toBe("workspace-existing");
    expect(await getArtifactSource(a.id)).toBeNull();
  });

  it("location update keeps stable artifact id and revision", async () => {
    const a = await registerCreatedArtifact({
      workspaceId: "ws-a",
      rootId: "root-out",
      relativePath: "draft.md",
      type: "markdown",
      document: doc,
    });
    const moved = await updateArtifactLocation(a.id, "root-archive", "archive/final.md");
    expect(moved.id).toBe(a.id);
    expect(moved.revision).toBe(1);
    expect(moved.relativePath).toBe("archive/final.md");
    expect(moved.rootId).toBe("root-archive");
    // 源位置不再有 record；新位置找到同一 id
    expect(await findArtifactByLocation("ws-a", "root-out", "draft.md")).toBeNull();
    expect(await findArtifactByLocation("ws-a", "root-archive", "archive/final.md")).toMatchObject({ id: a.id });
  });

  it("same logical location re-registration replaces stale identity (new id, revision 1, old source removed)", async () => {
    const first = await registerCreatedArtifact({
      workspaceId: "ws-a",
      rootId: "root-out",
      relativePath: "plan.md",
      type: "markdown",
      document: doc,
    });
    const second = await registerCreatedArtifact({
      workspaceId: "ws-a",
      rootId: "root-out",
      relativePath: "plan.md",
      type: "markdown",
      document: { title: "新版", blocks: [{ type: "paragraph", content: [{ text: "x" }] }] },
    });
    // 同一个 logical location 只有一个 record
    const all = await listArtifactsForWorkspace("ws-a");
    expect(all.filter((a) => a.relativePath === "plan.md")).toHaveLength(1);
    // 新 identity（id 不同、revision 1）；旧 source 已删除
    expect(second.id).not.toBe(first.id);
    expect(second.revision).toBe(1);
    expect(await getArtifactSource(first.id)).toBeNull();
    expect(await getArtifact(first.id)).toBeNull();
    expect(await getArtifactSource(second.id)).not.toBeNull();
  });

  it("workspace cleanup removes Artifact metadata and source IR", async () => {
    await registerCreatedArtifact({
      workspaceId: "ws-a",
      rootId: "root-out",
      relativePath: "a.md",
      type: "markdown",
      document: doc,
    });
    await registerCreatedArtifact({ workspaceId: "ws-b", rootId: "root-out", relativePath: "b.md", type: "text" });
    await removeArtifactsForWorkspace("ws-a");
    expect(await listArtifactsForWorkspace("ws-a")).toHaveLength(0);
    // 其它 workspace 不受影响
    expect(await listArtifactsForWorkspace("ws-b")).toHaveLength(1);
  });
});
