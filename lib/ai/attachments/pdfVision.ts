/**
 * Scanned PDF Vision fallback（Task 12）：
 *  - 页选择（纯函数）：用户指定页码优先，否则默认前 N 页；多文档 round-robin 公平分配
 *  - 页面渲染：pdf.js → Canvas → JPEG File（最长边限制、体积超限降一次质量）
 *  - 渲染是发送时的临时视觉输入：File 只活在当前 Turn，不进入任何持久化存储
 */

import { loadPdfJs } from "@/lib/ai/attachments/pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  MAX_SCANNED_PDF_PAGES_PER_TURN,
  MAX_PDF_VISION_DIMENSION,
  MAX_RENDERED_PAGE_BYTES,
  MAX_SCANNED_PDF_IMAGE_BYTES_PER_TURN,
  PDF_VISION_JPEG_QUALITY,
} from "@/lib/ai/attachments/limits";

export interface KiroRenderedPdfPage {
  /** 原 PDF 页码（1-based） */
  page: number;
  /** 临时 JPEG File（仅发送用；名称 deterministic：kiro-<sourceId>-page-<n>.jpg） */
  file: File;
  width: number;
  height: number;
  size: number;
}

// ---------- 页选择（纯函数，Node 可测） ----------

/** 从用户文本中识别页码表达：第12页 / 第12-15页 / 12页 / pages 3-5 / page 8 */
export function extractExplicitPages(userText: string): { start: number; end: number }[] {
  if (!userText) return [];
  const out: { start: number; end: number }[] = [];
  const re = /(?:第\s*)?(\d{1,4})\s*(?:[-–~至到]\s*(\d{1,4}))?\s*(?:页|p(?:age)?s?\.?)/gi;
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(userText)) !== null) {
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    out.push({ start, end: Math.max(start, end) });
  }
  // 补充纯 "pages 3-5" / "page 8"（不带“页”字）
  const re2 = /\bpages?\s+(\d{1,4})\s*(?:[-–~至到]\s*(\d{1,4}))?\b/gi;
  re2.lastIndex = 0;
  while ((m = re2.exec(userText)) !== null) {
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    out.push({ start, end: Math.max(start, end) });
  }
  return out;
}

/** 单份文档页选择：explicit 优先（合法页 clamp 到 [1,pageCount]），否则默认前 N 页 */
export function selectScannedPdfPages(input: {
  userText?: string;
  pageCount: number;
  maxPages?: number;
}): { pages: number[]; truncated: boolean } {
  const max = Math.max(1, input.maxPages ?? MAX_SCANNED_PDF_PAGES_PER_TURN);
  const pageCount = Math.max(1, input.pageCount);

  const explicit = extractExplicitPages(input.userText ?? "");
  if (explicit.length > 0) {
    // 合并所有显式区间（去重保序）；越界页忽略
    const pages: number[] = [];
    const seen = new Set<number>();
    for (const r of explicit) {
      for (let p = r.start; p <= r.end; p++) {
        if (p >= 1 && p <= pageCount && !seen.has(p)) {
          seen.add(p);
          pages.push(p);
        }
      }
    }
    const requested = explicit.reduce((s, r) => s + Math.max(0, Math.min(r.end, pageCount) - Math.max(r.start, 1) + 1), 0);
    if (requested === 0) {
      // 指定页码全部越界：回退默认前 N 页
      const fallback = Array.from({ length: Math.min(pageCount, max) }, (_, i) => i + 1);
      return { pages: fallback, truncated: pageCount > max };
    }
    return { pages: pages.slice(0, max), truncated: requested > max };
  }
  const pages = Array.from({ length: Math.min(pageCount, max) }, (_, i) => i + 1);
  return { pages, truncated: pageCount > max };
}

/**
 * 多文档公平分配（Task 12 + Task 13 修复）：
 * 无论 explicit / default / 多文档，最终总页数恒 ≤ maxTotal（explicit 不能绕过全局上限）。
 * explicit 优先：round-robin 跨文档满足指定页（受 maxTotal 限制），剩余额度再 round-robin 默认页。
 */
export function allocateVisionPages(
  docs: { pageCount: number; explicitPages: number[] }[],
  maxTotal: number
): { pages: number[]; truncated: boolean }[] {
  const per = docs.map((d) => ({ pageCount: Math.max(1, d.pageCount), explicit: d.explicitPages }));
  const out: number[][] = per.map(() => []);
  const seen: Set<number>[] = per.map(() => new Set());
  let total = 0;

  // 1. explicit 优先：round-robin 跨文档（全局上限内满足尽可能多的指定页）
  let anyExplicit = true;
  while (anyExplicit && total < maxTotal) {
    anyExplicit = false;
    per.forEach((d, i) => {
      if (total >= maxTotal) return;
      const next = d.explicit.find((p) => p >= 1 && p <= d.pageCount && !seen[i].has(p));
      if (next !== undefined) {
        seen[i].add(next);
        out[i].push(next);
        total++;
        anyExplicit = true;
      }
    });
  }

  // 2. 剩余额度：round-robin 默认页（1 起逐页）
  const alive = per.map(() => true);
  let round = 1;
  let advanced = true;
  while (total < maxTotal && advanced) {
    advanced = false;
    per.forEach((d, i) => {
      if (!alive[i] || total >= maxTotal) return;
      if (round > d.pageCount) {
        alive[i] = false;
        return;
      }
      if (!seen[i].has(round)) {
        seen[i].add(round);
        out[i].push(round);
        total++;
        advanced = true;
      }
    });
    round++;
  }

  return out.map((pages, i) => ({
    pages,
    truncated: pages.length < Math.min(per[i].pageCount, maxTotal),
  }));
}

// ---------- 页面渲染（Browser only） ----------

/** 全 Turn 字节预算裁剪（Task 13）：按序保留页面直到预算耗尽（纯函数，可测） */
export function trimRenderedPagesByBudget<T extends { page: number; size: number }>(pages: T[], maxBytes: number): T[] {
  const out: T[] = [];
  let total = 0;
  for (const p of pages) {
    if (total + p.size > maxBytes) continue;
    out.push(p);
    total += p.size;
  }
  return out;
}

async function renderPageToJpeg(
  doc: PDFDocumentProxy,
  pageNum: number,
  maxDim: number,
  quality: number
): Promise<{ blob: Blob; width: number; height: number }> {
  const page = await doc.getPage(pageNum);
  try {
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(maxDim / Math.max(base.width, base.height), 2);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas ctx");
    await page.render({ canvas, canvasContext: ctx, viewport } as never).promise;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );
    const rect = { blob: blob ?? new Blob(), width: canvas.width, height: canvas.height };
    // 释放 canvas 引用
    canvas.width = 0;
    canvas.height = 0;
    return rect;
  } finally {
    page.cleanup();
  }
}

/**
 * 渲染指定页为 JPEG File。
 * 单页失败 → 跳过（不中断其它页）；单页超限 → 降一次质量重试（最多一次）。
 * maxBytes：本份文档可占用的剩余 Turn 字节预算（多份 PDF 共用真正的全 Turn 额度）。
 * 返回的 File 只用于当前 Turn 发送，调用方不得持久化。
 */
export async function renderPdfPages(
  blob: Blob,
  pageNumbers: number[],
  sourceId: string,
  options?: { maxBytes?: number }
): Promise<KiroRenderedPdfPage[]> {
  if (pageNumbers.length === 0) return [];
  const maxBytes = Math.min(
    options?.maxBytes ?? MAX_SCANNED_PDF_IMAGE_BYTES_PER_TURN,
    MAX_SCANNED_PDF_IMAGE_BYTES_PER_TURN
  );
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await blob.arrayBuffer());
  const fontDir = "node_modules/pdfjs-dist/standard_fonts/";
  const nodeInit = typeof window === "undefined" ? { standardFontDataUrl: new URL(`${fontDir}`, import.meta.url).toString() } : {};
  const doc = await pdfjs.getDocument({ data, ...nodeInit }).promise;
  try {
    const rendered: KiroRenderedPdfPage[] = [];
    for (const pageNum of pageNumbers) {
      try {
        let r = await renderPageToJpeg(doc, pageNum, MAX_PDF_VISION_DIMENSION, PDF_VISION_JPEG_QUALITY);
        // 单页超限：降一次尺寸+质量（最多一次）
        if (r.blob.size > MAX_RENDERED_PAGE_BYTES) {
          r = await renderPageToJpeg(doc, pageNum, MAX_PDF_VISION_DIMENSION * 0.7, PDF_VISION_JPEG_QUALITY * 0.85);
        }
        if (r.blob.size === 0) continue;
        const fileName = `kiro-${sourceId}-page-${pageNum}.jpg`;
        rendered.push({
          page: pageNum,
          file: new File([r.blob], fileName, { type: "image/jpeg" }),
          width: r.width,
          height: r.height,
          size: r.blob.size,
        });
      } catch {
        /* 单页失败：跳过该页，继续其它页 */
      }
    }
    // 本份文档剩余额度：整页装不下则丢弃（多份 PDF 共用全 Turn 预算）
    return trimRenderedPagesByBudget(rendered, maxBytes);
  } finally {
    const cleanup = (doc as unknown as { destroy?: () => Promise<void> }).destroy;
    if (cleanup) await cleanup();
  }
}
