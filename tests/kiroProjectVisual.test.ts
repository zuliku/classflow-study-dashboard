/**
 * Kiro Project Visual（V1.3B）：read_project_visual executor 安全与语义测试。
 * 覆盖：image kind 全链路 / scanned PDF discovery / 跨项目 0 endpoint / 非 Vision 模型 /
 * MIME whitelist / 页选择 / 普通 text PDF NOT_VISUAL_FILE / 共享 ledger / partial success。
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
import { clearAllFileBlobs, getFileBlob } from "@/lib/fileStorage";
import { clearConversationHistory } from "@/lib/ai/history/db";
import { executeReadProjectFile } from "@/lib/ai/tools/read/projectFile";
import { executeReadProjectVisual, normalizeRequestedProjectPdfPages, resolveProjectPdfVisualPages } from "@/lib/ai/tools/read/projectVisual";
import { createVisionTurnRuntimeBudget } from "@/lib/ai/attachments/visionTurnRuntimeBudget";
import { KiroProjectTurnContext } from "@/lib/ai/contextBudget/types";
import { buildScannedPdf, buildMinimalPdf, buildMultiPageTextPdf } from "@/tests/fixtures/files";
import { extractProjectVisualEvidence } from "@/lib/ai/vision/projectEvidence";
import { upsertProjectFileSource, projectFileSourceId } from "@/lib/ai/citations/sources";
import { KiroSourceMeta } from "@/lib/ai/citations/types";

const MIB = 1024 * 1024;

function makeContext(id: string, name: string, files: { id: string; name: string; kind: "text" | "pdf" | "docx" | "image"; sizeBytes: number }[]): KiroProjectTurnContext {
  return { id, name, files };
}

const imageBlob = (size: number, mime = "image/png") => {
  // 合法 PNG 最小签名 + 填充（executor 不真正解码；preprocess 注入）
  const buf = new ArrayBuffer(size);
  const view = new Uint8Array(buf);
  view.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new Blob([buf], { type: mime }) as Blob & { name?: string; lastModified?: number };
};

const noEvidence = { ok: true as const, items: [] };
const scannedBlob = () => new Blob([buildScannedPdf().buffer as ArrayBuffer], { type: "application/pdf" });
const visionTurn = { provider: "opencode-go", model: "mimo-v2.5", apiKey: "sk-test" };

const visionContextOf = (projectId: string, file: { id: string; name: string; kind: "text" | "pdf" | "docx" | "image"; sizeBytes: number }): KiroProjectTurnContext =>
  makeContext(projectId, "P", [file]);

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

describe("read_project_file（V1.3B image / scanned 语义）", () => {
  it("image → visualRequired=true，text 为空，不提取文本", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "pic.png", mimeType: "image/png", sizeBytes: 10, kind: "image", blob: imageBlob(10) });
    const r = await executeReadProjectFile({ projectFileId: f.id }, visionContextOf(p.id, { id: f.id, name: f.name, kind: "image", sizeBytes: f.sizeBytes }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.kind).toBe("image");
      expect(r.data.text).toBe("");
      expect(r.data.visualRequired).toBe(true);
      expect(r.data.note).toContain("read_project_visual");
    }
  });

  it("scanned PDF → possiblyScanned + pageCount + visualRequired，不自动 Vision", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "scan.pdf", mimeType: "application/pdf", sizeBytes: buildScannedPdf().length, kind: "pdf", blob: scannedBlob() });
    const r = await executeReadProjectFile({ projectFileId: f.id }, visionContextOf(p.id, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.possiblyScanned).toBe(true);
      expect(r.data.visualRequired).toBe(true);
      expect(typeof r.data.pageCount).toBe("number");
      expect(r.data.text).toBe("");
    }
  });
});

describe("read_project_visual", () => {
  async function setupImage(projectId: string, name = "pic.png", mime = "image/png", size = 64) {
    return createProjectFile({ projectId, name, mimeType: mime, sizeBytes: size, kind: "image", blob: imageBlob(size, mime) });
  }

  it("image 成功路径：preprocess → reserve → evidence；Original Blob 不变", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await setupImage(p.id, "pic.png", "image/png", 5 * MIB);
    const ledger = createVisionTurnRuntimeBudget({});
    const extractEvidence = vi.fn(async () => ({ ok: true as const, items: [{ text: "EVIDENCE_123" }] }));
    const preprocess = vi.fn(async (file: File) => ({
      file: new File([new Uint8Array(1024)], file.name, { type: "image/png" }),
      originalSize: 5 * MIB,
      outputSize: 1024,
      originalWidth: 4000,
      originalHeight: 3000,
      outputWidth: 128,
      outputHeight: 96,
      resized: true,
      reencoded: true,
    }));
    const r = await executeReadProjectVisual(
      { projectFileId: f.id },
      { frozenProjectContext: visionContextOf(p.id, { id: f.id, name: f.name, kind: "image", sizeBytes: f.sizeBytes }), frozenTurn: visionTurn, ledger, deps: { extractEvidence, preprocess } }
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.visualTranscribed).toBe(true);
      expect(r.data.text).toBe("EVIDENCE_123");
      expect(r.data.pages).toBeUndefined();
    }
    // Original Blob 保持原样（preprocess 只是读取；不修改持久化 Blob）
    expect((await getFileBlob(f.storageKey))?.size).toBe(5 * MIB);
    // preprocess 产物（≤2MiB）进入 evidence
    expect(preprocess).toHaveBeenCalledTimes(1);
    expect(ledger.remaining().totalBytes).toBe(10 * MIB - 1024);
  });

  it("跨 Project visual read 被拒绝：Blob/preprocess/endpoint 全部 0 调用", async () => {
    const a = await createKiroProject({ name: "A" });
    const b = await createKiroProject({ name: "B" });
    const fb = await setupImage(b.id, "b.png", "image/png", 64);
    const ledger = createVisionTurnRuntimeBudget({});
    const extractEvidence = vi.fn(async () => noEvidence);
    const preprocess = vi.fn(async (file: File) => ({ file, originalSize: 1, outputSize: 1, originalWidth: 1, originalHeight: 1, outputWidth: 1, outputHeight: 1, resized: false, reencoded: false }));
    // frozen A context，调用 B 的文件
    const r = await executeReadProjectVisual(
      { projectFileId: fb.id },
      { frozenProjectContext: visionContextOf(a.id, { id: "pf_a1", name: "a.md", kind: "text", sizeBytes: 3 }), frozenTurn: visionTurn, ledger, deps: { extractEvidence, preprocess } }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
    expect(extractEvidence).toHaveBeenCalledTimes(0);
    expect(preprocess).toHaveBeenCalledTimes(0);
  });

  it("非 Vision 模型 → VISION_MODEL_REQUIRED，endpoint 0 calls", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await setupImage(p.id);
    const ledger = createVisionTurnRuntimeBudget({});
    const extractEvidence = vi.fn(async () => noEvidence);
    const r = await executeReadProjectVisual(
      { projectFileId: f.id },
      { frozenProjectContext: visionContextOf(p.id, { id: f.id, name: f.name, kind: "image", sizeBytes: f.sizeBytes }), frozenTurn: { provider: "deepseek", model: "deepseek-v4-flash", apiKey: "sk-x" }, ledger, deps: { extractEvidence } }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("VISION_MODEL_REQUIRED");
    expect(extractEvidence).toHaveBeenCalledTimes(0);
  });

  it("MIME whitelist 拒绝：vision=true 但 whitelist=[JPEG,PNG] 的模型读 WEBP → VISION_FORMAT_UNSUPPORTED，0 calls", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await setupImage(p.id, "pic.webp", "image/webp", 64);
    const ledger = createVisionTurnRuntimeBudget({});
    const extractEvidence = vi.fn(async () => noEvidence);
    const getCapabilities = vi.fn(() => ({
      streaming: true,
      tools: true,
      vision: true,
      fileParts: false,
      pdf: false,
      visionMimeTypes: ["image/jpeg", "image/png"],
      reasoning: "fixed" as const,
    })) as unknown as typeof import("@/lib/ai/providers/capabilities").getModelCapabilities;
    const r = await executeReadProjectVisual(
      { projectFileId: f.id },
      {
        frozenProjectContext: visionContextOf(p.id, { id: f.id, name: f.name, kind: "image", sizeBytes: f.sizeBytes }),
        frozenTurn: { provider: "opencode-go", model: "mimo-v2.5", apiKey: "sk-x" },
        ledger,
        deps: { extractEvidence, getCapabilities },
      }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("VISION_FORMAT_UNSUPPORTED");
    expect(extractEvidence).toHaveBeenCalledTimes(0);
  });

  it("VISION_BUDGET_EXHAUSTED：reservation 失败时 endpoint 0 calls（预算已耗尽）", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await setupImage(p.id);
    const ledger = createVisionTurnRuntimeBudget({ initialUserImageBytes: 10 * MIB });
    const extractEvidence = vi.fn(async () => noEvidence);
    const preprocess = vi.fn(async (file: File) => ({ file, originalSize: 1, outputSize: 1, originalWidth: 1, originalHeight: 1, outputWidth: 1, outputHeight: 1, resized: false, reencoded: false }));
    const r = await executeReadProjectVisual(
      { projectFileId: f.id },
      { frozenProjectContext: visionContextOf(p.id, { id: f.id, name: f.name, kind: "image", sizeBytes: f.sizeBytes }), frozenTurn: visionTurn, ledger, deps: { extractEvidence, preprocess } }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("VISION_BUDGET_EXHAUSTED");
    expect(extractEvidence).toHaveBeenCalledTimes(0);
  });

  it("scanned PDF：latestUserText「第 12 页」→ 只选 12（无 pages 参数）", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "scan.pdf", mimeType: "application/pdf", sizeBytes: 10, kind: "pdf", blob: scannedBlob() });
    const ledger = createVisionTurnRuntimeBudget({});
    const extractEvidence = vi.fn(async (_input: import("@/lib/ai/vision/projectEvidence").ProjectVisualEvidenceInput) => ({ ok: true as const, items: [{ page: 12, text: "P12" }] }));
    const renderPages = vi.fn(async (_blob: Blob, pageNumbers: number[], _sourceId: string, _opts?: { maxBytes?: number }) => [{ page: 12, file: new File(["x"], "p12.jpg", { type: "image/jpeg" }), width: 100, height: 100, size: 10 }]);
    const extract = vi.fn(async () => ({ ok: true as const, extracted: { text: "", truncated: false, pageCount: 30, possiblyScanned: true } }));
    const r = await executeReadProjectVisual(
      { projectFileId: f.id },
      {
        frozenProjectContext: visionContextOf(p.id, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes }),
        frozenTurn: visionTurn,
        ledger,
        latestUserText: "扫描件第 12 页是什么？",
        deps: { extractEvidence, renderPages, extract },
      }
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.pages).toEqual([{ page: 12, text: "P12" }]);
      expect(r.data.text).toContain("第 12 页");
    }
    expect(renderPages.mock.calls[0][1]).toEqual([12]);
    expect((extractEvidence.mock.calls[0][0] as { pageNumbers?: number[] }).pageNumbers).toEqual([12]);
  });

  it("scanned PDF：显式 pages [2,5,5,100] → dedupe/sort/clamp → [2,5]", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "scan.pdf", mimeType: "application/pdf", sizeBytes: 10, kind: "pdf", blob: scannedBlob() });
    const ledger = createVisionTurnRuntimeBudget({});
    const renderPages = vi.fn(async (_blob: Blob, pageNumbers: number[], _sourceId: string, _opts?: { maxBytes?: number }) => [{ page: 2, file: new File(["x"], "p2.jpg", { type: "image/jpeg" }), width: 1, height: 1, size: 10 }, { page: 5, file: new File(["x"], "p5.jpg", { type: "image/jpeg" }), width: 1, height: 1, size: 10 }]);
    const extractEvidence = vi.fn(async (_input: import("@/lib/ai/vision/projectEvidence").ProjectVisualEvidenceInput) => ({ ok: true as const, items: [{ page: 2, text: "P2" }, { page: 5, text: "P5" }] }));
    const extract = vi.fn(async () => ({ ok: true as const, extracted: { text: "", truncated: false, pageCount: 30, possiblyScanned: true } }));
    const r = await executeReadProjectVisual(
      { projectFileId: f.id, pages: [2, 5, 5, 100] },
      {
        frozenProjectContext: visionContextOf(p.id, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes }),
        frozenTurn: visionTurn,
        ledger,
        deps: { extractEvidence, renderPages, extract },
      }
    );
    expect(r.ok).toBe(true);
    expect(renderPages.mock.calls[0][1]).toEqual([2, 5]);
  });

  it("普通 text PDF 无 page hint → PAGE_SELECTION_REQUIRED（V1.3C 不再 NOT_VISUAL_FILE），endpoint 0 calls", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "text.pdf", mimeType: "application/pdf", sizeBytes: 10, kind: "pdf", blob: scannedBlob() });
    const ledger = createVisionTurnRuntimeBudget({});
    const extractEvidence = vi.fn(async () => noEvidence);
    const renderPages = vi.fn();
    // 注入非 scanned 的 extract 结果（模拟 text-layer PDF）
    const extract = vi.fn(async () => ({ ok: true as const, extracted: { text: "plain", truncated: false, pageCount: 3 } }));
    const r = await executeReadProjectVisual(
      { projectFileId: f.id },
      {
        frozenProjectContext: visionContextOf(p.id, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes }),
        frozenTurn: visionTurn,
        ledger,
        deps: { extractEvidence, extract, renderPages: renderPages as never },
      }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PAGE_SELECTION_REQUIRED");
    expect(renderPages).toHaveBeenCalledTimes(0);
    expect(extractEvidence).toHaveBeenCalledTimes(0);
    expect(ledger.remaining()).toEqual({ totalBytes: 10 * MIB, pdfBytes: 8 * MIB, pdfPages: 6 });
  });

  it("shared PDF page cap：attachment 已用 4 pages → Project 最多 2（不足时 VISION_PDF_PAGE_LIMIT_REACHED）", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "scan.pdf", mimeType: "application/pdf", sizeBytes: 10, kind: "pdf", blob: scannedBlob() });
    const ledger = createVisionTurnRuntimeBudget({ initialPdfPages: 6 });
    const extractEvidence = vi.fn(async () => noEvidence);
    const r = await executeReadProjectVisual(
      { projectFileId: f.id, pages: [1, 2, 3] },
      {
        frozenProjectContext: visionContextOf(p.id, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes }),
        frozenTurn: visionTurn,
        ledger,
        deps: { extractEvidence },
      }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("VISION_PDF_PAGE_LIMIT_REACHED");
    expect(extractEvidence).toHaveBeenCalledTimes(0);
  });

  it("partial success：render [3,4]，extract 只成功 3 → pages 只有 [3]（Citation availablePages 只能 [3]）", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "scan.pdf", mimeType: "application/pdf", sizeBytes: 10, kind: "pdf", blob: scannedBlob() });
    const ledger = createVisionTurnRuntimeBudget({});
    const renderPages = vi.fn(async (_blob: Blob, _pageNumbers: number[], _sourceId: string, _opts?: { maxBytes?: number }) => [
      { page: 3, file: new File(["x"], "p3.jpg", { type: "image/jpeg" }), width: 1, height: 1, size: 10 },
      { page: 4, file: new File(["x"], "p4.jpg", { type: "image/jpeg" }), width: 1, height: 1, size: 10 },
    ]);
    const extractEvidence = vi.fn(async (_input: import("@/lib/ai/vision/projectEvidence").ProjectVisualEvidenceInput) => ({ ok: true as const, items: [{ page: 3, text: "P3_OK" }] }));
    const extract = vi.fn(async () => ({ ok: true as const, extracted: { text: "", truncated: false, pageCount: 30, possiblyScanned: true } }));
    const r = await executeReadProjectVisual(
      { projectFileId: f.id, pages: [3, 4] },
      {
        frozenProjectContext: visionContextOf(p.id, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes }),
        frozenTurn: visionTurn,
        ledger,
        deps: { extractEvidence, renderPages, extract },
      }
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.pages).toEqual([{ page: 3, text: "P3_OK" }]);
    }
  });
});

describe("normalizeRequestedProjectPdfPages（V1.3B.1 canonicalization）", () => {
  it("1. [12] / pageCount=30 / remaining=6 → [12]，truncated=false（不再误标）", () => {
    const r = normalizeRequestedProjectPdfPages({ requested: [12], pageCount: 30, remainingPageBudget: 6 });
    expect(r).toEqual({ pages: [12], truncated: false });
  });

  it("2. [5,2,5] → [2,5]，truncated=false（duplicate 不算内容缺失）", () => {
    const r = normalizeRequestedProjectPdfPages({ requested: [5, 2, 5], pageCount: 30, remainingPageBudget: 6 });
    expect(r).toEqual({ pages: [2, 5], truncated: false });
  });

  it("3. [2,100] / pageCount=30 → [2]，truncated=true（越界页被丢弃）", () => {
    const r = normalizeRequestedProjectPdfPages({ requested: [2, 100], pageCount: 30, remainingPageBudget: 6 });
    expect(r).toEqual({ pages: [2], truncated: true });
  });

  it("4. [1,2,3,4] / remaining=2 → [1,2]，truncated=true（预算裁剪）", () => {
    const r = normalizeRequestedProjectPdfPages({ requested: [1, 2, 3, 4], pageCount: 30, remainingPageBudget: 2 });
    expect(r).toEqual({ pages: [1, 2], truncated: true });
  });

  it("5. [100] / pageCount=30 → pages=[]（全越界；调用方应返回 INVALID_INPUT 而非预算错误）", () => {
    const r = normalizeRequestedProjectPdfPages({ requested: [100], pageCount: 30, remainingPageBudget: 6 });
    expect(r.pages).toEqual([]);
  });

  it("完全满足（剩余额度没用满）→ truncated=false", () => {
    const r = normalizeRequestedProjectPdfPages({ requested: [3, 4], pageCount: 30, remainingPageBudget: 6 });
    expect(r).toEqual({ pages: [3, 4], truncated: false });
  });
});

describe("read_project_visual（V1.3B.1 kind / gate 硬化）", () => {
  it("TXT 项目资料 → NOT_VISUAL_FILE，getBlob/extract/render/evidence 全部 0 调用，Ledger 不变", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "notes.md", mimeType: "text/markdown", sizeBytes: 12, kind: "text", blob: new Blob(["abc"]) });
    const ledger = createVisionTurnRuntimeBudget({});
    const extractEvidence = vi.fn(async () => noEvidence);
    const getBlob = vi.fn();
    const extract = vi.fn();
    const renderPages = vi.fn();
    const r = await executeReadProjectVisual(
      { projectFileId: f.id },
      {
        frozenProjectContext: visionContextOf(p.id, { id: f.id, name: f.name, kind: "text", sizeBytes: f.sizeBytes }),
        frozenTurn: visionTurn,
        ledger,
        deps: { extractEvidence, getBlob: getBlob as never, extract: extract as never, renderPages: renderPages as never },
      }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_VISUAL_FILE");
    expect(getBlob).toHaveBeenCalledTimes(0);
    expect(extract).toHaveBeenCalledTimes(0);
    expect(renderPages).toHaveBeenCalledTimes(0);
    expect(extractEvidence).toHaveBeenCalledTimes(0);
    expect(ledger.remaining()).toEqual({ totalBytes: 10 * MIB, pdfBytes: 8 * MIB, pdfPages: 6 });
  });

  it("DOCX 项目资料 → NOT_VISUAL_FILE，全部 0 调用", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "doc.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sizeBytes: 12, kind: "docx", blob: new Blob(["x"]) });
    const ledger = createVisionTurnRuntimeBudget({});
    const extractEvidence = vi.fn(async () => noEvidence);
    const getBlob = vi.fn();
    const r = await executeReadProjectVisual(
      { projectFileId: f.id },
      {
        frozenProjectContext: visionContextOf(p.id, { id: f.id, name: f.name, kind: "docx", sizeBytes: f.sizeBytes }),
        frozenTurn: visionTurn,
        ledger,
        deps: { extractEvidence, getBlob: getBlob as never },
      }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_VISUAL_FILE");
    expect(getBlob).toHaveBeenCalledTimes(0);
    expect(extractEvidence).toHaveBeenCalledTimes(0);
  });

  it("JPEG 不受支持（fake caps [png,webp]）→ VISION_FORMAT_UNSUPPORTED；Blob/rasterize/evidence/预算全 0 副作用", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "scan.pdf", mimeType: "application/pdf", sizeBytes: 10, kind: "pdf", blob: scannedBlob() });
    const ledger = createVisionTurnRuntimeBudget({});
    const extractEvidence = vi.fn(async () => noEvidence);
    const getBlob = vi.fn();
    const extract = vi.fn();
    const renderPages = vi.fn();
    const getCapabilities = vi.fn(() => ({
      streaming: true,
      tools: true,
      vision: true,
      fileParts: false,
      pdf: false,
      visionMimeTypes: ["image/png", "image/webp"],
      reasoning: "fixed" as const,
    })) as unknown as typeof import("@/lib/ai/providers/capabilities").getModelCapabilities;
    const r = await executeReadProjectVisual(
      { projectFileId: f.id },
      {
        frozenProjectContext: visionContextOf(p.id, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes }),
        frozenTurn: visionTurn,
        ledger,
        deps: { extractEvidence, getBlob: getBlob as never, extract: extract as never, renderPages: renderPages as never, getCapabilities },
      }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("VISION_FORMAT_UNSUPPORTED");
    expect(getBlob).toHaveBeenCalledTimes(0);
    expect(extract).toHaveBeenCalledTimes(0);
    expect(renderPages).toHaveBeenCalledTimes(0);
    expect(extractEvidence).toHaveBeenCalledTimes(0);
    // Ledger 完全不消费
    expect(ledger.remaining()).toEqual({ totalBytes: 10 * MIB, pdfBytes: 8 * MIB, pdfPages: 6 });
  });

  it("显式 pages=[12] → truncated=false（单页请求 100% 满足，不得因剩余额度误标）", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "scan.pdf", mimeType: "application/pdf", sizeBytes: 10, kind: "pdf", blob: scannedBlob() });
    const ledger = createVisionTurnRuntimeBudget({});
    const renderPages = vi.fn(async (_blob: Blob, pageNumbers: number[], _sourceId: string, _opts?: { maxBytes?: number }) => [{ page: 12, file: new File(["x"], "p12.jpg", { type: "image/jpeg" }), width: 1, height: 1, size: 10 }]);
    const extractEvidence = vi.fn(async (_input: import("@/lib/ai/vision/projectEvidence").ProjectVisualEvidenceInput) => ({ ok: true as const, items: [{ page: 12, text: "P12" }] }));
    const extract = vi.fn(async () => ({ ok: true as const, extracted: { text: "", truncated: false, pageCount: 30, possiblyScanned: true } }));
    const r = await executeReadProjectVisual(
      { projectFileId: f.id, pages: [12] },
      {
        frozenProjectContext: visionContextOf(p.id, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes }),
        frozenTurn: visionTurn,
        ledger,
        deps: { extractEvidence, renderPages, extract },
      }
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.pages).toEqual([{ page: 12, text: "P12" }]);
      expect(r.data.truncated).toBe(false);
    }
  });

  it("全越界 pages=[100] → INVALID_INPUT（不是 VISION_BUDGET_EXHAUSTED），rasterizer/Provider 0 调用", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "scan.pdf", mimeType: "application/pdf", sizeBytes: 10, kind: "pdf", blob: scannedBlob() });
    const ledger = createVisionTurnRuntimeBudget({});
    const renderPages = vi.fn();
    const extractEvidence = vi.fn(async () => noEvidence);
    const extract = vi.fn(async () => ({ ok: true as const, extracted: { text: "", truncated: false, pageCount: 30, possiblyScanned: true } }));
    const r = await executeReadProjectVisual(
      { projectFileId: f.id, pages: [100] },
      {
        frozenProjectContext: visionContextOf(p.id, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes }),
        frozenTurn: visionTurn,
        ledger,
        deps: { extractEvidence, renderPages, extract },
      }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_INPUT");
    expect(renderPages).toHaveBeenCalledTimes(0);
    expect(extractEvidence).toHaveBeenCalledTimes(0);
    expect(ledger.remaining()).toEqual({ totalBytes: 10 * MIB, pdfBytes: 8 * MIB, pdfPages: 6 });
  });

  it("预算裁剪 [1,2,3,4] 剩 2 页 → pages=[1,2]，truncated=true", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "scan.pdf", mimeType: "application/pdf", sizeBytes: 10, kind: "pdf", blob: scannedBlob() });
    const ledger = createVisionTurnRuntimeBudget({ initialPdfPages: 4 });
    const renderPages = vi.fn(async (_blob: Blob, pageNumbers: number[], _sourceId: string, _opts?: { maxBytes?: number }) => [{ page: 1, file: new File(["x"], "p1.jpg", { type: "image/jpeg" }), width: 1, height: 1, size: 10 }, { page: 2, file: new File(["x"], "p2.jpg", { type: "image/jpeg" }), width: 1, height: 1, size: 10 }]);
    const extractEvidence = vi.fn(async (_input: import("@/lib/ai/vision/projectEvidence").ProjectVisualEvidenceInput) => ({ ok: true as const, items: [{ page: 1, text: "P1" }, { page: 2, text: "P2" }] }));
    const extract = vi.fn(async () => ({ ok: true as const, extracted: { text: "", truncated: false, pageCount: 30, possiblyScanned: true } }));
    const r = await executeReadProjectVisual(
      { projectFileId: f.id, pages: [1, 2, 3, 4] },
      {
        frozenProjectContext: visionContextOf(p.id, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes }),
        frozenTurn: visionTurn,
        ledger,
        deps: { extractEvidence, renderPages, extract },
      }
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.pages).toEqual([{ page: 1, text: "P1" }, { page: 2, text: "P2" }]);
      expect(r.data.truncated).toBe(true);
    }
  });

  it("partial extraction：rendered [3,4] + evidence 仅 [3] → pages=[3]，truncated=true", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "scan.pdf", mimeType: "application/pdf", sizeBytes: 10, kind: "pdf", blob: scannedBlob() });
    const ledger = createVisionTurnRuntimeBudget({});
    const renderPages = vi.fn(async (_blob: Blob, _pageNumbers: number[], _sourceId: string, _opts?: { maxBytes?: number }) => [
      { page: 3, file: new File(["x"], "p3.jpg", { type: "image/jpeg" }), width: 1, height: 1, size: 10 },
      { page: 4, file: new File(["x"], "p4.jpg", { type: "image/jpeg" }), width: 1, height: 1, size: 10 },
    ]);
    const extractEvidence = vi.fn(async (_input: import("@/lib/ai/vision/projectEvidence").ProjectVisualEvidenceInput) => ({ ok: true as const, items: [{ page: 3, text: "P3_OK" }] }));
    const extract = vi.fn(async () => ({ ok: true as const, extracted: { text: "", truncated: false, pageCount: 30, possiblyScanned: true } }));
    const r = await executeReadProjectVisual(
      { projectFileId: f.id, pages: [3, 4] },
      {
        frozenProjectContext: visionContextOf(p.id, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes }),
        frozenTurn: visionTurn,
        ledger,
        deps: { extractEvidence, renderPages, extract },
      }
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.pages).toEqual([{ page: 3, text: "P3_OK" }]);
      expect(r.data.truncated).toBe(true);
    }
  });

  it("full extraction：rendered [3,4] + evidence [3,4] → truncated=false（剩余额度没用满不算截断）", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "scan.pdf", mimeType: "application/pdf", sizeBytes: 10, kind: "pdf", blob: scannedBlob() });
    const ledger = createVisionTurnRuntimeBudget({});
    const renderPages = vi.fn(async (_blob: Blob, _pageNumbers: number[], _sourceId: string, _opts?: { maxBytes?: number }) => [
      { page: 3, file: new File(["x"], "p3.jpg", { type: "image/jpeg" }), width: 1, height: 1, size: 10 },
      { page: 4, file: new File(["x"], "p4.jpg", { type: "image/jpeg" }), width: 1, height: 1, size: 10 },
    ]);
    const extractEvidence = vi.fn(async (_input: import("@/lib/ai/vision/projectEvidence").ProjectVisualEvidenceInput) => ({ ok: true as const, items: [{ page: 3, text: "P3" }, { page: 4, text: "P4" }] }));
    const extract = vi.fn(async () => ({ ok: true as const, extracted: { text: "", truncated: false, pageCount: 30, possiblyScanned: true } }));
    const r = await executeReadProjectVisual(
      { projectFileId: f.id, pages: [3, 4] },
      {
        frozenProjectContext: visionContextOf(p.id, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes }),
        frozenTurn: visionTurn,
        ledger,
        deps: { extractEvidence, renderPages, extract },
      }
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.pages).toEqual([{ page: 3, text: "P3" }, { page: 4, text: "P4" }]);
      expect(r.data.truncated).toBe(false);
    }
  });

  it("未知 page（route 异常返回 999）→ 丢弃，不进 Tool Output", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "scan.pdf", mimeType: "application/pdf", sizeBytes: 10, kind: "pdf", blob: scannedBlob() });
    const ledger = createVisionTurnRuntimeBudget({});
    const renderPages = vi.fn(async (_blob: Blob, _pageNumbers: number[], _sourceId: string, _opts?: { maxBytes?: number }) => [
      { page: 3, file: new File(["x"], "p3.jpg", { type: "image/jpeg" }), width: 1, height: 1, size: 10 },
    ]);
    const extractEvidence = vi.fn(async (_input: import("@/lib/ai/vision/projectEvidence").ProjectVisualEvidenceInput) => ({ ok: true as const, items: [{ page: 3, text: "P3" }, { page: 999, text: "GHOST" }] }));
    const extract = vi.fn(async () => ({ ok: true as const, extracted: { text: "", truncated: false, pageCount: 30, possiblyScanned: true } }));
    const r = await executeReadProjectVisual(
      { projectFileId: f.id, pages: [3] },
      {
        frozenProjectContext: visionContextOf(p.id, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes }),
        frozenTurn: visionTurn,
        ledger,
        deps: { extractEvidence, renderPages, extract },
      }
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.pages).toEqual([{ page: 3, text: "P3" }]);
      expect(JSON.stringify(r.data)).not.toContain("GHOST");
    }
  });

  it("evidence duplicate page（route 异常返回两次 page 3）→ 只保留一个，输出按 rendered 顺序", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "scan.pdf", mimeType: "application/pdf", sizeBytes: 10, kind: "pdf", blob: scannedBlob() });
    const ledger = createVisionTurnRuntimeBudget({});
    const renderPages = vi.fn(async (_blob: Blob, _pageNumbers: number[], _sourceId: string, _opts?: { maxBytes?: number }) => [
      { page: 3, file: new File(["x"], "p3.jpg", { type: "image/jpeg" }), width: 1, height: 1, size: 10 },
    ]);
    const extractEvidence = vi.fn(async (_input: import("@/lib/ai/vision/projectEvidence").ProjectVisualEvidenceInput) => ({ ok: true as const, items: [{ page: 3, text: "FIRST" }, { page: 3, text: "SECOND" }] }));
    const extract = vi.fn(async () => ({ ok: true as const, extracted: { text: "", truncated: false, pageCount: 30, possiblyScanned: true } }));
    const r = await executeReadProjectVisual(
      { projectFileId: f.id, pages: [3] },
      {
        frozenProjectContext: visionContextOf(p.id, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes }),
        frozenTurn: visionTurn,
        ledger,
        deps: { extractEvidence, renderPages, extract },
      }
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.pages).toEqual([{ page: 3, text: "FIRST" }]);
    }
  });
});

describe("read_project_visual（V1.3C text-layer PDF）", () => {
  const textPdfExtract = () => vi.fn(async () => ({ ok: true as const, extracted: { text: "plain text", truncated: false, pageCount: 20 } }));

  async function setupTextPdf(name = "report.pdf") {
    const p = await createKiroProject({ name: "P" });
    return createProjectFile({ projectId: p.id, name, mimeType: "application/pdf", sizeBytes: 10, kind: "pdf", blob: scannedBlob() });
  }

  it("显式 Tool pages=[8] → rasterize [8]，truncated=false", async () => {
    const f = await setupTextPdf();
    const ledger = createVisionTurnRuntimeBudget({});
    const renderPages = vi.fn(async (_blob: Blob, pageNumbers: number[], _sourceId: string, _opts?: { maxBytes?: number }) => [{ page: 8, file: new File(["x"], "p8.jpg", { type: "image/jpeg" }), width: 1, height: 1, size: 10 }]);
    const extractEvidence = vi.fn(async (_input: import("@/lib/ai/vision/projectEvidence").ProjectVisualEvidenceInput) => ({ ok: true as const, items: [{ page: 8, text: "CHART_P8" }] }));
    const r = await executeReadProjectVisual(
      { projectFileId: f.id, pages: [8] },
      {
        frozenProjectContext: visionContextOf(f.projectId, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes }),
        frozenTurn: visionTurn,
        ledger,
        deps: { extractEvidence, renderPages, extract: textPdfExtract() },
      }
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(renderPages.mock.calls[0][1]).toEqual([8]);
      expect(r.data.pages).toEqual([{ page: 8, text: "CHART_P8" }]);
      expect(r.data.truncated).toBe(false);
    }
  });

  it("User Text page hint（Tool 不传 pages）：「帮我分析第 12 页的折线图」→ [12]", async () => {
    const f = await setupTextPdf();
    const ledger = createVisionTurnRuntimeBudget({});
    const renderPages = vi.fn(async (_blob: Blob, pageNumbers: number[], _sourceId: string, _opts?: { maxBytes?: number }) => [{ page: 12, file: new File(["x"], "p12.jpg", { type: "image/jpeg" }), width: 1, height: 1, size: 10 }]);
    const extractEvidence = vi.fn(async (_input: import("@/lib/ai/vision/projectEvidence").ProjectVisualEvidenceInput) => ({ ok: true as const, items: [{ page: 12, text: "LINE_CHART" }] }));
    const r = await executeReadProjectVisual(
      { projectFileId: f.id },
      {
        frozenProjectContext: visionContextOf(f.projectId, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes }),
        frozenTurn: visionTurn,
        ledger,
        latestUserText: "帮我分析第 12 页的折线图",
        deps: { extractEvidence, renderPages, extract: textPdfExtract() },
      }
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.pages).toEqual([{ page: 12, text: "LINE_CHART" }]);
    expect(renderPages.mock.calls[0][1]).toEqual([12]);
  });

  it("User Text range：「比较第 4-6 页的三张图」→ [4,5,6]，truncated=false", async () => {
    const f = await setupTextPdf();
    const ledger = createVisionTurnRuntimeBudget({});
    const renderPages = vi.fn(async (_blob: Blob, pageNumbers: number[], _sourceId: string, _opts?: { maxBytes?: number }) => [{ page: 4, file: new File(["x"], "p4.jpg", { type: "image/jpeg" }), width: 1, height: 1, size: 10 }, { page: 5, file: new File(["x"], "p5.jpg", { type: "image/jpeg" }), width: 1, height: 1, size: 10 }, { page: 6, file: new File(["x"], "p6.jpg", { type: "image/jpeg" }), width: 1, height: 1, size: 10 }]);
    const extractEvidence = vi.fn(async (_input: import("@/lib/ai/vision/projectEvidence").ProjectVisualEvidenceInput) => ({ ok: true as const, items: [{ page: 4, text: "A" }, { page: 5, text: "B" }, { page: 6, text: "C" }] }));
    const r = await executeReadProjectVisual(
      { projectFileId: f.id },
      {
        frozenProjectContext: visionContextOf(f.projectId, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes }),
        frozenTurn: visionTurn,
        ledger,
        latestUserText: "比较第 4-6 页的三张图",
        deps: { extractEvidence, renderPages, extract: textPdfExtract() },
      }
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.pages?.map((p) => p.page)).toEqual([4, 5, 6]);
      expect(r.data.truncated).toBe(false);
    }
  });

  it("User Text range + 预算只剩 2 页 → [4,5]，truncated=true", async () => {
    const f = await setupTextPdf();
    const ledger = createVisionTurnRuntimeBudget({ initialPdfPages: 4 });
    const renderPages = vi.fn(async (_blob: Blob, pageNumbers: number[], _sourceId: string, _opts?: { maxBytes?: number }) => [{ page: 4, file: new File(["x"], "p4.jpg", { type: "image/jpeg" }), width: 1, height: 1, size: 10 }, { page: 5, file: new File(["x"], "p5.jpg", { type: "image/jpeg" }), width: 1, height: 1, size: 10 }]);
    const extractEvidence = vi.fn(async (_input: import("@/lib/ai/vision/projectEvidence").ProjectVisualEvidenceInput) => ({ ok: true as const, items: [{ page: 4, text: "A" }, { page: 5, text: "B" }] }));
    const r = await executeReadProjectVisual(
      { projectFileId: f.id },
      {
        frozenProjectContext: visionContextOf(f.projectId, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes }),
        frozenTurn: visionTurn,
        ledger,
        latestUserText: "比较第 4-6 页的三张图",
        deps: { extractEvidence, renderPages, extract: textPdfExtract() },
      }
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.pages?.map((p) => p.page)).toEqual([4, 5]);
      expect(r.data.truncated).toBe(true);
    }
  });

  it("shared PDF page cap：本 Turn 已用 5 页 → [8,9] 只能 [8]，truncated=true", async () => {
    const f = await setupTextPdf();
    const ledger = createVisionTurnRuntimeBudget({ initialPdfPages: 5 });
    const renderPages = vi.fn(async (_blob: Blob, pageNumbers: number[], _sourceId: string, _opts?: { maxBytes?: number }) => [{ page: 8, file: new File(["x"], "p8.jpg", { type: "image/jpeg" }), width: 1, height: 1, size: 10 }]);
    const extractEvidence = vi.fn(async (_input: import("@/lib/ai/vision/projectEvidence").ProjectVisualEvidenceInput) => ({ ok: true as const, items: [{ page: 8, text: "P8" }] }));
    const r = await executeReadProjectVisual(
      { projectFileId: f.id, pages: [8, 9] },
      {
        frozenProjectContext: visionContextOf(f.projectId, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes }),
        frozenTurn: visionTurn,
        ledger,
        deps: { extractEvidence, renderPages, extract: textPdfExtract() },
      }
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.pages?.map((p) => p.page)).toEqual([8]);
      expect(r.data.truncated).toBe(true);
    }
  });

  it("partial evidence：rendered [8,9] + Worker 仅成功 8 → pages=[8]，truncated=true", async () => {
    const f = await setupTextPdf();
    const ledger = createVisionTurnRuntimeBudget({});
    const renderPages = vi.fn(async (_blob: Blob, _pageNumbers: number[], _sourceId: string, _opts?: { maxBytes?: number }) => [
      { page: 8, file: new File(["x"], "p8.jpg", { type: "image/jpeg" }), width: 1, height: 1, size: 10 },
      { page: 9, file: new File(["x"], "p9.jpg", { type: "image/jpeg" }), width: 1, height: 1, size: 10 },
    ]);
    const extractEvidence = vi.fn(async (_input: import("@/lib/ai/vision/projectEvidence").ProjectVisualEvidenceInput) => ({ ok: true as const, items: [{ page: 8, text: "P8_OK" }] }));
    const r = await executeReadProjectVisual(
      { projectFileId: f.id, pages: [8, 9] },
      {
        frozenProjectContext: visionContextOf(f.projectId, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes }),
        frozenTurn: visionTurn,
        ledger,
        deps: { extractEvidence, renderPages, extract: textPdfExtract() },
      }
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.pages).toEqual([{ page: 8, text: "P8_OK" }]);
      expect(r.data.truncated).toBe(true);
    }
  });

  it("scanned PDF 无 page hint 仍默认读取（V1.3C 不改变 scanned 行为）", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "scan.pdf", mimeType: "application/pdf", sizeBytes: 10, kind: "pdf", blob: scannedBlob() });
    const ledger = createVisionTurnRuntimeBudget({});
    const renderPages = vi.fn(async (_blob: Blob, pageNumbers: number[], _sourceId: string, _opts?: { maxBytes?: number }) => pageNumbers.map((page) => ({ page, file: new File(["x"], `p${page}.jpg`, { type: "image/jpeg" }), width: 1, height: 1, size: 10 })));
    const extractEvidence = vi.fn(async (_input: import("@/lib/ai/vision/projectEvidence").ProjectVisualEvidenceInput) => ({ ok: true as const, items: [{ page: 1, text: "P1" }] }));
    const extract = vi.fn(async () => ({ ok: true as const, extracted: { text: "", truncated: false, pageCount: 30, possiblyScanned: true } }));
    const r = await executeReadProjectVisual(
      { projectFileId: f.id },
      {
        frozenProjectContext: visionContextOf(p.id, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes }),
        frozenTurn: visionTurn,
        ledger,
        deps: { extractEvidence, renderPages, extract },
      }
    );
    expect(r.ok).toBe(true);
    // scanned 默认策略：无页码 → 前 min(6, pageCount) 页
    expect(renderPages.mock.calls[0][1]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("V1.4.2：1 页零文本 PDF → scanned mode（无 pages 无 hint 也默认选 page 1，不 PAGE_SELECTION_REQUIRED）", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "scan1.pdf", mimeType: "application/pdf", sizeBytes: 10, kind: "pdf", blob: new Blob([buildMultiPageTextPdf([" "]).buffer as ArrayBuffer], { type: "application/pdf" }) });
    const ledger = createVisionTurnRuntimeBudget({});
    const renderPages = vi.fn(async (_blob: Blob, pageNumbers: number[], _sourceId: string, _opts?: { maxBytes?: number }) => pageNumbers.map((page) => ({ page, file: new File(["x"], `p${page}.jpg`, { type: "image/jpeg" }), width: 1, height: 1, size: 10 })));
    const extractEvidence = vi.fn(async (_input: import("@/lib/ai/vision/projectEvidence").ProjectVisualEvidenceInput) => ({ ok: true as const, items: [{ page: 1, text: "P1" }] }));
    const r = await executeReadProjectVisual(
      { projectFileId: f.id },
      {
        frozenProjectContext: visionContextOf(p.id, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes }),
        frozenTurn: visionTurn,
        ledger,
        deps: { extractEvidence, renderPages },
      }
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.pages).toEqual([{ page: 1, text: "P1" }]);
    }
    expect(renderPages.mock.calls[0][1]).toEqual([1]);
  });

  it("非 Vision 模型 + text PDF → VISION_MODEL_REQUIRED，endpoint 0 calls", async () => {
    const f = await setupTextPdf();
    const ledger = createVisionTurnRuntimeBudget({});
    const extractEvidence = vi.fn(async () => noEvidence);
    const r = await executeReadProjectVisual(
      { projectFileId: f.id, pages: [8] },
      {
        frozenProjectContext: visionContextOf(f.projectId, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes }),
        frozenTurn: { provider: "deepseek", model: "deepseek-v4-flash", apiKey: "sk-x" },
        ledger,
        deps: { extractEvidence },
      }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("VISION_MODEL_REQUIRED");
    expect(extractEvidence).toHaveBeenCalledTimes(0);
  });
});

describe("resolveProjectPdfVisualPages（V1.3C 纯 helper）", () => {
  it("explicit 始终最高优先级（两种 mode 一致）", () => {
    expect(resolveProjectPdfVisualPages({ mode: "text-layer", explicitPages: [8], pageCount: 20, remainingPageBudget: 6 })).toEqual({ ok: true, pages: [8], truncated: false });
    expect(resolveProjectPdfVisualPages({ mode: "scanned", explicitPages: [8], pageCount: 20, remainingPageBudget: 6 })).toEqual({ ok: true, pages: [8], truncated: false });
  });

  it("scanned 无 hint → 默认前 N 页", () => {
    const r = resolveProjectPdfVisualPages({ mode: "scanned", pageCount: 30, remainingPageBudget: 6 });
    expect(r).toEqual({ ok: true, pages: [1, 2, 3, 4, 5, 6], truncated: true });
  });

  it("text-layer 无 hint → PAGE_SELECTION_REQUIRED", () => {
    const r = resolveProjectPdfVisualPages({ mode: "text-layer", pageCount: 20, remainingPageBudget: 6 });
    expect(r).toEqual({ ok: false, code: "PAGE_SELECTION_REQUIRED" });
  });

  it("text-layer 有 user page hint → 允许；全越界 → INVALID_INPUT", () => {
    const r = resolveProjectPdfVisualPages({ mode: "text-layer", latestUserText: "第 12 页的图", pageCount: 20, remainingPageBudget: 6 });
    expect(r).toEqual({ ok: true, pages: [12], truncated: false });
    const bad = resolveProjectPdfVisualPages({ mode: "text-layer", latestUserText: "第 99 页的图", pageCount: 20, remainingPageBudget: 6 });
    expect(bad).toEqual({ ok: false, code: "INVALID_INPUT" });
  });
});

describe("read_project_file（V1.3C note）", () => {
  it("普通 text PDF（buildMinimalPdf）→ note 含视觉提示；visualRequired 不设；含 pages/pageCount", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "report.pdf", mimeType: "application/pdf", sizeBytes: 10, kind: "pdf", blob: new Blob([buildMinimalPdf("Hello Chart Report").buffer as ArrayBuffer], { type: "application/pdf" }) });
    const r = await executeReadProjectFile({ projectFileId: f.id }, visionContextOf(p.id, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes }));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) {
      expect(r.data.possiblyScanned).not.toBe(true);
      expect(r.data.visualRequired).toBeUndefined();
      expect(r.data.text).toContain("Hello");
      expect(r.data.pages?.length).toBeGreaterThan(0);
      expect(r.data.pageCount).toBeGreaterThan(0);
      expect(r.data.note).toContain("read_project_visual");
      expect(r.data.note).toContain("指定相关页码");
    }
  });

  it("TXT → 不出现 PDF 视觉提示 note", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "notes.md", mimeType: "text/markdown", sizeBytes: 3, kind: "text", blob: new Blob(["abc"], { type: "text/markdown" }) });
    const r = await executeReadProjectFile({ projectFileId: f.id }, visionContextOf(p.id, { id: f.id, name: f.name, kind: "text", sizeBytes: f.sizeBytes }));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) {
      expect(r.data.note).toBeUndefined();
    }
  });

  it("scanned PDF → 仍 visualRequired=true（V1.3C 不改变 scanned 语义）", async () => {
    const p = await createKiroProject({ name: "P" });
    const f = await createProjectFile({ projectId: p.id, name: "scan.pdf", mimeType: "application/pdf", sizeBytes: 10, kind: "pdf", blob: scannedBlob() });
    const r = await executeReadProjectFile({ projectFileId: f.id }, visionContextOf(p.id, { id: f.id, name: f.name, kind: "pdf", sizeBytes: f.sizeBytes }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.possiblyScanned).toBe(true);
      expect(r.data.visualRequired).toBe(true);
    }
  });
});

describe("Project File Source upsert（V1.3B）", () => {
  it("[1,2] + [5,6] → [1,2,5,6]，无 duplicate row", () => {
    let sources: KiroSourceMeta[] = [];
    sources = upsertProjectFileSource(sources, { projectFileId: "pf_a", name: "scan.pdf", pages: [{ page: 1 }, { page: 2 }] });
    sources = upsertProjectFileSource(sources, { projectFileId: "pf_a", name: "scan.pdf", pages: [{ page: 5 }, { page: 6 }] });
    expect(sources).toHaveLength(1);
    expect(sources[0].sourceId).toBe(projectFileSourceId("pf_a"));
    expect(sources[0].availablePages).toEqual([1, 2, 5, 6]);
  });

  it("read_project_file（text）→ read_project_visual（pages）合并为 union", () => {
    let sources: KiroSourceMeta[] = [];
    sources = upsertProjectFileSource(sources, { projectFileId: "pf_a", name: "doc.pdf", pages: [{ page: 1 }] });
    sources = upsertProjectFileSource(sources, { projectFileId: "pf_a", name: "doc.pdf", pages: [{ page: 3 }, { page: 2 }] });
    expect(sources[0].availablePages).toEqual([1, 2, 3]);
  });

  it("无 pages（image）→ availablePages undefined", () => {
    const sources = upsertProjectFileSource([], { projectFileId: "pf_a", name: "pic.png" });
    expect(sources[0].availablePages).toBeUndefined();
  });
});

