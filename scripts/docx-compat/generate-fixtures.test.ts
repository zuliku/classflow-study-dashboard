import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import JSZip from "jszip";
import { DOCX_FIXTURES, generateDocxFixtures, DOCX_COMPAT_OUT_DIR } from "./generate-fixtures";
import { generateLegacyFixtures, buildRealLegacyDocxBytes } from "./generate-legacy";
import { verifyDocxBytes, verifyRenderedDocx } from "@/lib/ai/computer/documents/verify";
import { detectLegacyKiroDocx } from "@/lib/ai/computer/documents/legacy";
import { renderDocx } from "@/lib/ai/computer/documents/docx";

describe("DOCX fixture matrix（生产 renderDocx + runtime integrity）", () => {
  it("生成 5 个 fixture + control.docx，全部通过 runtime integrity（JSZip/XML + Mammoth round-trip）", async () => {
    const results = await generateDocxFixtures();
    expect(results.map((r) => r.fileName).sort()).toEqual(
      ["01-paragraph.docx", "02-headings.docx", "03-lists.docx", "04-table-2x2.docx", "05-schedule.docx", "control.docx"].sort()
    );
    for (const fixture of DOCX_FIXTURES) {
      const bytes = new Uint8Array(await readFile(path.join(DOCX_COMPAT_OUT_DIR, fixture.fileName)));
      expect(bytes.byteLength).toBeGreaterThan(0);
      expect(await verifyDocxBytes(bytes)).toBe(true);
      expect(await verifyRenderedDocx(bytes, fixture.document)).toBe(true);
    }
  });
});

describe("V2.6 真实 legacy 形状 fixture（用户最新失败文件结构）", () => {
  it("06 复刻真实证据：24 direct w:r under w:tc、2 direct w:numPr under w:style、ClassFlow Kiro docProps", async () => {
    const legacyBytes = await buildRealLegacyDocxBytes();
    const detection = await detectLegacyKiroDocx(legacyBytes);
    expect(detection.directTableRuns).toBe(24);
    expect(detection.invalidStyleNumPr).toBe(2);
    expect(detection.legacy).toBe(true);
    const zip = await JSZip.loadAsync(legacyBytes);
    const core = await zip.file("docProps/core.xml")?.async("string");
    const app = await zip.file("docProps/app.xml")?.async("string");
    expect(core).toContain("<dc:creator>ClassFlow Kiro</dc:creator>");
    expect(app).toContain("<Application>ClassFlow Kiro</Application>");
  });

  it("07 = 06 bounded repair 后：legacy=false、directTableRuns=0、invalidStyleNumPr=0、runtime integrity 通过", async () => {
    const { fileName } = (await generateLegacyFixtures())[1];
    const repaired = new Uint8Array(await readFile(path.join(DOCX_COMPAT_OUT_DIR, fileName)));
    const detection = await detectLegacyKiroDocx(repaired);
    expect(detection.legacy).toBe(false);
    expect(detection.directTableRuns).toBe(0);
    expect(detection.invalidStyleNumPr).toBe(0);
    expect(await verifyDocxBytes(repaired)).toBe(true);
    // 修复后表格文本完整保留（24 个 cell 文本 + 2 个 style name）
    const zip = await JSZip.loadAsync(repaired);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const stylesXml = await zip.file("word/styles.xml")?.async("string");
    for (const text of ["星期", "课程", "时间", "地点", "数据结构与算法", "计算机网络", "计算机楼 305"]) {
      expect(documentXml).toContain(text);
    }
    expect(stylesXml).toContain("List0");
    expect(stylesXml).toContain("List1");
  });
});

describe("OpenXML shading regression（V2.4 bugfix）", () => {
  async function documentXmlOf(bytes: Uint8Array): Promise<string> {
    const zip = await JSZip.loadAsync(bytes);
    return (await zip.file("word/document.xml")?.async("string")) ?? "";
  }

  it("所有实际出现的 <w:shd> 都带合法 w:val（生产 renderDocx 的 OOXML 必须 schema-valid）", async () => {
    await generateDocxFixtures();
    for (const fileName of ["01-paragraph.docx", "02-headings.docx", "03-lists.docx", "04-table-2x2.docx", "05-schedule.docx"]) {
      const bytes = new Uint8Array(await readFile(path.join(DOCX_COMPAT_OUT_DIR, fileName)));
      const xml = await documentXmlOf(bytes);
      const shdRe = /<w:shd\b[^>]*>/g;
      let m: RegExpExecArray | null;
      let count = 0;
      while ((m = shdRe.exec(xml))) {
        count += 1;
        expect(m[0]).toMatch(/w:val="/);
      }
      // 04 / 05 必须真实存在表头 shading（证明断言覆盖了实际路径）
      if (fileName === "04-table-2x2.docx" || fileName === "05-schedule.docx") {
        expect(count).toBeGreaterThan(0);
      }
    }
  });

  it("code-block shading（production paragraph shading）同样带合法 w:val", async () => {
    const bytes = await renderDocx({
      title: "code",
      blocks: [{ type: "code", language: "ts", text: "const a = 1;" }],
    });
    const xml = await documentXmlOf(bytes);
    const shd = /<w:shd\b[^>]*>/.exec(xml);
    expect(shd).not.toBeNull();
    expect(shd![0]).toMatch(/w:val="/);
  });
});
