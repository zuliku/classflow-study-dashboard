import { ExtractedDocument, normalizeLineEndings, truncateText } from "@/lib/ai/attachments/extractors";

/**
 * 表格文本提取（SheetJS；.xlsx / .xls，不保留样式与公式结果以外的格式，只做 AI Context）。
 * - 每个工作表一段 `## 工作表：<name>`，行内单元格 Tab 分隔（与常见 TSV 导出一致）；
 * - 空行丢弃；公式取计算值（SheetJS 默认行为）。
 * V1：extractXlsxRawText 提供 untruncated 完整正文（search_project_file 复用）；
 * extractXlsx 保持 bounded extraction（100k truncate），与 docx 同语义。
 */
const XLSX_MAX_BYTES = 20 * 1024 * 1024;
export async function extractXlsxRawText(file: Blob, opts?: { signal?: AbortSignal }): Promise<string> {
  if (file.size > XLSX_MAX_BYTES) throw new Error(`表格过大（${(file.size / 1048576).toFixed(1)}MB），上限 20MB`);
  opts?.signal?.throwIfAborted();
  const XLSX = await import("xlsx");
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const sections: string[] = [];
  const names: string[] = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
  for (const name of names) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    // header:1 → 二维数组；defval:"" 保证空单元格占位不断列；blankrows:false 丢全空行
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "", blankrows: false });
    const lines: string[] = [];
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const cells = row.map((c) => String(c ?? "").trim());
      // 整行空白跳过（trailing 空列已由 defval 补齐，逐行 trim 尾部空串）
      let end = cells.length;
      while (end > 0 && cells[end - 1] === "") end -= 1;
      if (end === 0) continue;
      lines.push(cells.slice(0, end).join("\t"));
    }
    if (lines.length === 0) continue;
    sections.push(`## 工作表：${name}\n${lines.join("\n")}`);
  }
  return normalizeLineEndings(sections.join("\n\n")).trim();
}

/** bounded extraction（沿用既有语义；search 请用 extractXlsxRawText） */
export async function extractXlsx(file: Blob): Promise<ExtractedDocument> {
  const normalized = await extractXlsxRawText(file);
  if (!normalized) {
    throw new Error("empty-workbook");
  }
  const { text, truncated } = truncateText(normalized);
  return { text, truncated };
}
