import { ExtractedDocument, normalizeLineEndings, truncateWithPages } from "@/lib/ai/attachments/extractors";
import { MAX_EXTRACTED_CHARS } from "@/lib/ai/attachments/limits";

/** pdf.js 模块加载（Task 4/11 已依赖；Task 12 Vision 渲染复用同一实例与 worker 初始化） */
export type PdfJsModule = typeof import("pdfjs-dist");

export async function loadPdfJs(): Promise<PdfJsModule> {
  if (pdfjsModule) return pdfjsModule;
  // 统一使用 legacy build：Node 无需 DOM；浏览器把 worker 资源以 blob URL 提供，
  // 避免 dev 环境下 worker chunk 加载不稳定导致挂起。
  const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfjs = mod as unknown as PdfJsModule;
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

/**
 * Canonical PDF text-layer classifier（V1.4.2）：read / search 共用同一判定，避免语义漂移。
 * 规则：
 * - 非空白文本 chars === 0 → 无可用文本层（任何页数；1–2 页扫描通知页也算 scanned）
 * - pageCount >= 3 且 chars < 40 → 视为扫描件（保持既有启发式）
 * - 其余（1–2 页短文本，如「考试时间：8月20日 14:00」）→ 正常 text PDF
 */
export function classifyPdfTextLayer(input: {
  pageCount: number;
  nonWhitespaceTextChars: number;
}): { possiblyScanned: boolean; hasUsableTextLayer: boolean } {
  const chars = Math.max(0, input.nonWhitespaceTextChars);
  const possiblyScanned = chars === 0 || (input.pageCount >= 3 && chars < 40);
  return { possiblyScanned, hasUsableTextLayer: !possiblyScanned };
}

/** PDF 提取失败分类（UI 给出可操作提示，而非笼统“无法读取”） */
export type PdfExtractFailureKind = "encrypted" | "invalid" | "unreadable";

export class PdfExtractError extends Error {
  readonly failureKind: PdfExtractFailureKind;
  constructor(failureKind: PdfExtractFailureKind, message: string) {
    super(message);
    this.name = "PdfExtractError";
    this.failureKind = failureKind;
  }
}

/** pdf.js 抛错 → 失败分类（按 name/message 启发式；未知一律 unreadable） */
export function classifyPdfExtractError(err: unknown): PdfExtractFailureKind {
  const name = (err as { name?: unknown })?.name;
  const message = (err as { message?: unknown })?.message;
  const text = `${typeof name === "string" ? name : ""} ${typeof message === "string" ? message : ""}`.toLowerCase();
  if (text.includes("password") || text.includes("encrypted")) return "encrypted";
  if (
    text.includes("invalid pdf") ||
    text.includes("invalidpdf") ||
    text.includes("not a pdf") ||
    text.includes("malformed") ||
    text.includes("xref") ||
    text.includes("trailer")
  ) {
    return "invalid";
  }
  return "unreadable";
}

/**
 * PDF 文本提取：只做 text PDF（不做视觉还原 / 多栏 / annotation）。
 * 提取结果接近空 → 判断为扫描件（possiblyScanned，经 canonical classifier）。
 *
 * 容错：
 * - 单页 getPage/getTextContent 失败 → 跳过该页继续（部分厂商 PDF 偶发坏页；
 *   整份失败比缺一页更糟；缺页不伪造页码，pages 只含成功页）；
 * - getDocument 失败 → 按分类抛 PdfExtractError（入口负责文案）；
 * - 全部页都失败 → unreadable（不是扫描件：连页数都不可信，不走 Vision）。
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
  const loadingTask = pdfjs.getDocument({ data, ...nodeInit });
  let doc: Awaited<typeof loadingTask.promise>;
  try {
    doc = await loadingTask.promise;
  } catch (err) {
    throw new PdfExtractError(classifyPdfExtractError(err), "PDF 文档打开失败");
  }
  try {
    const pages: { page: number; text: string }[] = [];
    let nonWhitespaceTextChars = 0;
    let failedPages = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      try {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item) => ("str" in item ? (item as { str: string }).str : ""))
          .join(" ")
          .replace(/\s+/g, " ");
        pages.push({ page: i, text: pageText });
        nonWhitespaceTextChars += pageText.replace(/\s+/g, "").length;
        page.cleanup();
      } catch {
        // 单页损坏：跳过（缺页不伪造；全部失败见下方 unreadable 判定）
        failedPages += 1;
      }
    }
    if (pages.length === 0 && failedPages > 0) {
      throw new PdfExtractError("unreadable", "PDF 页面均无法读取");
    }
    const all = pages.map((p) => `【第 ${p.page} 页】\n${p.text}`).join("\n\n");
    const normalized = normalizeLineEndings(all).trim();
    // V1.4.2：统一 canonical classifier（read / search 同源；不再维护两套 heuristic）
    const { possiblyScanned } = classifyPdfTextLayer({
      pageCount: doc.numPages,
      nonWhitespaceTextChars,
    });
    if (possiblyScanned) {
      return { text: "", pages: [], truncated: false, pageCount: doc.numPages, possiblyScanned: true };
    }
    const limited = truncateWithPages(pages, MAX_EXTRACTED_CHARS);
    void normalized;
    return {
      text: limited.text,
      pages: limited.pages,
      truncated: limited.truncated,
      pageCount: doc.numPages,
      possiblyScanned: false,
    };
  } finally {
    const cleanup = (doc as unknown as { destroy?: () => Promise<void> }).destroy;
    if (cleanup) await cleanup();
  }
}

let pdfjsModule: PdfJsModule | null = null;
