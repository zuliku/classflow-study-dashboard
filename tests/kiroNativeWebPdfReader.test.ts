import { describe, it, expect, vi } from "vitest";
import { readNativeWebPdfSource } from "@/lib/ai/web/native/pdfReader";
import { shouldFallbackNativeWebRead } from "@/lib/ai/web/native/reader";

/** fake safeWebFetchPdf：返回构造的 PDF bytes（不真实联网） */
function fakeFetcher(bytes: Uint8Array, over: Partial<{ contentType: string; finalUrl: string }> = {}) {
  return vi.fn().mockResolvedValue({
    ok: true,
    finalUrl: over.finalUrl ?? "https://example.com/doc.pdf",
    status: 200,
    contentType: over.contentType ?? "application/pdf",
    bytes,
  });
}

/** fake extractPdf：返回构造的分页文本（不真实调用 pdf.js） */
function fakeExtractor(pages: { page: number; text: string }[], over: Partial<{ possiblyScanned: boolean; truncated: boolean }> = {}) {
  return vi.fn().mockResolvedValue({
    text: pages.map((p) => p.text).join("\n\n"),
    pages,
    truncated: over.truncated ?? false,
    pageCount: Math.max(...pages.map((p) => p.page), 1),
    possiblyScanned: over.possiblyScanned ?? false,
  });
}

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7

describe("readNativeWebPdfSource", () => {
  it("Test A. query 选择正确页面：p8/p12 被选中，availablePages 只含实际选中页", async () => {
    const out = await readNativeWebPdfSource(
      { sourceId: "web-3", url: "https://example.com/zhaosheng.pdf", query: "报名条件 初试科目 871经济学" },
      {
        fetcher: fakeFetcher(PDF_BYTES),
        extractor: fakeExtractor([
          { page: 1, text: "学校概况与历史沿革介绍" },
          { page: 3, text: "培养方式与学制安排" },
          { page: 8, text: "报名条件包括本科学历和学位要求，以及相关工作经历。" },
          { page: 12, text: "初试科目为871经济学综合，复试科目另见通知。" },
          { page: 15, text: "收费标准与奖学金政策" },
        ]),
      }
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const joined = out.chunks.map((c) => c.text).join("\n");
    expect(joined).toContain("报名条件");
    expect(joined).toContain("871经济学");
    expect(out.availablePages).toEqual([8, 12]);
    expect(out.chunks.every((c) => c.pageStart === c.pageEnd)).toBe(true);
  });

  it("Test B. 超长 p12：关键字在后半段 → 选中后半 chunk 且 pageStart/pageEnd = 12", async () => {
    const head = "培养方案背景内容介绍，与考试无关，仅作占位填充。".repeat(120); // >1800 chars
    const key = "关键信息：复试名单将于三月底公布。";
    const out = await readNativeWebPdfSource(
      { sourceId: "web-3", url: "https://example.com/doc.pdf", query: "复试名单" },
      {
        fetcher: fakeFetcher(PDF_BYTES),
        extractor: fakeExtractor([{ page: 12, text: head + key }]),
      }
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const joined = out.chunks.map((c) => c.text).join("\n");
    expect(joined).toContain("复试名单");
    expect(out.chunks.every((c) => c.pageStart === 12 && c.pageEnd === 12)).toBe(true);
    expect(out.availablePages).toEqual([12]);
  });

  it("Test C. scanned PDF → WEB_NATIVE_PDF_SCANNED 且允许 fallback", async () => {
    const out = await readNativeWebPdfSource(
      { sourceId: "web-3", url: "https://example.com/scanned.pdf" },
      { fetcher: fakeFetcher(PDF_BYTES), extractor: fakeExtractor([], { possiblyScanned: true }) }
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("WEB_NATIVE_PDF_SCANNED");
    expect(shouldFallbackNativeWebRead("WEB_NATIVE_PDF_SCANNED")).toBe(true);
  });

  it("extractor throw（malformed PDF）→ WEB_NATIVE_PARSE_FAILED，不 throw", async () => {
    const out = await readNativeWebPdfSource(
      { sourceId: "web-3", url: "https://example.com/broken.pdf" },
      {
        fetcher: fakeFetcher(PDF_BYTES),
        extractor: vi.fn().mockRejectedValue(new Error("corrupt pdf")),
      }
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("WEB_NATIVE_PARSE_FAILED");
  });

  it("safeWebFetchPdf 失败映射：BLOCKED_IP → POLICY_BLOCKED；TOO_LARGE → UNSUPPORTED_CONTENT", async () => {
    const blocked = await readNativeWebPdfSource(
      { sourceId: "web-3", url: "https://evil.example/x.pdf" },
      {
        fetcher: vi.fn().mockResolvedValue({ ok: false, code: "WEB_FETCH_BLOCKED_IP" }),
        extractor: fakeExtractor([{ page: 1, text: "x" }]),
      }
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("WEB_NATIVE_POLICY_BLOCKED");

    const tooLarge = await readNativeWebPdfSource(
      { sourceId: "web-3", url: "https://example.com/big.pdf" },
      {
        fetcher: vi.fn().mockResolvedValue({ ok: false, code: "WEB_FETCH_TOO_LARGE" }),
        extractor: fakeExtractor([{ page: 1, text: "x" }]),
      }
    );
    expect(tooLarge.ok).toBe(false);
    if (!tooLarge.ok) expect(tooLarge.code).toBe("WEB_NATIVE_UNSUPPORTED_CONTENT");
  });

  it("空页（无文本层但非 scanned）→ WEB_NATIVE_NO_EVIDENCE", async () => {
    const out = await readNativeWebPdfSource(
      { sourceId: "web-3", url: "https://example.com/empty.pdf" },
      { fetcher: fakeFetcher(PDF_BYTES), extractor: fakeExtractor([{ page: 1, text: "" }]) }
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("WEB_NATIVE_NO_EVIDENCE");
  });
});
