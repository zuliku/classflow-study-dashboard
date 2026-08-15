/**
 * Attachment Extraction Cache Fidelity（V1.3C.1）：
 * - ExtractCacheEntry 持久化真实 truncated 状态（required boolean）
 * - cache round-trip：PDF 页边界截断（text < 100k 但 truncated=true）不再被 length heuristic 猜错
 * - getExtractCache 防御校验：version 不匹配 / truncated 非 boolean → cache miss
 */
import { describe, it, expect } from "vitest";
import {
  ExtractCacheEntry,
  getExtractCache,
  setExtractCache,
  extractCacheKey,
} from "@/lib/ai/attachments/cache";
import { truncateWithPages, truncateText } from "@/lib/ai/attachments/extractors";
import { EXTRACTOR_VERSION, MAX_EXTRACTED_CHARS } from "@/lib/ai/attachments/limits";
import { extractAttachment } from "@/lib/ai/attachments";

function makeEntry(over: Partial<ExtractCacheEntry> = {}): ExtractCacheEntry {
  return {
    text: "content",
    truncated: false,
    extractedAt: new Date().toISOString(),
    extractorVersion: EXTRACTOR_VERSION,
    ...over,
  };
}

// 注意：各测试使用互不相同的 cache key；classflow-kiro-extract 为进程级共享 DB，
// 不在此处 clear（避免 fake-indexeddb 连接竞态），依赖 key 隔离。
const keyOf = (name: string) => extractCacheKey({ name, size: 1, lastModified: 1 });

describe("truncateWithPages（原始 bug 场景）", () => {
  it("页边界截断：60k + 32k + 20k → text≈92k < 100k 但 truncated=true", () => {
    const r = truncateWithPages([
      { page: 1, text: "x".repeat(60_000) },
      { page: 2, text: "x".repeat(32_000) },
      { page: 3, text: "x".repeat(20_000) },
    ]);
    expect(r.text.length).toBeLessThan(MAX_EXTRACTED_CHARS);
    expect(r.text.length).toBeGreaterThan(90_000);
    expect(r.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(r.truncated).toBe(true);
  });
});

describe("cache round-trip fidelity", () => {
  it("92k / truncated=true → round-trip 仍 truncated=true（旧 length heuristic 会猜成 false）", async () => {
    const original = makeEntry({
      text: "x".repeat(92_000),
      pages: [
        { page: 1, text: "x".repeat(60_000) },
        { page: 2, text: "x".repeat(32_000) },
      ],
      truncated: true,
      pageCount: 3,
      possiblyScanned: false,
    });
    const key = keyOf("longish-txt-false");
    await setExtractCache(key, original);
    const cached = await getExtractCache(key);
    expect(cached).not.toBeNull();
    expect(cached?.truncated).toBe(true);
    expect(cached?.pageCount).toBe(3);
    expect(cached?.possiblyScanned).toBe(false);
    expect(cached?.text.length).toBe(92_000);
  });

  it("99_999 chars / truncated=false → round-trip 仍 false（绝不按字符长度猜）", async () => {
    const original = makeEntry({ text: "x".repeat(99_999), truncated: false });
    const key = keyOf("scan-pdf-meta");
    await setExtractCache(key, original);
    const cached = await getExtractCache(key);
    expect(cached?.truncated).toBe(false);
    expect(cached?.text.length).toBe(99_999);
  });

  it("scanned PDF metadata 保持：text='' / truncated=false / possiblyScanned=true / pageCount=N", async () => {
    const original = makeEntry({
      text: "",
      pages: [],
      truncated: false,
      possiblyScanned: true,
      pageCount: 28,
    });
    const key = keyOf("legacy-v2-entry");
    await setExtractCache(key, original);
    const cached = await getExtractCache(key);
    expect(cached?.truncated).toBe(false);
    expect(cached?.possiblyScanned).toBe(true);
    expect(cached?.pageCount).toBe(28);
    expect(cached?.pages).toEqual([]);
  });
});

describe("getExtractCache 防御校验", () => {
  it("旧 version entry（模拟 v2 无 truncated）→ cache miss（null）", async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("classflow-kiro-extract", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const key = keyOf("weird-bool-entry");
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("cache", "readwrite");
      // 直接写旧形状（无 truncated；v2）
      tx.objectStore("cache").put({ text: "legacy", extractedAt: "", extractorVersion: 2 }, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    expect(await getExtractCache(key)).toBeNull();
  });

  it("version 匹配但 truncated 非 boolean（异常 entry）→ cache miss", async () => {
    const key = keyOf("x-txt-integration");
    await setExtractCache(key, { ...makeEntry(), truncated: undefined } as never);
    expect(await getExtractCache(key)).toBeNull();
  });
});

describe("extractAttachment 集成", () => {
  it("cache hit 使用真实 truncated（不重新推导）；extractorVersion 写入 v3", async () => {
    const key = keyOf("big-txt-full");
    const file = new Blob(["hello"], { type: "text/plain" }) as Blob & { name?: string; lastModified?: number };
    const r1 = await extractAttachment(file, { kind: "text", cacheKey: key });
    const r2 = await extractAttachment(file, { kind: "text", cacheKey: key });
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.extracted.truncated).toBe(r2.extracted.truncated);
      expect(r2.extracted.text).toBe("hello");
    }
    // v3 entry 写入
    const cached = await getExtractCache(key);
    expect(cached?.extractorVersion).toBe(EXTRACTOR_VERSION);
    expect(typeof cached?.truncated).toBe("boolean");
  });

  it("truncateText 100k 满长（truncated=true）round-trip 保真", async () => {
    const big = "y".repeat(MAX_EXTRACTED_CHARS + 10);
    const { text, truncated } = truncateText(big);
    expect(truncated).toBe(true);
    const original = makeEntry({ text, truncated, pageCount: 1 });
    const key = keyOf("long-pdf-fidelity");
    await setExtractCache(key, original);
    const cached = await getExtractCache(key);
    expect(cached?.truncated).toBe(true);
    expect(cached?.text.length).toBe(MAX_EXTRACTED_CHARS);
  });
});



