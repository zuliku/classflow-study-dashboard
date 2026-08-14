/**
 * Text-file 工具的结构化二进制格式守卫（V2.3）。
 * create_text_file / patch_text_file 绝不能创建/修改 DOCX/PDF/XLSX/PPTX——
 * 那些必须走 create_document / update_document（否则模型可以用文本工具伪造 Word）。
 */

export const STRUCTURED_BINARY_EXTENSIONS = new Set([".docx", ".xlsx", ".pptx", ".pdf"]);

export function structuredBinaryExtensionOf(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = path.slice(dot).toLowerCase();
  return STRUCTURED_BINARY_EXTENSIONS.has(ext) ? ext : null;
}

export function isStructuredBinaryPath(path: string): boolean {
  return structuredBinaryExtensionOf(path) !== null;
}
