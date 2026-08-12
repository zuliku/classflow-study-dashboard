import { describe, it, expect } from "vitest";
import {
  rasterizeWebPdfPages,
  KiroRasterizedWebPdfPage,
  KiroWebPdfRasterizeRequest,
} from "@/lib/ai/web/native/pdfVisionRasterizer";

/** 程序化构建带正确 xref 的最小 1 页 PDF（内容 "Hello"） */
function makeMinimalPdf(): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Length 44 >>\nstream\nBT /F1 24 Tf 72 120 Td (Hello) Tj ET\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

describe("pdfVisionRasterizer — Task 19C1", () => {
  it("B1. 真实渲染：1 页 PDF → JPEG（magic ff d8 ff，宽高>0，page=1）", async () => {
    const out = await rasterizeWebPdfPages({ bytes: makeMinimalPdf(), pageNumbers: [1] });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.pages).toHaveLength(1);
    const page = out.pages[0];
    expect(page.page).toBe(1);
    expect(page.mediaType).toBe("image/jpeg");
    expect(page.width).toBeGreaterThan(0);
    expect(page.height).toBeGreaterThan(0);
    expect(page.size).toBeGreaterThan(0);
    expect(page.data[0]).toBe(0xff);
    expect(page.data[1]).toBe(0xd8);
    expect(page.data[2]).toBe(0xff);
  });

  it("B2. 页数硬 cap：请求 5 页（PDF 仅 1 页）→ ≤3 且只返回存在的页", async () => {
    const out = await rasterizeWebPdfPages({ bytes: makeMinimalPdf(), pageNumbers: [1, 2, 3, 4, 5], remainingPages: 3 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.pages.length).toBeLessThanOrEqual(3);
    expect(out.pages.map((p) => p.page)).toEqual([1]);
  });

  it("B3. 字节预算：累计超 remainingBytes → 停止加入；sum ≤ remainingBytes 且 truncated", async () => {
    const fakeRender = async (page: number) => {
      const size = page === 1 ? 60 : 60;
      return { data: new Uint8Array(size).fill(0xff), width: 10, height: 10 };
    };
    const out = await rasterizeWebPdfPages(
      { bytes: new Uint8Array(0), pageNumbers: [1, 2, 3], remainingBytes: 100 },
      { renderAdapter: fakeRender, skipLoad: true }
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const total = out.pages.reduce((s, p) => s + p.size, 0);
    expect(total).toBeLessThanOrEqual(100);
    expect(out.pages.map((p) => p.page)).toEqual([1]); // 60+60 > 100 → page2 不再加入
    expect(out.truncated).toBe(true);
  });

  it("B4. 失败页隔离：注入 render adapter —— page2 throw 不影响 page1/page3", async () => {
    // 注入式 render adapter（绕过真实 pdf.js）：模拟 1 成功 / 2 throw / 3 成功
    const fakeRender = async (page: number): Promise<{ data: Uint8Array; width: number; height: number }> => {
      if (page === 2) throw new Error("render boom");
      return { data: new Uint8Array([0xff, 0xd8, 0xff, 0x00]), width: 10, height: 10 };
    };
    const out = await rasterizeWebPdfPages(
      { bytes: new Uint8Array(0), pageNumbers: [1, 2, 3] },
      { renderAdapter: fakeRender, skipLoad: true }
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.pages.map((p) => p.page)).toEqual([1, 3]);
  });

  it("空页请求 → WEB_PDF_VISION_NO_PAGES", async () => {
    const out = await rasterizeWebPdfPages({ bytes: makeMinimalPdf(), pageNumbers: [] });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("WEB_PDF_VISION_NO_PAGES");
  });
});
