/**
 * Kiro Project Visual Evidence（V1.3B）—— Client 侧调用内部 Vision extraction route。
 *
 * 职责 ONLY：prepared images（preprocess 后 / rasterized JPEG）→ FormData →
 * /api/ai/vision/extract → bounded evidence text items。
 *
 * 安全：
 * - 只传 processed image binary + frozen model config + query hint；
 *   storageKey / projectId / projectFileId 绝不进入该 route（access control 已在 Browser 层完成）
 * - page 映射来自实际 rasterized 页（客户端传 pages[] 对齐文件顺序），
 *   模型永远不能生成页码
 * - 失败不外泄：apiKey / body / raw provider response 不记录
 */
export interface ProjectVisualEvidenceItem {
  /** PDF 页（1-based；普通图片无） */
  page?: number;
  text: string;
}

export type ProjectVisualEvidenceOutcome =
  | { ok: true; items: ProjectVisualEvidenceItem[] }
  | { ok: false; code: string; message: string };

export interface ProjectVisualEvidenceInput {
  /** 已预处理 / 已 rasterize 的视觉文件（顺序 = pages 顺序） */
  images: File[];
  /** 与 images 对齐的真实 PDF 页码（普通图片不传） */
  pageNumbers?: number[];
  /** 当前 User Turn 文本（bounded hint；模型不得复制/改写） */
  query?: string;
  provider: string;
  model: string;
  apiKey: string;
  customConfig?: unknown;
}

export const MAX_VISION_QUERY_HINT_CHARS = 2000;

/** 测试注入（生产 = global fetch） */
export type ProjectVisualEvidenceFetch = typeof fetch;

export async function extractProjectVisualEvidence(
  input: ProjectVisualEvidenceInput,
  deps?: { fetchImpl?: ProjectVisualEvidenceFetch }
): Promise<ProjectVisualEvidenceOutcome> {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const form = new FormData();
  form.set("provider", input.provider);
  form.set("model", input.model);
  if (input.apiKey) form.set("apiKey", input.apiKey);
  if (input.customConfig !== undefined) {
    try {
      form.set("customConfig", JSON.stringify(input.customConfig));
    } catch {
      /* 不可序列化：忽略（Server 按缺失处理） */
    }
  }
  const query = (input.query ?? "").trim().slice(0, MAX_VISION_QUERY_HINT_CHARS);
  if (query) form.set("query", query);
  if (input.pageNumbers && input.pageNumbers.length > 0) {
    form.set("pages", JSON.stringify(input.pageNumbers));
  }
  for (let i = 0; i < input.images.length; i++) {
    form.append(`file-${i}`, input.images[i], input.images[i].name);
  }

  let res: Response;
  try {
    res = await fetchImpl("/api/ai/vision/extract", { method: "POST", body: form });
  } catch {
    return { ok: false, code: "VISION_EXTRACT_FAILED", message: "视觉提取服务暂不可用，请稍后重试。" };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, code: "VISION_EXTRACT_FAILED", message: "视觉提取响应无法解析。" };
  }
  const body = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
  if (body.ok === true && Array.isArray(body.items)) {
    const items = (body.items as Record<string, unknown>[])
      .map((it) => ({
        page: typeof it.page === "number" ? it.page : undefined,
        text: typeof it.text === "string" ? it.text : "",
      }))
      .filter((it) => it.text.length > 0);
    return { ok: true, items };
  }
  return {
    ok: false,
    code: typeof body.code === "string" ? body.code : "VISION_EXTRACT_FAILED",
    message: typeof body.message === "string" ? body.message : "视觉提取失败。",
  };
}
