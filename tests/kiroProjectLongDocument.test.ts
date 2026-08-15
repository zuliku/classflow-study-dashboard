/**
 * Kiro Project Files V1.4：Long Document Targeted Retrieval 回归。
 * - 长 PDF 尾部（>100k prefix 之外）经 search_project_file 可达
 * - read_project_file(pages) 定向读取尾部正文；不污染 prefix cache
 * - 长 TXT 尾部 sentinel 可达
 * - pages canonicalization / 越界 INVALID_INPUT / 单页输出预算
 * - image NOT_SEARCHABLE / cross-project 0 Blob / no-result
 * - Citation：search/targeted/visual source merge 单 row
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  resetKiroDbForTests,
  closeKiroDbForTests,
  openKiroDB,
  KIRO_PROJECTS_STORE,
  KIRO_PROJECT_FILES_STORE,
} from "@/lib/ai/storage/kiroDb";
import { createKiroProject } from "@/lib/ai/projects/db";
import { createProjectFile } from "@/lib/ai/projects/files/db";
import { clearAllFileBlobs } from "@/lib/fileStorage";
import { clearConversationHistory } from "@/lib/ai/history/db";
import { executeReadProjectFile } from "@/lib/ai/tools/read/projectFile";
import { executeSearchProjectFile } from "@/lib/ai/tools/read/projectFileSearch";
import { upsertProjectFileSource, projectFileSourceId } from "@/lib/ai/citations/sources";
import { KiroSourceMeta } from "@/lib/ai/citations/types";
import { KiroProjectTurnContext } from "@/lib/ai/contextBudget/types";
import { getExtractCache, extractCacheKey } from "@/lib/ai/attachments/cache";
import { buildMultiPageTextPdf, buildMinimalPdf } from "@/tests/fixtures/files";

const SENTINEL = "LONG_DOCUMENT_TAIL_SENTINEL";

function ctxOf(projectId: string, f: { id: string; name: string; kind: "text" | "pdf" | "docx" | "image"; sizeBytes: number }): KiroProjectTurnContext {
  return { id: projectId, name: "P", files: [{ id: f.id, name: f.name, kind: f.kind, sizeBytes: f.sizeBytes }] };
}

/** 155 页：前 154 页每页 800 chars（累计 >100k），第 155 页含 sentinel */
function buildLongPdf(): Uint8Array {
  const pages = Array.from({ length: 155 }, (_, i) =>
    i === 154 ? `${SENTINEL} located on the last page` : "x".repeat(800) + ` content of page ${i + 1}`
  );
  return buildMultiPageTextPdf(pages);
}

beforeEach(async () => {
  await closeKiroDbForTests();
  resetKiroDbForTests();
  await clearConversationHistory().catch(() => {});
  await clearAllFileBlobs().catch(() => {});
  const db = await openKiroDB();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction([KIRO_PROJECTS_STORE, KIRO_PROJECT_FILES_STORE], "readwrite");
    t.objectStore(KIRO_PROJECTS_STORE).clear();
    t.objectStore(KIRO_PROJECT_FILES_STORE).clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
});

describe("长 PDF 尾部可达（核心 regression）", () => {
  it("read_project_file 默认 → truncated=true 且不含 sentinel；search → 命中 page 155；targeted read → 读到 sentinel", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "long.pdf", mimeType: "application/pdf", sizeBytes: 10, kind: "pdf", blob: new Blob([buildLongPdf().buffer as ArrayBuffer], { type: "application/pdf" }) });
    const ctx = ctxOf(p.id, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes });

    // 1. 默认读取：truncated=true（>100k prefix），不含尾部 sentinel
    const plain = await executeReadProjectFile({ projectFileId: f.id }, ctx);
    expect(plain.ok).toBe(true);
    if (plain.ok) {
      expect(plain.data.truncated).toBe(true);
      expect(plain.data.text).not.toContain(SENTINEL);
      expect(plain.data.note).toContain("search_project_file");
    }

    // 2. search：全页扫描命中 page 155
    const search = await executeSearchProjectFile({ projectFileId: f.id, query: SENTINEL }, { frozenProjectContext: ctx });
    expect(search.ok).toBe(true);
    if (search.ok) {
      expect(search.data.kind).toBe("pdf");
      expect(search.data.matches.length).toBeGreaterThan(0);
      expect((search.data.matches[0] as { page?: number }).page).toBe(155);
      expect(search.data.matches[0].text).toContain("long_document_tail_sentinel");
    }

    // 3. targeted read：pages=[155] 读到 sentinel
    const targeted = await executeReadProjectFile({ projectFileId: f.id, pages: [155] }, ctx);
    expect(targeted.ok).toBe(true);
    if (targeted.ok) {
      expect(targeted.data.text).toContain(SENTINEL);
      expect(targeted.data.pages?.map((pg) => pg.page)).toEqual([155]);
      expect(targeted.data.note).toContain("已读取指定页面");
    }
  }, 120_000);

  it("targeted read 不污染 prefix cache：再次默认读取仍返回原 prefix extraction", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "long.pdf", mimeType: "application/pdf", sizeBytes: 10, kind: "pdf", blob: new Blob([buildLongPdf().buffer as ArrayBuffer], { type: "application/pdf" }) });
    const ctx = ctxOf(p.id, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes });

    const first = await executeReadProjectFile({ projectFileId: f.id }, ctx);
    expect(first.ok && first.data.truncated).toBe(true);

    await executeReadProjectFile({ projectFileId: f.id, pages: [155] }, ctx);

    const third = await executeReadProjectFile({ projectFileId: f.id }, ctx);
    expect(third.ok).toBe(true);
    if (third.ok) {
      // 仍是 prefix extraction：truncated=true、无 sentinel、pages 不含 155
      expect(third.data.truncated).toBe(true);
      expect(third.data.text).not.toContain(SENTINEL);
    }
    // prefix cache 内容未被覆盖成 page 155
    const cached = await getExtractCache(extractCacheKey({ name: f.storageKey, size: f.sizeBytes, lastModified: 0 }));
    expect(cached?.text).not.toContain(SENTINEL);
  }, 120_000);
});

describe("长 TXT 尾部可达", () => {
  it("TXT >100k：默认 read 看不到尾部；search 用完整原文找到", async () => {
    const p = await createKiroProject({ name: "P" });
    const raw = "a".repeat(120_000) + " TXT_TAIL_SENTINEL 结尾";
    const f = await createProjectFile({ projectId: p.id, name: "long.txt", mimeType: "text/plain", sizeBytes: raw.length, kind: "text", blob: new Blob([raw], { type: "text/plain" }) });
    const ctx = ctxOf(p.id, { id: f.id, name: f.name, kind: "text", sizeBytes: f.sizeBytes });

    const plain = await executeReadProjectFile({ projectFileId: f.id }, ctx);
    expect(plain.ok).toBe(true);
    if (plain.ok) {
      expect(plain.data.text).not.toContain("TXT_TAIL_SENTINEL");
    }

    const search = await executeSearchProjectFile({ projectFileId: f.id, query: "TXT_TAIL_SENTINEL" }, { frozenProjectContext: ctx });
    expect(search.ok).toBe(true);
    if (search.ok) {
      expect(search.data.kind).toBe("text");
      expect(search.data.matches.length).toBeGreaterThan(0);
      expect(search.data.matches[0].text).toContain("txt_tail_sentinel");
    }
  });
});

describe("pages canonicalization / 预算", () => {
  it("pages=[5,2,5] → 定向读取 [2,5]（dedupe + sort）", async () => {
    const p = await createKiroProject({ name: "P" });
    const texts = Array.from({ length: 6 }, (_, i) => `page text number ${i + 1}`);
    const f = await createProjectFile({ projectId: p.id, name: "six.pdf", mimeType: "application/pdf", sizeBytes: 10, kind: "pdf", blob: new Blob([buildMultiPageTextPdf(texts).buffer as ArrayBuffer], { type: "application/pdf" }) });
    const ctx = ctxOf(p.id, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes });
    const r = await executeReadProjectFile({ projectFileId: f.id, pages: [5, 2, 5] }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.pages?.map((pg) => pg.page)).toEqual([2, 5]);
      expect(r.data.note).toContain("第 2、5 页");
    }
  });

  it("pages=[999]（PDF 仅 6 页）→ INVALID_INPUT（不静默 clamp）", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "six.pdf", mimeType: "application/pdf", sizeBytes: 10, kind: "pdf", blob: new Blob([buildMultiPageTextPdf(["a", "b", "c", "d", "e", "f"]).buffer as ArrayBuffer], { type: "application/pdf" }) });
    const ctx = ctxOf(p.id, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes });
    const r = await executeReadProjectFile({ projectFileId: f.id, pages: [999] }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("INVALID_INPUT");
      expect(r.message).toContain("页码范围");
    }
  });

  it("非 PDF 传 pages → INVALID_INPUT（不忽略输入）", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "notes.md", mimeType: "text/markdown", sizeBytes: 3, kind: "text", blob: new Blob(["abc"], { type: "text/markdown" }) });
    const ctx = ctxOf(p.id, { id: f.id, name: f.name, kind: "text", sizeBytes: f.sizeBytes });
    const r = await executeReadProjectFile({ projectFileId: f.id, pages: [1] }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("INVALID_INPUT");
      expect(r.message).toContain("pages 仅适用于 PDF");
    }
  });

  it("单页 40k chars → 返回该页前 30k + truncated=true（不整页丢弃）", async () => {
    const p = await createKiroProject({ name: "P" });
    // 40k chars ≈ 500 行 × 14pt → 需要超高页面（pageHeight 7500）
    const f = await createProjectFile({ projectId: p.id, name: "bigpage.pdf", mimeType: "application/pdf", sizeBytes: 10, kind: "pdf", blob: new Blob([buildMultiPageTextPdf(["y".repeat(40_000)], { pageHeight: 7500 }).buffer as ArrayBuffer], { type: "application/pdf" }) });
    const ctx = ctxOf(p.id, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes });
    const r = await executeReadProjectFile({ projectFileId: f.id, pages: [1] }, ctx);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) {
      expect(r.data.pages?.length).toBe(1);
      expect(r.data.pages?.[0].text.length).toBeLessThanOrEqual(30_000);
      expect(r.data.truncated).toBe(true);
      expect(r.data.note).toContain("部分截断");
    }
  }, 60_000);
});

describe("search_project_file 边界", () => {
  it("image → NOT_SEARCHABLE；getBlob 0 calls", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "pic.png", mimeType: "image/png", sizeBytes: 4, kind: "image", blob: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer as ArrayBuffer], { type: "image/png" }) });
    const ctx = ctxOf(p.id, { id: f.id, name: f.name, kind: "image", sizeBytes: f.sizeBytes });
    const getBlob = vi.fn();
    const r = await executeSearchProjectFile({ projectFileId: f.id, query: "anything" }, { frozenProjectContext: ctx, deps: { getBlob: getBlob as never } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_SEARCHABLE");
    expect(getBlob).toHaveBeenCalledTimes(0);
  });

  it("cross-project：frozen A 搜 B 的文件 → NOT_FOUND；Blob 0 calls", async () => {
    const a = await createKiroProject({ name: "A" });
    const b = await createKiroProject({ name: "B" });
    const fb = await createProjectFile({ projectId: b.id, name: "b.txt", mimeType: "text/plain", sizeBytes: 3, kind: "text", blob: new Blob(["bbb"], { type: "text/plain" }) });
    const ctx = ctxOf(a.id, { id: "pf_fake", name: "fake", kind: "text", sizeBytes: 1 });
    const getBlob = vi.fn();
    const r = await executeSearchProjectFile({ projectFileId: fb.id, query: "b" }, { frozenProjectContext: ctx, deps: { getBlob: getBlob as never } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
    expect(getBlob).toHaveBeenCalledTimes(0);
  });

  it("query 无匹配 → matches=[]，不报 Provider error", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "short.txt", mimeType: "text/plain", sizeBytes: 3, kind: "text", blob: new Blob(["hello world"], { type: "text/plain" }) });
    const ctx = ctxOf(p.id, { id: f.id, name: f.name, kind: "text", sizeBytes: f.sizeBytes });
    const r = await executeSearchProjectFile({ projectFileId: f.id, query: "not_in_document" }, { frozenProjectContext: ctx });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.matches).toEqual([]);
      expect(r.data.matchCount).toBe(0);
    }
  });
});

describe("Citation：search / targeted / visual 合并为单 source", () => {
  it("search 137 + text 137,138 + visual 205 → availablePages [137,138,205] 单 row", () => {
    let sources: KiroSourceMeta[] = [];
    sources = upsertProjectFileSource(sources, { projectFileId: "pf_x", name: "doc.pdf", pages: [{ page: 137 }] });
    sources = upsertProjectFileSource(sources, { projectFileId: "pf_x", name: "doc.pdf", pages: [{ page: 137 }, { page: 138 }] });
    sources = upsertProjectFileSource(sources, { projectFileId: "pf_x", name: "doc.pdf", pages: [{ page: 205 }] });
    expect(sources).toHaveLength(1);
    expect(sources[0].sourceId).toBe(projectFileSourceId("pf_x"));
    expect(sources[0].availablePages).toEqual([137, 138, 205]);
  });

  it("TXT search 有 snippet 但无页码 → source 存在且 availablePages undefined（不伪造 p1）", () => {
    const sources = upsertProjectFileSource([], { projectFileId: "pf_t", name: "notes.txt" });
    expect(sources[0].sourceId).toBe(projectFileSourceId("pf_t"));
    expect(sources[0].availablePages).toBeUndefined();
  });

  it("PDF targeted read 只注册实际返回 Evidence 的页（pageCount 存在但 pages 只有 137）", async () => {
    // 直接验证 upsert 语义：只把实际 pages 加入 availablePages
    const sources = upsertProjectFileSource([], { projectFileId: "pf_x", name: "doc.pdf", pages: [{ page: 137 }] });
    expect(sources[0].availablePages).toEqual([137]);
  });
});

