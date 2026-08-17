/**
 * Legacy Kiro DOCX 真实形状 fixture（V2.6）。
 *
 * 复刻用户最新真实失败文件（本周课表_最新.docx）的关键证据：
 * - docProps/core.xml creator = ClassFlow Kiro；docProps/app.xml Application = ClassFlow Kiro
 * - 4 列 × 6 行表格 = 24 个 w:tc → w:r direct child
 * - 2 个 w:style → w:numPr direct child
 *
 * 输出：
 * - 06-legacy-real.docx     原始 legacy package（必须被 OpenXmlValidator 拒绝）
 * - 07-legacy-repaired.docx repairLegacyKiroDocx 修复后（必须 0 errors）
 *
 * 运行：npm run test:docx:fixtures（generate-fixtures.test.ts 调用）。
 */
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import JSZip from "jszip";
import { DOCX_COMPAT_OUT_DIR } from "./generate-fixtures";
import { repairLegacyKiroDocx } from "@/lib/ai/computer/documents/legacyRepair";

/** 与用户真实文件同 shape 的 legacy package（12 entries 最小 package） */
export async function buildRealLegacyDocxBytes(): Promise<Uint8Array> {
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
    `<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>ClassFlow Kiro</dc:creator></cp:coreProperties>`
  );
  zip.file(
    "docProps/app.xml",
    `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>ClassFlow Kiro</Application></Properties>`
  );

  const schedule: string[][] = [
    ["星期", "课程", "时间", "地点"],
    ["周一", "数据结构与算法", "08:00–09:40", "计算机楼 102"],
    ["周二", "概率论与数理统计", "10:00–11:40", "教三 305"],
    ["周三", "操作系统", "14:00–15:40", "计算机楼 208"],
    ["周四", "学术英语写作", "13:00–14:40", "外语楼 207"],
    ["周五", "计算机网络", "10:00–11:40", "计算机楼 305"],
  ];
  const cellXml = (text: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:r><w:rPr><w:rFonts w:ascii="Aptos" w:eastAsia="微软雅黑" w:hAnsi="Aptos"/></w:rPr><w:t>${text}</w:t></w:r></w:tc>`;
  const rowsXml = schedule
    .map((row) => `<w:tr>${row.map(cellXml).join("")}</w:tr>`)
    .join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:tbl>${rowsXml}</w:tbl></w:body></w:document>`
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

/** 生成 06（真实 legacy）与 07（bounded repair 后），供 OpenXmlValidator / LibreOffice gate */
export async function generateLegacyFixtures(outDir: string = DOCX_COMPAT_OUT_DIR): Promise<{
  fileName: string;
  byteLength: number;
}[]> {
  await mkdir(outDir, { recursive: true });
  const legacyBytes = await buildRealLegacyDocxBytes();
  await writeFile(path.join(outDir, "06-legacy-real.docx"), Buffer.from(legacyBytes));
  const repair = await repairLegacyKiroDocx(legacyBytes);
  await writeFile(path.join(outDir, "07-legacy-repaired.docx"), Buffer.from(repair.bytes));
  return [
    { fileName: "06-legacy-real.docx", byteLength: legacyBytes.byteLength },
    { fileName: "07-legacy-repaired.docx", byteLength: repair.bytes.byteLength },
  ];
}
