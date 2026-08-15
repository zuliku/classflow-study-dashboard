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
import { renderPdfPages, selectScannedPdfPages } from "@/lib/ai/attachments/pdfVision";
import { MAX_SCANNED_PDF_PAGES_PER_TURN } from "@/lib/ai/attachments/limits";
import { getModelCapabilities, isVisionMimeSupported } from "@/lib/ai/providers/capabilities";
import { resolveImageMimeType } from "@/lib/ai/attachments/imageMime";
import { VisionTurnRuntimeLedger } from "@/lib/ai/attachments/visionTurnRuntimeBudget";
import { KiroProjectTurnContext } from "@/lib/ai/contextBudget/types";
import {
  extractProjectVisualEvidence,
  ProjectVisualEvidenceItem,
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
  // 普通 text PDF：本阶段不做图表视觉（不请求 Provider）
  if (!doc.possiblyScanned) {
    return { ok: false, code: "NOT_VISUAL_FILE", message: "这份 PDF 是普通文本 PDF，请使用 read_project_file 读取正文。" };
  }
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
    let pageNumbers: number[];
    let selTruncated = false;
    if (explicitPages) {
      // dedupe / sort / 越界页丢弃（clamp 会伪造「100 页」→ 禁止）；按剩余页额度截断
      const seen = new Set<number>();
      pageNumbers = explicitPages
        .filter((p) => p >= 1 && p <= pageCount)
        .filter((p) => !seen.has(p) && seen.add(p))
        .slice(0, Math.min(rem.pdfPages, MAX_SCANNED_PDF_PAGES_PER_TURN));
      selTruncated = pageNumbers.length < explicitPages.length || pageNumbers.length < Math.min(rem.pdfPages, MAX_SCANNED_PDF_PAGES_PER_TURN);
    } else {
      const sel = selectScannedPdfPages({
        userText: opts.latestUserText,
        pageCount,
        maxPages: Math.min(rem.pdfPages, MAX_SCANNED_PDF_PAGES_PER_TURN),
      });
      pageNumbers = sel.pages;
      selTruncated = sel.truncated;
    }
    if (pageNumbers.length === 0) return { pages: [], truncated: selTruncated };
    const out = await (opts.deps?.renderPages ?? renderPdfPages)(blob, pageNumbers, `project-file-${projectFileId}`, {
      maxBytes: Math.min(rem.pdfBytes, rem.totalBytes),
    });
    return {
      pages: out.map((p) => ({ page: p.page, size: p.size, file: p.file })),
      truncated: selTruncated || out.length < pageNumbers.length,
    };
  });
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
  const items = evidence.items as (ProjectVisualEvidenceItem & { page?: number })[];
  const pages = items
    .filter((it) => it.page !== undefined)
    .map((it) => ({ page: it.page as number, text: it.text }));
  return {
    ok: true,
    data: {
      projectFileId,
      name: record.name,
      kind: "pdf",
      text: pages.length > 0 ? pages.map((p) => `第 ${p.page} 页：${p.text}`).join("\n") : "",
      pages,
      visualTranscribed: true,
      truncated: rendered.truncated || pages.length < items.length,
    },
  };
}
