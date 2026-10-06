import { ExtractedDocument, normalizeLineEndings, truncateText, truncateWithPages } from "@/lib/ai/attachments/extractors";

/**
 * PPTX 文本提取（jszip 解包 + `<a:t>` 文本 Run 提取，不引入新依赖）。
 * - 按 `ppt/slides/slideN.xml` 数字序输出 `pages[]`（与 PDF 同形状，下游引用/来源 UI 零改动）；
 * - 备注页（notesSlides）不读取：只做演示正文 AI Context；
 * -  intentionally 不用 DOMParser：Server（nodejs route）无 DOM，`<a:t>` 正则 + 反转义双端可用。
 * V1：extractPptxRawText 提供 untruncated 完整正文；extractPptx 保持 bounded extraction。
 */

const SLIDE_FILE_RE = /^ppt\/slides\/slide(\d+)\.xml$/;

/** jszip 最小结构类型（只用 loadAsync/forEach/file，避免引入完整类型包） */
interface JSZipEntry {
  async: (type: "string") => Promise<string>;
}
interface JSZipLike {
  forEach: (cb: (relativePath: string) => void) => void;
  file: (name: string) => JSZipEntry | null;
}

/** XML 文本反转义（a:t 内常见五种；其余 &#x..; / &#..; 数字引用一并处理） */
export function unescapeXmlText(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return "";
      }
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch {
        return "";
      }
    })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function extractSlideTexts(file: Blob): Promise<string[]> {
  const mod = (await import("jszip")) as unknown as {
    default?: { loadAsync: (data: ArrayBuffer) => Promise<JSZipLike> };
    loadAsync?: (data: ArrayBuffer) => Promise<JSZipLike>;
  };
  const loader = (mod.default ?? mod) as { loadAsync: (data: ArrayBuffer) => Promise<JSZipLike> };
  const zip = await loader.loadAsync(await file.arrayBuffer());
  const numbered: { n: number; name: string }[] = [];
  zip.forEach((relativePath) => {
    const m = SLIDE_FILE_RE.exec(relativePath);
    if (m) numbered.push({ n: Number(m[1]), name: relativePath });
  });
  if (numbered.length === 0) {
    throw new Error("no-slides");
  }
  numbered.sort((a, b) => a.n - b.n);
  const slides: string[] = [];
  for (const { name } of numbered) {
    const entry = zip.file(name);
    if (!entry) continue;
    const xml = await entry.async("string");
    const runs: string[] = [];
    // <a:t> 文本 Run（含表格/文本框内文本；属性如 xml:space 必须容忍；绘图/图表数值不保证）
    const re = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      const text = unescapeXmlText(m[1]).replace(/\s+/g, " ").trim();
      if (text) runs.push(text);
    }
    slides.push(runs.join("\n"));
  }
  return slides;
}

export async function extractPptxRawText(file: Blob, opts?: { signal?: AbortSignal }): Promise<string> {
  opts?.signal?.throwIfAborted();
  const slides = await extractSlideTexts(file);
  const blocks = slides.map((text, i) => `【幻灯片 ${i + 1}】\n${text}`);
  return normalizeLineEndings(blocks.join("\n\n")).trim();
}

/** bounded extraction：页结构与 PDF 对齐（pages[] + pageCount），空演示抛错走统一失败文案 */
export async function extractPptx(file: Blob, opts?: { signal?: AbortSignal }): Promise<ExtractedDocument> {
  opts?.signal?.throwIfAborted();
  const slides = await extractSlideTexts(file);
  const pages = slides.map((text, i) => ({ page: i + 1, text }));
  const nonEmpty = pages.filter((p) => p.text.length > 0);
  if (nonEmpty.length === 0) {
    throw new Error("empty-slides");
  }
  const { pages: kept, text, truncated } = truncateWithPages(pages);
  return { text, truncated, pages: kept, pageCount: pages.length };
}
