import JSZip from "jszip";

/** 构造最小可解析 text PDF（带正确 xref 偏移），供测试与 E2E 使用 */
export function buildMinimalPdf(text: string): Uint8Array {
  return buildMultiPageTextPdf([text]);
}

/** 构造多页 text PDF：每页一个 content stream（ASCII 文本；Helvetica WinAnsi）。
 *  注意：pdf.js 对超出页面宽/高的文本 run 会裁剪（12pt Helvetica ≈ 每行 ~91 字符、每页 ~50 行）
 *  → 每 ~80 字符换一行（0 -14 Td）；大文本页需通过 pageHeight 提供足够高度。 */
export function buildMultiPageTextPdf(pageTexts: string[], opts?: { pageHeight?: number }): Uint8Array {
  const chunk = (s: string, size = 80): string[] => {
    const out: string[] = [];
    for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
    return out;
  };
  const escapePdf = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const pageHeight = opts?.pageHeight ?? 792;
  const streams = pageTexts.map((text) => {
    const ops = chunk(text)
      .map((c, i) => `${i === 0 ? "" : "0 -14 Td "}(${escapePdf(c)}) Tj`)
      .join(" ");
    return `BT /F1 12 Tf 72 ${pageHeight - 72} Td ${ops} ET\n`;
  });
  const objects: string[] = [];
  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objects.push(`<< /Type /Pages /Kids [${streams.map((_, i) => `${3 + i} 0 R`).join(" ")}] /Count ${streams.length} >>`);
  for (let i = 0; i < streams.length; i++) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 ${pageHeight}] /Resources << /Font << /F1 ${2 + streams.length + 1} 0 R >> >> /Contents ${2 + streams.length + 2 + i} 0 R >>`
    );
  }
  const fontObjIndex = 2 + streams.length + 1;
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);
  for (const s of streams) {
    objects.push(`<< /Length ${Buffer.byteLength(s, "utf8")} >>\nstream\n${s}endstream`);
  }

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "utf8"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(out, "utf8");
  out += `xref\n0 ${objects.length + 1}\n`;
  out += "0000000000 65535 f \n";
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  void fontObjIndex;
  return Buffer.from(out, "utf8");
}

/** 构造最小 3 页无文本 PDF（扫描件特征：多页 + 无文本），供测试使用 */
export function buildScannedPdf(): Uint8Array {
  const blankPages: string[] = [];
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>");
  for (let i = 0; i < 3; i++) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents ${7 + i} 0 R >>`
    );
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (let i = 0; i < 3; i++) {
    objects.push(`<< /Length 0 >>\nstream\nendstream`);
  }

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "utf8"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(out, "utf8");
  out += `xref\n0 ${objects.length + 1}\n`;
  out += "0000000000 65535 f \n";
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(out, "utf8");
}

/** 构造最小 XLSX（SheetJS 写出），供测试使用 */
export async function buildMinimalXlsx(sheets: Record<string, unknown[][]>): Promise<Blob> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([out as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** XML 转义（fixture 侧） */
function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 构造最小 PPTX（每张幻灯片一组文本 Run），供测试使用 */
export async function buildMinimalPptx(slides: string[][]): Promise<Blob> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
</Types>`
  );
  slides.forEach((runs, i) => {
    const tree = runs
      .map(
        (t) =>
          `<p:sp><p:txBody><a:p><a:r><a:t xml:space="preserve">${escapeXml(t)}</a:t></a:r></a:p></p:txBody></p:sp>`
      )
      .join("");
    zip.file(
      `ppt/slides/slide${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>${tree}</p:spTree></p:cSld></p:sld>`
    );
  });
  return zip.generateAsync({ type: "blob" });
}

/** 构造最小 DOCX（mammoth 可提取），供测试使用 */
export async function buildMinimalDocx(paragraphs: string[]): Promise<Blob> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  const body = paragraphs
    .map(
      (p) =>
        `<w:p><w:r><w:t xml:space="preserve">${p.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</w:t></w:r></w:p>`
    )
    .join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  );
  return zip.generateAsync({ type: "blob" });
}
