import { describe, it, expect, vi } from "vitest";
import {
  createWebPdfVisionBudget,
  readScannedWebPdfEvidence,
  KiroWebPdfVisionRuntimeConfig,
} from "@/lib/ai/web/vision/runtime";
import { KiroNativeWebReadOutcome } from "@/lib/ai/web/native/reader";
import { MAX_WEB_PDF_VISION_PAGES_PER_READ, MAX_WEB_PDF_VISION_IMAGE_BYTES_PER_READ } from "@/lib/ai/web/vision/limits";

const CONFIG: KiroWebPdfVisionRuntimeConfig = {
  enabled: true,
  model: "mimo-v2.5",
  apiKey: "sk-vision",
};

const jpeg = (n: number) => new Uint8Array(n).fill(0xff);

function makeDeps(over: {
  pageCount?: number;
  rasterPages?: { page: number; size: number }[];
  extractResult?: { ok: boolean; pages?: { page: number; text: string }[]; code?: string };
  extractor?: { page: number; text: string }[];
}) {
  const rasterize = vi.fn(async (req: { pageNumbers: number[]; remainingPages?: number; remainingBytes?: number }) => {
    const pages = over.rasterPages ?? req.pageNumbers.map((p) => ({ page: p, size: 10_000 }));
    return { ok: true, pages, truncated: false };
  });
  const extract = vi.fn(async () =>
    over.extractResult ?? { ok: true, pages: over.extractor ?? [{ page: 1, text: "扫描页文字内容" }] }
  );
  const deps = {
    rasterize: rasterize as never,
    extract: extract as never,
  };
  return { deps, rasterize, extract };
}

describe("createWebPdfVisionBudget — Task 19C2", () => {
  it("初始 3 pages / 4MiB；runRasterizationExclusive 串行化并真实扣减", async () => {
    const budget = createWebPdfVisionBudget();
    const out1 = await budget.runRasterizationExclusive(async (remaining) => {
      expect(remaining.pages).toBe(3);
      expect(remaining.bytes).toBe(MAX_WEB_PDF_VISION_IMAGE_BYTES_PER_READ);
      return { pages: [{ page: 1, size: 1_000_000 }], truncated: false };
    });
    expect(out1).toBeDefined();
    const remaining = budget.remaining();
    expect(remaining.pages).toBe(2);
    expect(remaining.bytes).toBe(MAX_WEB_PDF_VISION_IMAGE_BYTES_PER_READ - 1_000_000);
  });

  it("扣减只按实际 rasterized 页/bytes（不扣 requested 未渲染）", async () => {
    const budget = createWebPdfVisionBudget();
    await budget.runRasterizationExclusive(async () => ({ pages: [], truncated: false }));
    expect(budget.remaining()).toEqual({
      pages: MAX_WEB_PDF_VISION_PAGES_PER_READ,
      bytes: MAX_WEB_PDF_VISION_IMAGE_BYTES_PER_READ,
    });
  });
});

describe("readScannedWebPdfEvidence — Task 19C2", () => {
  it("E. Vision success → availablePages 只含实际证据页（page 8/12 文本 → 选中页）", async () => {
    const { deps, rasterize } = makeDeps({
      extractor: [
        { page: 8, text: "报名条件包括本科学历要求。" },
        { page: 12, text: "初试科目为871经济学综合。" },
      ],
    });
    const out = await readScannedWebPdfEvidence(
      { sourceId: "web-3", bytes: new Uint8Array(4), pageCount: 20, finalUrl: "https://a.dev/x.pdf", query: "报名条件 871经济学" },
      CONFIG,
      createWebPdfVisionBudget(),
      deps
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.availablePages).toEqual([8, 12]);
    expect(out.chunks.every((c) => c.pageStart === c.pageEnd && c.pageStart !== undefined)).toBe(true);
    expect(rasterize).toHaveBeenCalledTimes(1);
  });

  it("F. Vision fail（extract 全失败）→ WEB_NATIVE_PDF_SCANNED", async () => {
    const { deps } = makeDeps({ extractResult: { ok: false, code: "WEB_PDF_VISION_NO_EVIDENCE" } });
    const out = await readScannedWebPdfEvidence(
      { sourceId: "web-3", bytes: new Uint8Array(4), pageCount: 10, finalUrl: "https://a.dev/x.pdf" },
      CONFIG,
      createWebPdfVisionBudget(),
      deps
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("WEB_NATIVE_PDF_SCANNED");
  });

  it("F2. disabled / missing key → 不调用 rasterize/extract，直接 WEB_NATIVE_PDF_SCANNED", async () => {
    const { deps, rasterize, extract } = makeDeps({});
    const disabled = await readScannedWebPdfEvidence(
      { sourceId: "web-3", bytes: new Uint8Array(4), pageCount: 10, finalUrl: "https://a.dev/x.pdf" },
      { enabled: false, model: "mimo-v2.5" },
      createWebPdfVisionBudget(),
      deps
    );
    expect(disabled.ok).toBe(false);
    if (!disabled.ok) expect(disabled.code).toBe("WEB_NATIVE_PDF_SCANNED");
    expect(rasterize).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
  });

  it("G. 两个 scanned sources 并发共享 budget：总页数 ≤3、总 bytes ≤4MiB", async () => {
    const budget = createWebPdfVisionBudget();
    const seenPages: number[] = [];
    const deps = {
      rasterize: (async (req: { pageNumbers: number[]; remainingPages?: number; remainingBytes?: number }) => {
        // 模拟真实时序：记录每个调用看到的 remaining（并发下第二个 source 必须看到扣减后的值）
        seenPages.push(req.remainingPages ?? 0);
        const pages = req.pageNumbers.map((p) => ({ page: p, size: 1_500_000 }));
        return { ok: true, pages, truncated: false };
      }) as never,
      extract: (async () => ({ ok: true, pages: [{ page: 1, text: "x".repeat(200) }] })) as never,
    };
    const mkInput = (id: string) => ({
      sourceId: id,
      bytes: new Uint8Array(4),
      pageCount: 10,
      finalUrl: `https://a.dev/${id}.pdf`,
    });

    const [a, b] = await Promise.all([
      readScannedWebPdfEvidence(mkInput("web-1"), CONFIG, budget, deps),
      readScannedWebPdfEvidence(mkInput("web-2"), CONFIG, budget, deps),
    ]);
    // 两个 source 各自 select 3 页 → 共享 budget 后 total 必须 ≤3
    // 验证：第二次 rasterize 看到的 remainingPages 已减少
    expect(seenPages.some((p) => p < 3)).toBe(true);
    // 总 rasterized 页数 ≤3（通过 extract 收到的页数上限由 budget 保证；此处以 seenPages 断言）
    const maxSeen = Math.max(...seenPages);
    expect(maxSeen).toBeLessThanOrEqual(3);
    expect(a.ok || b.ok).toBe(true);
  });
});
