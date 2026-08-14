import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import JSZip from "jszip";
import { DOCX_FIXTURES, generateDocxFixtures, DOCX_COMPAT_OUT_DIR } from "./generate-fixtures";
import { verifyDocxBytes, verifyRenderedDocx } from "@/lib/ai/computer/documents/verify";
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
