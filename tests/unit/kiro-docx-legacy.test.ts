import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import JSZip from "jszip";
import { detectLegacyKiroDocx, CURRENT_DOCX_RENDERER_VERSION } from "@/lib/ai/computer/documents/legacy";
import { renderDocx } from "@/lib/ai/computer/documents/docx";
import { verifyDocxBytes, verifyRenderedDocx } from "@/lib/ai/computer/documents/verify";
import { resolveLiveDocxBytes, getArtifactDownloadPayload } from "@/lib/ai/computer/artifacts/access";
import { registerCreatedArtifact, adoptWorkspaceArtifact, getArtifact, getArtifactSource } from "@/lib/ai/computer/artifacts/service";
import { clearSandboxAdapter, sandboxWriteBytes, sandboxReadBytes } from "@/lib/ai/computer/adapters/sandbox";
import { KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import { KiroDocument } from "@/lib/ai/computer/documents/types";

const REF = "sandbox-legacy-ref";

const workspace: KiroWorkspaceMeta = {
  id: "ws-legacy",
  name: "论文研究",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  roots: [{ id: "output", label: "输出", access: "read-write", adapterRef: REF }],
};

const SOURCE_IR: KiroDocument = {
  title: "本周课表",
  stylePreset: "business-report",
  blocks: [
    {
      type: "table",
      header: [[{ text: "星期" }], [{ text: "课程" }]],
      rows: [[[{ text: "周一" }], [{ text: "数据结构" }]]],
    },
  ],
};

/** test-only legacy DOCX：完整 package + 真实错误签名（w:tc → w:r direct child；w:style → w:numPr direct child） */
async function buildLegacyDocxBytes(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
  );
  zip.file(
    "docProps/core.xml",
    `<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Kiro</dc:creator></cp:coreProperties>`
  );
  zip.file(
    "docProps/app.xml",
    `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Kiro</Application></Properties>`
  );
  const legacyCells = Array.from({ length: 24 }, (_, i) =>
    `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:r><w:t>cell${i}</w:t></w:r></w:tc>`
  ).join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:tbl><w:tr>${legacyCells}</w:tr></w:tbl></w:body></w:document>`
  );
  const legacyStyles = Array.from({ length: 2 }, (_, i) =>
    `<w:style w:type="paragraph" w:styleId="List${i}"><w:name w:val="List${i}"/><w:numPr><w:numId w:val="1"/></w:numPr></w:style>`
  ).join("");
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${legacyStyles}</w:styles>`
  );
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return new Uint8Array(bytes);
}

beforeEach(async () => {
  await clearSandboxAdapter(REF);
});

describe("detectLegacyKiroDocx", () => {
  it("真实 legacy signature → legacy=true，且计数正确（24 个 direct table runs / 2 个 invalid style numPr）", async () => {
    const legacy = await buildLegacyDocxBytes();
    const d = await detectLegacyKiroDocx(legacy);
    expect(d.legacy).toBe(true);
    expect(d.directTableRuns).toBe(24);
    expect(d.invalidStyleNumPr).toBe(2);
  });

  it("当前 production renderDocx 输出 → legacy=false", async () => {
    const bytes = await renderDocx(SOURCE_IR);
    const d = await detectLegacyKiroDocx(bytes);
    expect(d.legacy).toBe(false);
    expect(d.directTableRuns).toBe(0);
    expect(d.invalidStyleNumPr).toBe(0);
  });

  it("非 docx bytes → legacy=false（不 throw）", async () => {
    const d = await detectLegacyKiroDocx(new Uint8Array([1, 2, 3]));
    expect(d.legacy).toBe(false);
  });
});

describe("Legacy DOCX self-heal（resolveLiveDocxBytes）", () => {
  it("legacy kiro-created + matching Source IR → 自动 migration：bytes 替换、验证通过、文件写回", async () => {
    const legacyBytes = await buildLegacyDocxBytes();
    const artifact = await registerCreatedArtifact({
      workspaceId: "ws-legacy",
      rootId: "output",
      relativePath: "legacy.docx",
      type: "docx",
      title: "本周课表",
      document: SOURCE_IR,
    });
    await sandboxWriteBytes(REF, "legacy.docx", legacyBytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

    const { bytes, migrated } = await resolveLiveDocxBytes({ artifactId: artifact.id, workspaces: [workspace] });
    expect(migrated).toBe(true);
    // legacy bytes 被 current renderer bytes 替换
    expect(Buffer.from(bytes).toString("base64")).not.toBe(Buffer.from(legacyBytes).toString("base64"));
    expect(await verifyDocxBytes(bytes)).toBe(true);
    expect(await verifyRenderedDocx(bytes, SOURCE_IR)).toBe(true);
    expect((await detectLegacyKiroDocx(bytes)).legacy).toBe(false);
    // Sandbox 中原文件已被替换
    const onDisk = await sandboxReadBytes(REF, "legacy.docx");
    expect(Buffer.from(onDisk).toString("base64")).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("workspace-existing DOCX：即使 legacy=true 也绝不自动重写", async () => {
    const legacyBytes = await buildLegacyDocxBytes();
    const artifact = await adoptWorkspaceArtifact({
      workspaceId: "ws-legacy",
      rootId: "output",
      relativePath: "user.docx",
      type: "docx",
      title: "用户文件",
    });
    await sandboxWriteBytes(REF, "user.docx", legacyBytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

    const { bytes, migrated } = await resolveLiveDocxBytes({ artifactId: artifact.id, workspaces: [workspace] });
    expect(migrated).toBe(false);
    expect(Buffer.from(bytes).toString("base64")).toBe(Buffer.from(legacyBytes).toString("base64"));
    // 文件未被改写
    const onDisk = await sandboxReadBytes(REF, "user.docx");
    expect(Buffer.from(onDisk).toString("base64")).toBe(Buffer.from(legacyBytes).toString("base64"));
  });

  it("legacy kiro-created + 无 Source IR → 绝不原样导出（VERIFICATION_FAILED 并指引重新生成）", async () => {
    const legacyBytes = await buildLegacyDocxBytes();
    // kiro-created 但没传 document → 无 Source IR
    const artifact = await registerCreatedArtifact({
      workspaceId: "ws-legacy",
      rootId: "output",
      relativePath: "no-source.docx",
      type: "docx",
      title: "旧文件",
    });
    expect(await getArtifactSource(artifact.id)).toBeNull();
    await sandboxWriteBytes(REF, "no-source.docx", legacyBytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

    await expect(getArtifactDownloadPayload({ artifactId: artifact.id, workspaces: [workspace] })).rejects.toThrowError(
      expect.objectContaining({ code: "VERIFICATION_FAILED" })
    );
    // 文件未被改写
    const onDisk = await sandboxReadBytes(REF, "no-source.docx");
    expect(Buffer.from(onDisk).toString("base64")).toBe(Buffer.from(legacyBytes).toString("base64"));
  });

  it("普通 verify 失败（非 legacy signature）→ 不 migration，正常报错", async () => {
    const artifact = await registerCreatedArtifact({
      workspaceId: "ws-legacy",
      rootId: "output",
      relativePath: "bad.docx",
      type: "docx",
      title: "坏文件",
      document: SOURCE_IR,
    });
    // 损坏但不是 legacy signature：直接扔随机字节
    await sandboxWriteBytes(REF, "bad.docx", new Uint8Array([1, 2, 3]), "application/octet-stream");
    await expect(getArtifactDownloadPayload({ artifactId: artifact.id, workspaces: [workspace] })).rejects.toThrowError(
      expect.objectContaining({ code: "VERIFICATION_FAILED" })
    );
  });

  it("current DOCX → migrated=false（不重复重写）", async () => {
    const bytes = await renderDocx(SOURCE_IR);
    const artifact = await registerCreatedArtifact({
      workspaceId: "ws-legacy",
      rootId: "output",
      relativePath: "current.docx",
      type: "docx",
      title: "本周课表",
      document: SOURCE_IR,
    });
    await sandboxWriteBytes(REF, "current.docx", bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const { migrated } = await resolveLiveDocxBytes({ artifactId: artifact.id, workspaces: [workspace] });
    expect(migrated).toBe(false);
  });

  it("新 create_document Source IR 记录 CURRENT_DOCX_RENDERER_VERSION", async () => {
    const artifact = await registerCreatedArtifact({
      workspaceId: "ws-legacy",
      rootId: "output",
      relativePath: "v2.docx",
      type: "docx",
      title: "x",
      document: SOURCE_IR,
    });
    const source = await getArtifactSource(artifact.id);
    expect(source?.rendererVersion).toBe(CURRENT_DOCX_RENDERER_VERSION);
    // 旧记录（无字段）继续合法
    expect(await getArtifact(artifact.id)).not.toBeNull();
  });
});
