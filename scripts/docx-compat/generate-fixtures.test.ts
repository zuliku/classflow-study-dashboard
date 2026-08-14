import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { DOCX_FIXTURES, generateDocxFixtures, DOCX_COMPAT_OUT_DIR } from "./generate-fixtures";
import { verifyDocxBytes, verifyRenderedDocx } from "@/lib/ai/computer/documents/verify";

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
