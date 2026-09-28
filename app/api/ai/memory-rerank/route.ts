import { z } from "zod/v3";
import { resolveLanguageModel } from "@/lib/ai/providers/resolver";
import { logProviderError } from "@/lib/ai/providerLog";
import { normalizeAIError } from "@/lib/ai/errors";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * 记忆语义重排（两阶段第二阶段；server 侧小调用）。
 * 输入 query + 候选（id/title/content/category，均有界）→ 输出按语义相关度排序的 id。
 * 只排序不改写；任何 AI/解析失败 → 5xx（browser 降级为召回序，绝不阻塞 search_memories）。
 * invocation 校验与 chat 路由同源（Task 12）。
 */
const RerankCandidateSchema = z.object({
  id: z.string().min(1).max(120),
  title: z.string().min(1).max(60),
  content: z.string().min(1).max(500),
  category: z.string().min(1).max(40),
});

const RerankRequestSchema = z.object({
  invocationId: z.string().min(1).max(200),
  provider: z.string().min(1).max(40),
  model: z.string().min(1).max(80),
  // 与 chat 路由同源：browser 每 Turn 必带 session apiKey（server-key/BYOK 均在 session）
  apiKey: z.string().min(1).max(2000),
  customConfig: z.unknown().optional(),
  query: z.string().trim().min(1).max(100),
  candidates: z.array(RerankCandidateSchema).min(1).max(10),
});

function buildRerankPrompt(query: string, candidates: { id: string; title: string; content: string; category: string }[]): string {
  const lines = candidates.map(
    (c, i) => `${i + 1}. [${c.id}] ${c.title}（${c.category}）：${c.content}`
  );
  return [
    "你是记忆检索排序器。用户问题与若干条长期学习记忆（偏好/习惯/目标/约束）给定，按“对回答该问题/执行该意图的实际帮助程度”从高到低排序。",
    "只输出 JSON，不要解释：{\"orderedIds\":[\"id1\",\"id2\",...]}（必须包含全部候选 id，不增不减）。",
    `用户问题：${query}`,
    "候选：",
    ...lines,
  ].join("\n");
}

export async function handleMemoryRerank(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ code: "INVALID_INPUT", message: "请求格式无效。" }, { status: 400 });
  }
  const parsed = RerankRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ code: "INVALID_INPUT", message: "重排参数不合法。" }, { status: 400 });
  }
  const { invocationId, provider, model: modelId, apiKey, customConfig, query, candidates } = parsed.data;

  try {
    const { resolveInvocationOrThrow } = await import("@/src/main/security/invocationTrust");
    resolveInvocationOrThrow(invocationId);
  } catch (err) {
    const raw = (err as Error).message ?? String(err);
    try {
      const parsedErr = JSON.parse(raw) as { code?: string; message?: string };
      return Response.json({ code: parsedErr.code ?? "INVOCATION_REQUIRED", message: parsedErr.message ?? raw }, { status: 403 });
    } catch {
      return Response.json({ code: "INVOCATION_REQUIRED", message: raw }, { status: 403 });
    }
  }

  let resolved;
  try {
    resolved = await resolveLanguageModel({
      provider: provider as never,
      model: modelId,
      apiKey,
      ...(customConfig !== undefined && customConfig !== null && typeof customConfig === "object"
        ? { custom: customConfig as never }
        : {}),
    });
  } catch (err) {
    logProviderError("memory-rerank/resolve", err);
    const aiErr = normalizeAIError(err);
    return Response.json({ code: aiErr.code, message: aiErr.message }, { status: 400 });
  }

  try {
    const { generateText } = await import("ai");
    const { model } = resolved;
    const { text } = await generateText({
      model: model as never,
      prompt: buildRerankPrompt(query, candidates),
      temperature: 0,
    } as never);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : text;
    let ids: unknown;
    try {
      ids = (JSON.parse(jsonStr) as { orderedIds?: unknown }).orderedIds;
    } catch {
      const cleaned = jsonStr.replace(/```json/g, "").replace(/```/g, "").trim();
      ids = (JSON.parse(cleaned) as { orderedIds?: unknown }).orderedIds;
    }
    if (!Array.isArray(ids)) {
      return Response.json({ code: "AI_INVALID_OUTPUT", message: "重排输出不是 id 数组。" }, { status: 500 });
    }
    const known = new Set(candidates.map((c) => c.id));
    const orderedIds: string[] = [];
    for (const id of ids) {
      if (typeof id !== "string" || !known.has(id) || orderedIds.includes(id)) continue;
      orderedIds.push(id);
    }
    // 缺失的候选按原序补尾（fail-soft：绝不丢结果）
    for (const c of candidates) {
      if (!orderedIds.includes(c.id)) orderedIds.push(c.id);
    }
    return Response.json({ orderedIds });
  } catch (err) {
    logProviderError("memory-rerank/generate", err);
    const aiErr = normalizeAIError(err);
    return Response.json({ code: aiErr.code, message: aiErr.message }, { status: 500 });
  }
}
