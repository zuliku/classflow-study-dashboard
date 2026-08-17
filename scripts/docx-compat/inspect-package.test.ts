import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { generateDocxFixtures, DOCX_COMPAT_OUT_DIR } from "./generate-fixtures";
import { inspectDocxPackage, summarizeManifest } from "./inspect-package";

describe("DOCX package forensics（01-paragraph vs control.docx）", () => {
  it("生成并对比 package manifest（定位 numbering/theme/命名空间差异）", async () => {
    await generateDocxFixtures();
    const kiro = await inspectDocxPackage(path.join(DOCX_COMPAT_OUT_DIR, "01-paragraph.docx"));
    const control = await inspectDocxPackage(path.join(DOCX_COMPAT_OUT_DIR, "control.docx"));

    const kiroEntryNames = kiro.entries.map((e) => e.name).sort();
    const controlEntryNames = control.entries.map((e) => e.name).sort();

    console.log("=== Kiro 01-paragraph manifest ===\n" + summarizeManifest(kiro));
    console.log("=== control.docx manifest ===\n" + summarizeManifest(control));
    console.log("=== only in Kiro 01 ===\n" + kiroEntryNames.filter((n) => !controlEntryNames.includes(n)).join("\n"));
    console.log("=== only in control ===\n" + controlEntryNames.filter((n) => !kiroEntryNames.includes(n)).join("\n"));

    // 基本完整性（forensics 断言，不是 Word compatibility 断言）
    expect(kiro.entries.length).toBeGreaterThanOrEqual(8);
    expect(kiro.documentNamespaces.some((n) => n.includes("wordprocessingml/2006/main"))).toBe(true);
    // Forensics 结论（V2.4 实测）：docx@9.7.1 的 minimal control 与 Kiro 01-paragraph
    // 具有完全相同的 entry 集合与命名空间（numbering.xml 是 library 默认，两侧都有）。
    // 无 package-level 差异 → 若 Word 打不开，问题不在「Kiro 额外携带的 package 部分」。
    expect(kiroEntryNames).toEqual(controlEntryNames);
    expect(kiro.documentNamespaces).toEqual(control.documentNamespaces);
    expect(kiro.hasNumbering).toBe(true);
    expect(control.hasNumbering).toBe(true);
  });
});
