import { ExtractedDocument, normalizeLineEndings, truncateWithPages } from "@/lib/ai/attachments/extractors";
import { MAX_EXTRACTED_CHARS } from "@/lib/ai/attachments/limits";

/**
 * PDF 文本提取：只做 text PDF（不做视觉还原 / 多栏 / annotation）。
 * 提取结果接近空 → 判断为扫描件（possiblyScanned）。
 */
export async function extractPdf(file: Blob): Promise<ExtractedDocument & { possiblyScanned: boolean }> {
  // 动态加载：Browser 用标准 build；Node（测试）用 legacy build
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  // Node（测试）需要 standardFonts 目录；webpack 不解析变量拼接的 URL
  const fontDir = "node_modules/pdfjs-dist/standard_fonts/";
  const nodeInit =
    typeof window === "undefined"
      ? { standardFontDataUrl: new URL(`${fontDir}`, import.meta.url).toString() }
      : {};
  const doc = await pdfjs.getDocument({ data, ...nodeInit }).promise;
  try {
    const pages: { page: number; text: string }[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item ? (item as { str: string }).str : ""))
        .join(" ")
        .replace(/\s+/g, " ");
      pages.push({ page: i, text: pageText });
      page.cleanup();
    }
    const all = pages.map((p) => `【第 ${p.page} 页】\n${p.text}`).join("\n\n");
    const normalized = normalizeLineEndings(all).trim();
    const combined = normalizeLineEndings(pages.map((p) => p.text).join("\n\n")).trim();
    // 扫描件判断：多页文档几乎无文本才标记（单页短文本属于正常）
    const possiblyScanned = doc.numPages >= 3 && combined.replace(/\s+/g, "").length < 40;
    if (possiblyScanned) {
      return { text: "", pages: [], truncated: false, possiblyScanned: true };
    }
    const limited = truncateWithPages(pages, MAX_EXTRACTED_CHARS);
    return {
      text: limited.text,
      pages: limited.pages,
      truncated: limited.truncated,
      possiblyScanned: false,
    };
  } finally {
    const cleanup = (doc as unknown as { destroy?: () => Promise<void> }).destroy;
    if (cleanup) await cleanup();
  }
}

let pdfjsModule: typeof import("pdfjs-dist") | null = null;

async function loadPdfJs(): Promise<typeof import("pdfjs-dist")> {
  if (pdfjsModule) return pdfjsModule;
  // 统一使用 legacy build：Node 无需 DOM；浏览器把 worker 资源以 blob URL 提供，
  // 避免 dev 环境下 worker chunk 加载不稳定导致挂起。
  const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfjs = mod as unknown as typeof import("pdfjs-dist");
  if (typeof window !== "undefined" && !(pdfjs as { GlobalWorkerOptions?: { workerSrc?: string } }).GlobalWorkerOptions?.workerSrc) {
    try {
      const worker = await import("pdfjs-dist/build/pdf.worker.mjs?url");
      const res = await fetch(worker.default as string);
      const blobUrl = URL.createObjectURL(await res.blob());
      (pdfjs as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc = blobUrl;
    } catch {
      /* worker 配置失败时 pdfjs 会走主线程回退 */
    }
  }
  pdfjsModule = pdfjs;
  return pdfjsModule;
}
