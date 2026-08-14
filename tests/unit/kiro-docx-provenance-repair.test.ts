import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import JSZip from "jszip";
import { detectLegacyKiroDocx } from "@/lib/ai/computer/documents/legacy";
import { inspectKiroDocxProvenance, readDocxDocProps } from "@/lib/ai/computer/documents/provenance";
import {
  repairDocumentXml,
  repairStylesXml,
  repairLegacyKiroDocx,
} from "@/lib/ai/computer/documents/legacyRepair";
import { renderDocx } from "@/lib/ai/computer/documents/docx";
import { verifyDocxBytes } from "@/lib/ai/computer/documents/verify";
import { DOCX_CREATOR, DOCX_RENDERER_MARKER } from "@/lib/ai/computer/runtimeVersion";
import { registerCreatedArtifact, adoptWorkspaceArtifact, getArtifact, getArtifactSource } from "@/lib/ai/computer/artifacts/service";
import { KiroDocument } from "@/lib/ai/computer/documents/types";

const SOURCE_IR: KiroDocument = {
  title: "本周课表",
  stylePreset: "business-report",
  blocks: [
    {
      type: "table",
      header: [[{ text: "星期" }], [{ text: "课程" }], [{ text: "时间" }], [{ text: "地点" }]],
      rows: [
        [[{ text: "周一" }], [{ text: "数据结构" }], [{ text: "08:00" }], [{ text: "A楼" }]],
        [[{ text: "周二" }], [{ text: "概率论" }], [{ text: "10:00" }], [{ text: "B楼" }]],
      ],
    },
  ],
};

const LEGACY_DOCUMENT_XML = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:r><w:rPr><w:b/></w:rPr><w:t>星期</w:t></w:r><w:r><w:t>A</w:t></w:r></w:tc><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:r><w:t>课程</w:t></w:r></w:tc></w:tr></w:tbl></w:body></w:document>`;

const LEGACY_STYLES_XML = `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="List0"><w:name w:val="List0"/><w:numPr><w:numId w:val="1"/></w:numPr></w:style><w:style w:type="paragraph" w:styleId="List1"><w:name w:val="List1"/><w:basedOn w:val="List0"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:style></w:styles>`;

describe("inspectKiroDocxProvenance", () => {
  it("真实 legacy 文件：legacyStructuralSignature + legacyKiroProducer=true，currentRendererMarker=false", async () => {
    const { buildRealLegacyDocxBytes } = await import("@/scripts/docx-compat/generate-legacy");
    const bytes = await buildRealLegacyDocxBytes();
    const p = await inspectKiroDocxProvenance(bytes);
    expect(p.legacyStructuralSignature).toBe(true);
    expect(p.directTableRuns).toBe(24);
    expect(p.invalidStyleNumPr).toBe(2);
    expect(p.legacyKiroProducer).toBe(true);
    expect(p.currentRendererMarker).toBe(false);
    expect(p.creator).toBe("ClassFlow Kiro");
    expect(p.application).toBe("ClassFlow Kiro");
  });

  it("当前 renderDocx 输出：currentRendererMarker=true、legacyKiroProducer=false、legacyStructuralSignature=false", async () => {
    const bytes = await renderDocx(SOURCE_IR);
    const p = await inspectKiroDocxProvenance(bytes);
    expect(p.legacyStructuralSignature).toBe(false);
    expect(p.legacyKiroProducer).toBe(false);
    expect(p.currentRendererMarker).toBe(true);
    expect(p.creator).toBe(DOCX_CREATOR);
    expect(p.description).toContain(DOCX_RENDERER_MARKER);
  });

  it("未知 producer（creator 非 ClassFlow Kiro）→ legacyKiroProducer=false", async () => {
    const zip = new JSZip();
    zip.file("docProps/core.xml", `<cp:coreProperties xmlns:cp="x"><dc:creator>Someone Else</dc:creator></cp:coreProperties>`);
    zip.file("docProps/app.xml", `<Properties xmlns="x"><Application>Microsoft Word</Application></Properties>`);
    const bytes = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
    const p = await inspectKiroDocxProvenance(bytes);
    expect(p.legacyKiroProducer).toBe(false);
    expect(p.currentRendererMarker).toBe(false);
  });
});

describe("repairLegacyKiroDocx（bounded repair，只修两种已确认签名）", () => {
  it("document.xml：tcPr 后的连续 direct runs 包入 <w:p>，rPr/文本/顺序保留", () => {
    const repaired = repairDocumentXml(LEGACY_DOCUMENT_XML);
    // 两个 cell 的 direct runs 都被包入 p
    expect((repaired.match(/<w:p>/g) ?? []).length).toBe(2);
    expect(repaired).toContain("<w:tc><w:tcPr><w:tcW w:w=\"2000\" w:type=\"dxa\"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>星期</w:t></w:r><w:r><w:t>A</w:t></w:r></w:p></w:tc>");
    expect(repaired).toContain("</w:tc><w:tc><w:tcPr><w:tcW w:w=\"2000\" w:type=\"dxa\"/></w:tcPr><w:p><w:r><w:t>课程</w:t></w:r></w:p></w:tc>");
    // 文本顺序保留
    const textOrder = ["星期", "A", "课程"];
    let idx = -1;
    for (const t of textOrder) {
      const i = repaired.indexOf(t);
      expect(i).toBeGreaterThan(idx);
      idx = i;
    }
  });

  it("styles.xml：direct numPr 移入 pPr（无 pPr → 创建；有 pPr → 追加）", () => {
    const repaired = repairStylesXml(LEGACY_STYLES_XML);
    expect(repaired).toContain(`<w:style w:type="paragraph" w:styleId="List0"><w:name w:val="List0"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>`);
    // List1 已有 pPr → numPr 追加进 pPr（在 spacing 之后）
    expect(repaired).toContain(`<w:pPr><w:spacing w:after="0"/><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr>`);
    expect((repaired.match(/<w:numPr/g) ?? []).length).toBe(2);
  });

  it("完整 package repair：legacy=false、directTableRuns=0、invalidStyleNumPr=0、verifyDocxBytes=true、文本保留", async () => {
    const { buildRealLegacyDocxBytes } = await import("@/scripts/docx-compat/generate-legacy");
    const legacy = await buildRealLegacyDocxBytes();
    const result = await repairLegacyKiroDocx(legacy);
    expect(result.repaired).toBe(true);
    expect(result.before.directTableRuns).toBe(24);
    expect(result.before.invalidStyleNumPr).toBe(2);
    expect(result.after.directTableRuns).toBe(0);
    expect(result.after.invalidStyleNumPr).toBe(0);
    expect((await detectLegacyKiroDocx(result.bytes)).legacy).toBe(false);
    expect(await verifyDocxBytes(result.bytes)).toBe(true);
    // 文本全部保留
    const zip = await JSZip.loadAsync(result.bytes);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const stylesXml = await zip.file("word/styles.xml")?.async("string");
    for (const t of ["星期", "课程", "时间", "地点", "数据结构与算法", "计算机网络"]) {
      expect(documentXml).toContain(t);
    }
    expect(stylesXml).toContain("List0");
    expect(stylesXml).toContain("List1");
  });

  it("当前 renderer 输出 → repaired=false（不做任何手术）", async () => {
    const current = await renderDocx(SOURCE_IR);
    const result = await repairLegacyKiroDocx(current);
    expect(result.repaired).toBe(false);
  });
});

describe("adopt 不降级 kiro-created identity（V2.6 provenance invariant）", () => {
  beforeEach(async () => {
    const { clearSandboxAdapter } = await import("@/lib/ai/computer/adapters/sandbox");
    await clearSandboxAdapter("sandbox-provenance-ref");
  });

  it("create DOCX → 同路径 adopt → artifact id 不变、source=kiro-created、Source IR 保留、revision 不变", async () => {
    const { sandboxWriteBytes } = await import("@/lib/ai/computer/adapters/sandbox");
    const { resolveLiveDocxBytes } = await import("@/lib/ai/computer/artifacts/access");
    const ws = {
      id: "ws-provenance",
      name: "w",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      roots: [{ id: "output", label: "输出", access: "read-write" as const, adapterRef: "sandbox-provenance-ref" }],
    };
    const bytes = await renderDocx(SOURCE_IR);
    await sandboxWriteBytes("sandbox-provenance-ref", "课表.docx", bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

    const created = await registerCreatedArtifact({
      workspaceId: ws.id,
      rootId: "output",
      relativePath: "课表.docx",
      type: "docx",
      title: "本周课表",
      document: SOURCE_IR,
    });
    expect(created.source).toBe("kiro-created");

    // 同路径 lazy adopt → 绝不降级
    const adopted = await adoptWorkspaceArtifact({
      workspaceId: ws.id,
      rootId: "output",
      relativePath: "课表.docx",
      type: "docx",
      title: "本周课表",
    });
    expect(adopted.id).toBe(created.id);
    expect(adopted.source).toBe("kiro-created");
    expect(adopted.revision).toBe(created.revision);
    expect(await getArtifact(created.id)).not.toBeNull();
    const source = await getArtifactSource(created.id);
    expect(source).not.toBeNull();
    expect(source!.revision).toBe(created.revision);

    // 下载仍走 Level A（matching Source IR）
    const { migrated } = await resolveLiveDocxBytes({ artifactId: created.id, workspaces: [ws] });
    expect(migrated).toBe(false); // 文件已是 current renderer，无需 migration
  });

  it("workspace-existing 同路径再次 adopt → 复用 identity（不建新 id）", async () => {
    const first = await adoptWorkspaceArtifact({
      workspaceId: "ws-provenance-2",
      rootId: "output",
      relativePath: "user.txt",
      type: "markdown",
      title: "用户文件",
    });
    const second = await adoptWorkspaceArtifact({
      workspaceId: "ws-provenance-2",
      rootId: "output",
      relativePath: "user.txt",
      type: "markdown",
      title: "用户文件",
    });
    expect(second.id).toBe(first.id);
    expect(second.source).toBe("workspace-existing");
  });
});

