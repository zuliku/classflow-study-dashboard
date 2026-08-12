/**
 * Kiro Web PDF Vision — Server-side PDF 页 Rasterizer（Task 19C1）。
 *
 * Node/server only（禁止 Client Component import）。输入只接受已通过 safeWebFetchPdf()
 * 验证的 PDF bytes（绝不接受 URL、绝不自行 fetch）；输出 JPEG Uint8Array[]，全程内存内
 * （禁止 fs 写盘 / 临时路径 / IndexedDB / 持久 Blob）。
 *
 * 预算（一次 read_web_source 跨所有 PDF sources 共享，不是每 source 一份）：
 * - 总页数 ≤ MAX_WEB_PDF_VISION_PAGES_PER_READ（3）
 * - 总图像 bytes ≤ MAX_WEB_PDF_VISION_IMAGE_BYTES_PER_READ（4MiB）
 * - 单页 ≤ MAX_WEB_PDF_VISION_PAGE_BYTES（1.5MB；超限降一次 dimension×0.7 + quality×0.85，最多一次）
 * - 最长边 ≤ MAX_WEB_PDF_VISION_DIMENSION（1600）
 * 调用方 remainingPages / remainingBytes 一律 clamp 到硬上限（maxPages:999 不能绕过）。
 *
 * 单页 render throw → 跳过该页继续其它页；失败页不影响成功页。
 * 失败 outcome 不抛 raw native/pdf.js error（codes 为内部语义，19C2 再映射）。
 */
import { createCanvas } from "@napi-rs/canvas";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { loadPdfJs } from "@/lib/ai/attachments/pdf";
import {
  MAX_WEB_PDF_VISION_DIMENSION,
  MAX_WEB_PDF_VISION_IMAGE_BYTES_PER_READ,
  MAX_WEB_PDF_VISION_PAGE_BYTES,
  MAX_WEB_PDF_VISION_PAGES_PER_READ,
  WEB_PDF_VISION_JPEG_QUALITY,
} from "@/lib/ai/web/vision/limits";

export interface KiroWebPdfRasterizeRequest {
  /** 已经 safeWebFetchPdf 验证的 PDF bytes（绝不接受 URL） */
  bytes: Uint8Array;
  /** 1-based 页码（已由 pageSelection 选择） */
  pageNumbers: number[];
  /** 本 read 调用剩余预算（跨所有 PDF sources 共享）；自动 clamp 到硬上限 */
  remainingPages?: number;
  remainingBytes?: number;
}

export interface KiroRasterizedWebPdfPage {
  page: number;
  data: Uint8Array;
  mediaType: "image/jpeg";
  width: number;
  height: number;
  size: number;
}

export type KiroWebPdfRasterizeOutcome =
  | { ok: true; pages: KiroRasterizedWebPdfPage[]; truncated: boolean }
  | { ok: false; code: "WEB_PDF_VISION_RENDER_FAILED" | "WEB_PDF_VISION_NO_PAGES" | "WEB_PDF_VISION_BUDGET_EXCEEDED" };

/** 测试注入：跳过 pdf.js / 提供自定义单页渲染（返回 JPEG bytes + 尺寸） */
interface KiroWebPdfRasterizerDeps {
  renderAdapter?: (page: number) => Promise<{ data: Uint8Array; width: number; height: number }>;
  skipLoad?: boolean;
}

/** 渲染单页 → JPEG bytes（最长边 ≤1600，scale 上限 2） */
async function renderPageToJpeg(
  doc: PDFDocumentProxy,
  pageNum: number,
  maxDim: number,
  quality: number
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const page = await doc.getPage(pageNum);
  try {
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(maxDim / Math.max(base.width, base.height), 2);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.max(1, Math.floor(viewport.width)), Math.max(1, Math.floor(viewport.height)));
    const ctx = canvas.getContext("2d");
    await page.render({ canvas, canvasContext: ctx, viewport } as never).promise;
    const buf = canvas.toBuffer("image/jpeg", quality);
    return { data: new Uint8Array(buf), width: canvas.width, height: canvas.height };
  } finally {
    page.cleanup();
  }
}

/**
 * 主函数：pdf.js 按指定页码渲染 → JPEG。页码按稳定顺序处理；累计预算达到即停止。
 */
export async function rasterizeWebPdfPages(
  request: KiroWebPdfRasterizeRequest,
  deps?: KiroWebPdfRasterizerDeps
): Promise<KiroWebPdfRasterizeOutcome> {
  const pageNumbers = [...request.pageNumbers].filter((p) => Number.isInteger(p) && p > 0);
  if (pageNumbers.length === 0) return { ok: false, code: "WEB_PDF_VISION_NO_PAGES" };

  // 预算：调用方 remaining 与硬上限取 min（不能绕过全局限制）
  const maxPages = Math.min(
    Math.max(0, request.remainingPages ?? MAX_WEB_PDF_VISION_PAGES_PER_READ),
    MAX_WEB_PDF_VISION_PAGES_PER_READ
  );
  const maxBytes = Math.min(
    Math.max(0, request.remainingBytes ?? MAX_WEB_PDF_VISION_IMAGE_BYTES_PER_READ),
    MAX_WEB_PDF_VISION_IMAGE_BYTES_PER_READ
  );
  if (maxPages === 0 || maxBytes === 0) return { ok: false, code: "WEB_PDF_VISION_BUDGET_EXCEEDED" };

  let doc: PDFDocumentProxy | null = null;
  const render = deps?.renderAdapter;
  if (!render && !deps?.skipLoad) {
    try {
      const pdfjs = await loadPdfJs();
      const nodeInit =
        typeof window === "undefined"
          ? { standardFontDataUrl: new URL("node_modules/pdfjs-dist/standard_fonts/", import.meta.url).toString() }
          : {};
      doc = await pdfjs.getDocument({ data: request.bytes, ...nodeInit }).promise;
    } catch {
      return { ok: false, code: "WEB_PDF_VISION_RENDER_FAILED" };
    }
  }

  try {
    const pages: KiroRasterizedWebPdfPage[] = [];
    let usedBytes = 0;
    let truncated = false;

    for (const pageNum of pageNumbers) {
      if (pages.length >= maxPages) {
        truncated = true;
        break;
      }
      let rendered: { data: Uint8Array; width: number; height: number } | null = null;
      try {
        if (render) {
          rendered = await render(pageNum);
        } else if (doc) {
          rendered = await renderPageToJpeg(doc, pageNum, MAX_WEB_PDF_VISION_DIMENSION, WEB_PDF_VISION_JPEG_QUALITY);
          // 单页超限：降一次 dimension×0.7 + quality×0.85（最多一次）
          if (rendered.data.length > MAX_WEB_PDF_VISION_PAGE_BYTES) {
            rendered = await renderPageToJpeg(
              doc,
              pageNum,
              MAX_WEB_PDF_VISION_DIMENSION * 0.7,
              WEB_PDF_VISION_JPEG_QUALITY * 0.85
            );
          }
        }
      } catch {
        // 单页失败：跳过该页，继续其它页
        continue;
      }
      if (!rendered || rendered.data.length === 0) continue;
      // 二次降级后仍超限：跳过该页
      if (rendered.data.length > MAX_WEB_PDF_VISION_PAGE_BYTES) continue;

      if (usedBytes + rendered.data.length > maxBytes) {
        truncated = true;
        break; // 整页装不进剩余预算：停止
      }
      pages.push({
        page: pageNum,
        data: rendered.data,
        mediaType: "image/jpeg",
        width: rendered.width,
        height: rendered.height,
        size: rendered.data.length,
      });
      usedBytes += rendered.data.length;
    }

    if (pages.length === 0) return { ok: false, code: "WEB_PDF_VISION_RENDER_FAILED" };
    return { ok: true, pages, truncated };
  } finally {
    if (doc) {
      const destroy = (doc as unknown as { destroy?: () => Promise<void> }).destroy;
      if (destroy) {
        try {
          await destroy();
        } catch {
          /* cleanup 失败不向上抛 */
        }
      }
    }
  }
}
