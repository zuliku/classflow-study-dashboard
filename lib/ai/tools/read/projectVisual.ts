/**
 * read_project_visual（Browser Client 执行，V1.3B）：
 * 显式读取当前 Kiro Project 中图片 / 扫描 PDF 页面的视觉内容（按需，绝不自动进入每 Turn）。
 *
 * 工具链：IMAGE → read_project_visual；PDF → 先 read_project_file（possiblyScanned/visualRequired）→ read_project_visual。
 *
 * 安全 invariant：
 * - 复用 resolveProjectFileForTurn（frozen index + metadata + projectId 双重检查）—— 与 read_project_file 同构，不漂移
 * - 跨 Project 读取：在读取 Blob / preprocess / endpoint 之前 NOT_FOUND（endpoint 0 calls）
 * - 使用当前 Turn 冻结的 provider/model/apiKey/customConfig（turnSnapshot），绝不用 live AI settings
 * - 不依赖 Web PDF Vision settings
 * - capability gate：vision !== true → VISION_MODEL_REQUIRED（不发请求）
 * - image MIME gate：isVisionMimeSupported（不发请求）
 * - 普通 text PDF → NOT_VISUAL_FILE（不发请求；本阶段不做 text-PDF 图表视觉）
 * - 预算：共享 Turn Vision Ledger（10 MiB total / 8 MiB PDF / 6 pages），async-exclusive reservation，
 *   并发 visual calls 不能 overspend；失败不 refund（conservative）
 * - storageKey 绝不进入 Tool Output / Vision route
 * - page number 只来自实际 rasterized 页（模型永不生成页码）；Citation availablePages 只含成功 evidence 页
 */
import { z } from "zod";
import { getProjectFileBlob } from "@/lib/ai/projects/files/db";
import { resolveProjectFileForTurn } from "@/lib/ai/projects/files/access";
import { extractAttachment } from "@/lib/ai/attachments";
import { extractCacheKey } from "@/lib/ai/attachments/cache";
import { preprocessVisionImage } from "@/lib/ai/attachments/preprocessImage";
import { renderPdfPages, selectScannedPdfPages, extractExplicitPages } from "@/lib/ai/attachments/pdfVision";
import { MAX_SCANNED_PDF_PAGES_PER_TURN } from "@/lib/ai/attachments/limits";
import { getModelCapabilities, isVisionMimeSupported } from "@/lib/ai/providers/capabilities";
import { resolveImageMimeType } from "@/lib/ai/attachments/imageMime";
import { VisionTurnRuntimeLedger } from "@/lib/ai/attachments/visionTurnRuntimeBudget";
import { KiroProjectTurnContext } from "@/lib/ai/contextBudget/types";
import {
  extractProjectVisualEvidence,
} from "@/lib/ai/vision/projectEvidence";

const schema = z
  .object({
    projectFileId: z.string().trim().min(1).max(120),
    pages: z
      .array(z.number().int().min(1).max(10000))
      .min(1)
      .max(MAX_SCANNED_PDF_PAGES_PER_TURN)
      .optional(),
  })
  .strict();

/**
 * V1.3C：统一 PDF 页选择（纯函数，Node 可测）。
 * - Tool explicit pages 始终最高优先级：走 normalizeRequestedProjectPdfPages（V1.3B.1 canonicalization 复用）
 * - scanned：保持 V1.3B 默认策略（无页码也可 selectScannedPdfPages 默认页）
 * - text-layer：禁止默认扫前 N 页；只接受 Tool pages 或 User Text 中的明确页码；
 *   无任何 page hint → PAGE_SELECTION_REQUIRED（让 Kiro read_project_file → 定位页 → 再 Visual）
 */
export type ProjectPdfVisualMode = "scanned" | "text-layer";

export type ProjectPdfVisualPageSelection =
  | { ok: true; pages: number[]; truncated: boolean }
  | { ok: false; code: "PAGE_SELECTION_REQUIRED" | "INVALID_INPUT" };

export function resolveProjectPdfVisualPages(input: {
  mode: ProjectPdfVisualMode;
  explicitPages?: number[];
  latestUserText?: string;
  pageCount: number;
  remainingPageBudget: number;
}): ProjectPdfVisualPageSelection {
  const pageCount = Math.max(1, input.pageCount);
  // A. Tool explicit pages 最高优先级（与 scanned/text-layer 无关）
  if (input.explicitPages && input.explicitPages.length > 0) {
    const sel = normalizeRequestedProjectPdfPages({
      requested: input.explicitPages,
      pageCount,
      remainingPageBudget: input.remainingPageBudget,
    });
    if (sel.pages.length === 0) return { ok: false, code: "INVALID_INPUT" };
    return { ok: true, pages: sel.pages, truncated: sel.truncated };
  }
  // B. scanned：保持默认策略（无页码 → 默认前 N 页；有页码表达 → 优先）
  if (input.mode === "scanned") {
    const sel = selectScannedPdfPages({
      userText: input.latestUserText,
      pageCount,
      maxPages: Math.min(Math.max(1, input.remainingPageBudget), MAX_SCANNED_PDF_PAGES_PER_TURN),
    });
    return { ok: true, pages: sel.pages, truncated: sel.truncated };
  }
  // C. text-layer：只接受明确页码（Tool pages 已处理 → 此处只能来自 User Text）
  const ranges = extractExplicitPages(input.latestUserText ?? "");
  if (ranges.length === 0) {
    return { ok: false, code: "PAGE_SELECTION_REQUIRED" };
  }
  const requested: number[] = [];
  for (const r of ranges) {
    for (let p = r.start; p <= r.end; p++) requested.push(p);
  }
  const sel = normalizeRequestedProjectPdfPages({
    requested,
    pageCount,
    remainingPageBudget: input.remainingPageBudget,
  });
  if (sel.pages.length === 0) return { ok: false, code: "INVALID_INPUT" };
  return { ok: true, pages: sel.pages, truncated: sel.truncated };
}

/**
 * V1.3B.1：显式页码 canonicalization（纯函数，Node 可测）。
 * 1. 只保留 1 <= page <= pageCount
 * 2. dedupe（duplicate 不算内容缺失）
 * 3. sort ascending
 * 4. 按 min(remainingPageBudget, MAX_SCANNED_PDF_PAGES_PER_TURN) 截断
 *
 * truncated 语义 = 「想读取的有效内容有部分没进入 Evidence」：
 * - duplicate 不算 truncation
 * - 越界页被丢弃 → truncated=true
 * - 预算裁剪 → truncated=true
 * - 完全满足（哪怕剩余额度没用满）→ truncated=false
 */
export function normalizeRequestedProjectPdfPages(input: {
  requested: number[];
  pageCount: number;
  remainingPageBudget: number;
  maxPages?: number;
}): { pages: number[]; truncated: boolean } {
  const pageCount = Math.max(1, input.pageCount);
  const max = Math.max(1, Math.min(input.maxPages ?? MAX_SCANNED_PDF_PAGES_PER_TURN, Math.max(1, input.remainingPageBudget)));
  const uniqueRequested = new Set<number>(input.requested);
  const valid: number[] = [];
  const seen = new Set<number>();
  for (const p of input.requested) {
    if (p >= 1 && p <= pageCount && !seen.has(p)) {
      seen.add(p);
      valid.push(p);
    }
  }
  valid.sort((a, b) => a - b);
  const clipped = valid.length > max;
  const droppedOutOfRange = valid.length < uniqueRequested.size;
  const pages = valid.slice(0, max);
  return { pages, truncated: clipped || droppedOutOfRange };
}

export interface ReadProjectVisualTurnModel {
  provider: string;
  model: string;
  apiKey?: string;
  customConfig?: unknown;
}

export type ReadProjectVisualResult = {
  projectFileId: string;
  name: string;
  kind: "image" | "pdf";
  text: string;
  pages?: { page: number; text: string }[];
  visualTranscribed: boolean;
  truncated?: boolean;
};

export type ReadProjectVisualErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "FILE_MISSING"
  | "VISION_MODEL_REQUIRED"
  | "VISION_FORMAT_UNSUPPORTED"
  | "VISION_BUDGET_EXHAUSTED"
  | "VISION_PDF_PAGE_LIMIT_REACHED"
  | "PAGE_SELECTION_REQUIRED"
  | "NOT_VISUAL_FILE"
  | "VISION_EXTRACT_FAILED"
  | "EXTRACT_FAILED";

export interface ReadProjectVisualDeps {
  getBlob?: typeof getProjectFileBlob;
  preprocess?: typeof preprocessVisionImage;
  extract?: typeof extractAttachment;
  renderPages?: typeof renderPdfPages;
  extractEvidence?: typeof extractProjectVisualEvidence;
  /** 测试注入：capability gate 覆盖（生产 = getModelCapabilities） */
  getCapabilities?: typeof getModelCapabilities;
}

export type ReadProjectVisualOutcome =
  | { ok: true; data: ReadProjectVisualResult }
  | { ok: false; code: ReadProjectVisualErrorCode; message: string };

export async function executeReadProjectVisual(
  input: unknown,
  opts: {
    frozenProjectContext: KiroProjectTurnContext | undefined;
    frozenTurn: ReadProjectVisualTurnModel;
    ledger: VisionTurnRuntimeLedger;
    latestUserText?: string;
    deps?: ReadProjectVisualDeps;
  }
): Promise<ReadProjectVisualOutcome> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT", message: "输入不合法。" };
  }
  const { projectFileId } = parsed.data;
  const explicitPages = parsed.data.pages;

  // ---- 共享 access guard（frozen index + metadata + 跨项目双重检查）----
  const access = await resolveProjectFileForTurn({ projectFileId, projectContext: opts.frozenProjectContext });
  if (!access.ok) {
    return { ok: false, code: access.code, message: access.message };
  }
  const { record } = access;

  // ---- 当前 Turn 冻结模型 capability gate（不发任何 Provider 请求）----
  const capabilities = (opts.deps?.getCapabilities ?? getModelCapabilities)({
    provider: opts.frozenTurn.provider as "opencode-go" | "deepseek" | "custom-openai",
    model: opts.frozenTurn.model,
    custom: opts.frozenTurn.customConfig as never,
  });
  if (capabilities.vision !== true) {
    return { ok: false, code: "VISION_MODEL_REQUIRED", message: "当前模型不支持视觉项目资料，请切换到支持图片理解的模型。" };
  }
  const apiKey = (opts.frozenTurn.apiKey ?? "").trim();
  if (!apiKey) {
    return { ok: false, code: "VISION_MODEL_REQUIRED", message: "当前模型尚未配置 API Key，无法读取视觉内容。" };
  }

  const getBlob = opts.deps?.getBlob ?? getProjectFileBlob;
  const extractEvidence = opts.deps?.extractEvidence ?? extractProjectVisualEvidence;
  const { provider, model, customConfig } = opts.frozenTurn;

  const evidenceFail = (evidence: { ok: false; code: string; message: string }): ReadProjectVisualOutcome => {
    // 只透传已知预算/能力错误码；其余统一映射为 VISION_EXTRACT_FAILED（不外泄 provider 细节）
    const known: ReadProjectVisualErrorCode[] = [
      "VISION_MODEL_REQUIRED",
      "VISION_FORMAT_UNSUPPORTED",
      "VISION_BUDGET_EXHAUSTED",
      "VISION_PDF_PAGE_LIMIT_REACHED",
    ];
    return {
      ok: false,
      code: (known as string[]).includes(evidence.code) ? (evidence.code as ReadProjectVisualErrorCode) : "VISION_EXTRACT_FAILED",
      message: evidence.message,
    };
  };

  // ================= IMAGE =================
  if (record.kind === "image") {
    // MIME gate（原 record.mimeType/name；绝不偷偷转码绕过 whitelist）
    if (!isVisionMimeSupported(capabilities, record.mimeType, record.name)) {
      return { ok: false, code: "VISION_FORMAT_UNSUPPORTED", message: "当前模型不支持这种图片格式的项目资料。" };
    }
    const blob = await getBlob(record.storageKey);
    if (!blob) {
      return { ok: false, code: "FILE_MISSING", message: "该项目资料文件已不存在，请重新上传。" };
    }
    // preprocess：<=2048px / <=2MiB；Original Project Blob 不变；失败不消耗预算
    let prepared;
    try {
      const mime = resolveImageMimeType({ mimeType: record.mimeType, fileName: record.name }) ?? record.mimeType;
      const file = new File([blob], record.name, { type: mime || "image/png" });
      prepared = await (opts.deps?.preprocess ?? preprocessVisionImage)(file);
    } catch {
      return { ok: false, code: "VISION_EXTRACT_FAILED", message: "图片读取失败，请重新上传该资料。" };
    }
    // async-exclusive reservation（payload 已准备 → 即使后续失败也不 refund）
    const reserved = await opts.ledger.reserveImageExclusive(prepared.file.size);
    if (!reserved) {
      return { ok: false, code: "VISION_BUDGET_EXHAUSTED", message: "本轮视觉预算已用完，请在新一轮提问中读取。" };
    }
    const evidence = await extractEvidence({
      images: [prepared.file],
      query: opts.latestUserText,
      provider,
      model,
      apiKey,
      customConfig,
    });
    if (!evidence.ok || evidence.items.length === 0) {
      if (evidence.ok === false) return evidenceFail(evidence);
      return { ok: false, code: "VISION_EXTRACT_FAILED", message: "视觉内容提取失败。" };
    }
    return {
      ok: true,
      data: {
        projectFileId,
        name: record.name,
        kind: "image",
        text: evidence.items[0].text,
        visualTranscribed: true,
      },
    };
  }

  // ================= PDF =================
  // V1.3B.1：明确 kind gate —— read_project_visual 只支持 image / pdf(scanned)；
  // text/docx 在读取 Blob / extract / preprocess / rasterize / budget reservation / route 之前立即拒绝。
  if (record.kind !== "pdf") {
    return {
      ok: false,
      code: "NOT_VISUAL_FILE",
      message: "该项目资料是文本类文档，请使用 read_project_file 读取正文。",
    };
  }
  // V1.3B.1：PDF rasterizer 输出固定 JPEG —— 在 getBlob/extract/rasterize/ledger reservation 之前
  // 校验当前 frozen model 是否支持 JPEG（Server 双 guard；此处避免无意义工作与预算消费）。
  if (!isVisionMimeSupported(capabilities, "image/jpeg", "project-pdf-page.jpg")) {
    return {
      ok: false,
      code: "VISION_FORMAT_UNSUPPORTED",
      message: "当前模型无法读取扫描 PDF 使用的 JPEG 页面。",
    };
  }
  const blob = await getBlob(record.storageKey);
  if (!blob) {
    return { ok: false, code: "FILE_MISSING", message: "该项目资料文件已不存在，请重新上传。" };
  }
  const extracted = await (opts.deps?.extract ?? extractAttachment)(blob, {
    kind: "pdf",
    cacheKey: extractCacheKey({ name: record.storageKey, size: record.sizeBytes, lastModified: 0 }),
  });
  if (!extracted.ok) {
    return { ok: false, code: "EXTRACT_FAILED", message: "该项目资料读取失败，请重新上传。" };
  }
  const doc = extracted.extracted;
  // V1.3C：text-layer PDF 不再硬拒绝 —— 两种 mode 都允许 rasterize + Vision，
  // 仅 page selection policy 不同（text-layer 禁止默认扫前 N 页）。
  const pdfMode: ProjectPdfVisualMode = doc.possiblyScanned ? "scanned" : "text-layer";
  const pageCount = Math.max(1, doc.pageCount ?? 1);

  // ---- 预算 pre-check（reservation 前，不消耗）----
  const remaining = opts.ledger.remaining();
  if (remaining.pdfPages <= 0) {
    return { ok: false, code: "VISION_PDF_PAGE_LIMIT_REACHED", message: "本轮扫描 PDF 页面读取已达上限。" };
  }
  if (remaining.pdfBytes <= 0 || remaining.totalBytes <= 0) {
    return { ok: false, code: "VISION_BUDGET_EXHAUSTED", message: "本轮视觉预算已用完，请在新一轮提问中读取。" };
  }

  // ---- async-exclusive：页选择 + rasterize（按实际 rendered pages/bytes 扣减）----
  const rendered = await opts.ledger.runPdfRasterizationExclusive(async (rem) => {
    const sel = resolveProjectPdfVisualPages({
      mode: pdfMode,
      explicitPages,
      latestUserText: opts.latestUserText,
      pageCount,
      remainingPageBudget: rem.pdfPages,
    });
    if (!sel.ok) return { pages: [], truncated: false, selectionError: sel.code };
    if (sel.pages.length === 0) return { pages: [], truncated: sel.truncated, selectionError: null };
    const out = await (opts.deps?.renderPages ?? renderPdfPages)(blob, sel.pages, `project-file-${projectFileId}`, {
      maxBytes: Math.min(rem.pdfBytes, rem.totalBytes),
    });
    return {
      pages: out.map((p) => ({ page: p.page, size: p.size, file: p.file })),
      truncated: sel.truncated || out.length < sel.pages.length,
      selectionError: null,
    };
  });
  if (rendered.selectionError === "PAGE_SELECTION_REQUIRED") {
    return {
      ok: false,
      code: "PAGE_SELECTION_REQUIRED",
      message: "普通 PDF 已有文本层。请先使用 read_project_file 定位相关页，再用 pages 指定需要视觉查看的页面。",
    };
  }
  if (rendered.selectionError === "INVALID_INPUT") {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: `请求的页码均超出该 PDF 的页码范围（1-${pageCount}）。`,
    };
  }
  if (rendered.pages.length === 0) {
    return { ok: false, code: "VISION_BUDGET_EXHAUSTED", message: "剩余视觉预算不足以渲染该 PDF 页面。" };
  }

  // ---- Vision 转录（锁外）----
  const evidence = await extractEvidence({
    images: rendered.pages.map((p) => p.file),
    pageNumbers: rendered.pages.map((p) => p.page),
    query: opts.latestUserText,
    provider,
    model,
    apiKey,
    customConfig,
  });
  if (!evidence.ok || evidence.items.length === 0) {
    if (evidence.ok === false) return evidenceFail(evidence);
    return { ok: false, code: "VISION_EXTRACT_FAILED", message: "视觉内容提取失败。" };
  }
  // V1.3B.1：successful evidence 必须严格属于 rendered pages；未知 page 丢弃；
  // 去重（第一个胜出）；输出顺序按 rendered page 顺序（不依赖 Provider completion order）。
  const renderedPageNumbers = rendered.pages.map((p) => p.page);
  const evidenceByPage = new Map<number, string>();
  for (const it of evidence.items) {
    if (it.page === undefined) continue;
    if (!renderedPageNumbers.includes(it.page)) continue;
    if (!evidenceByPage.has(it.page)) evidenceByPage.set(it.page, it.text);
  }
  const pages = renderedPageNumbers
    .filter((p) => evidenceByPage.has(p))
    .map((p) => ({ page: p, text: evidenceByPage.get(p) as string }));
  // partial extraction：rendered 页数与成功 evidence 页数不一致 → 截断（不能只依赖 rendered.truncated）
  const partialExtraction = pages.length < renderedPageNumbers.length;
  return {
    ok: true,
    data: {
      projectFileId,
      name: record.name,
      kind: "pdf",
      text: pages.length > 0 ? pages.map((p) => `第 ${p.page} 页：${p.text}`).join("\n") : "",
      pages,
      visualTranscribed: true,
      truncated: rendered.truncated || partialExtraction,
    },
  };
}
