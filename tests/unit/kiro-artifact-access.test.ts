import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  getArtifactPreview,
  getArtifactDownloadPayload,
  listRecentArtifactEntries,
  MAX_ARTIFACT_PREVIEW_BYTES,
} from "@/lib/ai/computer/artifacts/access";
import { registerCreatedArtifact, adoptWorkspaceArtifact, removeArtifactRecord } from "@/lib/ai/computer/artifacts/service";
import { clearSandboxAdapter, sandboxWriteText, sandboxWriteBytes } from "@/lib/ai/computer/adapters/sandbox";
import { KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import { KiroDocument } from "@/lib/ai/computer/documents/types";
import { renderMarkdown } from "@/lib/ai/computer/documents/markdown";
import { renderDocx } from "@/lib/ai/computer/documents/docx";
import { ComputerError } from "@/lib/ai/computer/errors";

const SANDBOX_A = "sandbox-access-a";
const SANDBOX_B = "sandbox-access-b";

const workspaces: KiroWorkspaceMeta[] = [
  {
    id: "ws-a",
    name: "论文研究",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    roots: [
      { id: "output", label: "输出", access: "read-write", adapterRef: SANDBOX_A },
      { id: "archive", label: "归档", access: "read-write", adapterRef: SANDBOX_B },
    ],
  },
];

const IR_V1: KiroDocument = {
  title: "研究方案",
  blocks: [
    { type: "heading", level: 1, content: [{ text: "引言" }] },
    { type: "paragraph", content: [{ text: "正文内容" }] },
  ],
};

async function clearAll() {
  await clearSandboxAdapter(SANDBOX_A);
  await clearSandboxAdapter(SANDBOX_B);
  await removeArtifactRecord("artifact-none").catch(() => undefined);
}

beforeEach(async () => {
  await clearAll();
});

describe("recent artifact entries", () => {
  it("sorts updatedAt DESC and returns at most 12", async () => {
    for (let i = 0; i < 15; i++) {
      await registerCreatedArtifact({
        workspaceId: "ws-a",
        rootId: "output",
        relativePath: `f-${String(i).padStart(2, "0")}.md`,
        type: "markdown",
      });
      await sandboxWriteText(SANDBOX_A, `f-${String(i).padStart(2, "0")}.md`, `f${i}`);
      await new Promise((r) => setTimeout(r, 5));
    }
    const entries = await listRecentArtifactEntries({ workspaceId: "ws-a", workspaces, limit: 12 });
    expect(entries.length).toBe(12);
    // updatedAt DESC
    const times = entries.map((e) => Date.parse(e.artifact.updatedAt));
    for (let i = 1; i < times.length; i++) {
      expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
    }
    expect(entries.every((e) => e.availability === "available")).toBe(true);
  });

  it("missing file → missing（不静默重建）；grant/adapter 不可访问 → unavailable 而非 missing", async () => {
    await registerCreatedArtifact({ workspaceId: "ws-a", rootId: "output", relativePath: "gone.md", type: "markdown" });
    await registerCreatedArtifact({ workspaceId: "ws-a", rootId: "browser-root", relativePath: "grant.md", type: "markdown" });
    // browser-root 指向缺失 grant → adapter stat 抛 → unavailable（真实文件可能在电脑里，不能标 missing）
    const grantWorkspaces: KiroWorkspaceMeta[] = [
      {
        ...workspaces[0],
        roots: [
          { id: "output", label: "输出", access: "read-write", adapterRef: SANDBOX_A },
          { id: "browser-root", label: "本地文件夹", access: "read-write", adapterRef: "browser-grant-missing" },
        ],
      },
    ];
    const entries = await listRecentArtifactEntries({ workspaceId: "ws-a", workspaces: grantWorkspaces });
    const gone = entries.find((e) => e.artifact.relativePath === "gone.md");
    expect(gone?.availability).toBe("missing");
    const grant = entries.find((e) => e.artifact.relativePath === "grant.md");
    expect(grant?.availability).toBe("unavailable");
  });
});

describe("preview", () => {
  it("markdown preview：当前文件正文 + truncated 边界；无 Source IR/adapterRef", async () => {
    const artifact = await registerCreatedArtifact({
      workspaceId: "ws-a",
      rootId: "output",
      relativePath: "plan.md",
      type: "markdown",
      document: IR_V1,
    });
    await sandboxWriteText(SANDBOX_A, "plan.md", "# 新标题\n真实文件内容");
    const preview = await getArtifactPreview({ artifactId: artifact.id, workspaces });
    expect(preview.kind).toBe("markdown");
    if (preview.kind !== "markdown") return;
    expect(preview.text).toContain("真实文件内容");
    expect(preview.text).toContain("# 新标题"); // filesystem 是事实来源（非 Source IR）
    const serialized = JSON.stringify(preview);
    expect(serialized).not.toContain("adapterRef");
    expect(serialized).not.toContain("blocks");
  });

  it("text preview：只读文本数据", async () => {
    const artifact = await registerCreatedArtifact({ workspaceId: "ws-a", rootId: "output", relativePath: "notes.txt", type: "text" });
    await sandboxWriteText(SANDBOX_A, "notes.txt", "plain text");
    const preview = await getArtifactPreview({ artifactId: artifact.id, workspaces });
    expect(preview.kind).toBe("text");
  });

  it("docx preview：Source IR 结构事实 + bounded raw text；无 HTML", async () => {
    const artifact = await registerCreatedArtifact({
      workspaceId: "ws-a",
      rootId: "output",
      relativePath: "doc.docx",
      type: "docx",
      document: IR_V1,
    });
    await sandboxWriteBytes(SANDBOX_A, "doc.docx", await renderDocx(IR_V1), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const preview = await getArtifactPreview({ artifactId: artifact.id, workspaces });
    expect(preview.kind).toBe("docx");
    if (preview.kind !== "docx") return;
    expect(preview.facts.title).toBe("研究方案");
    expect(preview.facts.headings).toBe(1);
    expect(preview.facts.paragraphs).toBe(1);
    expect(preview.text).toContain("引言");
    expect(JSON.stringify(preview)).not.toContain("<html");
  });

  it("missing artifact → ARTIFACT_NOT_FOUND", async () => {
    await expect(getArtifactPreview({ artifactId: "artifact-none", workspaces })).rejects.toThrowError(
      expect.objectContaining({ code: "ARTIFACT_NOT_FOUND" })
    );
  });

  it("missing workspace/root → WORKSPACE_NOT_FOUND / ROOT_NOT_FOUND", async () => {
    const artifact = await registerCreatedArtifact({ workspaceId: "ws-other", rootId: "output", relativePath: "a.md", type: "text" });
    await expect(getArtifactPreview({ artifactId: artifact.id, workspaces })).rejects.toThrowError(
      expect.objectContaining({ code: "WORKSPACE_NOT_FOUND" })
    );
    const artifact2 = await registerCreatedArtifact({ workspaceId: "ws-a", rootId: "missing-root", relativePath: "a.md", type: "text" });
    await expect(getArtifactPreview({ artifactId: artifact2.id, workspaces })).rejects.toThrowError(
      expect.objectContaining({ code: "ROOT_NOT_FOUND" })
    );
  });

  it("missing file → RESOURCE_NOT_FOUND", async () => {
    const artifact = await registerCreatedArtifact({ workspaceId: "ws-a", rootId: "output", relativePath: "nofile.md", type: "markdown" });
    await expect(getArtifactPreview({ artifactId: artifact.id, workspaces })).rejects.toThrowError(
      expect.objectContaining({ code: "RESOURCE_NOT_FOUND" })
    );
  });

  it(">20 MiB → FILE_TOO_LARGE（提取前拒绝）", async () => {
    const artifact = await registerCreatedArtifact({ workspaceId: "ws-a", rootId: "output", relativePath: "big.md", type: "markdown" });
    await sandboxWriteText(SANDBOX_A, "big.md", "x".repeat(MAX_ARTIFACT_PREVIEW_BYTES + 1));
    await expect(getArtifactPreview({ artifactId: artifact.id, workspaces })).rejects.toThrowError(
      expect.objectContaining({ code: "FILE_TOO_LARGE" })
    );
  });
});

describe("download payload", () => {
  it("markdown/text/docx：exact bytes + 正确 MIME/name", async () => {
    const md = await registerCreatedArtifact({ workspaceId: "ws-a", rootId: "output", relativePath: "a.md", type: "markdown" });
    await sandboxWriteText(SANDBOX_A, "a.md", "# md");
    const mdPayload = await getArtifactDownloadPayload({ artifactId: md.id, workspaces });
    expect(mdPayload.fileName).toBe("a.md");
    expect(mdPayload.mimeType).toBe("text/markdown;charset=utf-8");
    expect(new TextDecoder().decode(mdPayload.bytes)).toBe("# md");

    const txt = await registerCreatedArtifact({ workspaceId: "ws-a", rootId: "output", relativePath: "b.txt", type: "text" });
    await sandboxWriteText(SANDBOX_A, "b.txt", "plain");
    const txtPayload = await getArtifactDownloadPayload({ artifactId: txt.id, workspaces });
    expect(txtPayload.mimeType).toBe("text/plain;charset=utf-8");

    const docx = await registerCreatedArtifact({ workspaceId: "ws-a", rootId: "output", relativePath: "c.docx", type: "docx", document: IR_V1 });
    const bytes = await renderDocx(IR_V1);
    await sandboxWriteBytes(SANDBOX_A, "c.docx", bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const docxPayload = await getArtifactDownloadPayload({ artifactId: docx.id, workspaces });
    expect(docxPayload.mimeType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(docxPayload.bytes.byteLength).toBe(bytes.byteLength);
    // Document Engine V2：download 链（live bytes → payload → bytes）必须通过强化验证
    const { verifyRenderedDocx } = await import("@/lib/ai/computer/documents/verify");
    expect(await verifyRenderedDocx(docxPayload.bytes, IR_V1)).toBe(true);
  });
});
