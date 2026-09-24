/**
 * Kiro Inspector V1 — 纯数据归一（无 React / 无 IO）。
 *
 * 职责边界：
 * - Outputs：Conversation Artifact 归属判定（真实 metadata，绝不按文件名猜测）
 * - Sources：语义 key 去重 + live Turn 优先排序（Turn-local sourceId 不足以去重）
 *
 * UI 组件只做渲染，不承担复杂归一。
 */
import type { KiroArtifact } from "@/lib/ai/computer/artifacts/types";
import type { KiroSourceMeta } from "@/lib/ai/citations/types";

/** Outputs：Artifact 是否属于某 Conversation（唯一判据 = sourceConversationId） */
export function artifactBelongsToConversation(
  artifact: Pick<KiroArtifact, "sourceConversationId">,
  conversationId: string | null | undefined
): boolean {
  if (!conversationId) return false;
  return artifact.sourceConversationId === conversationId;
}

/**
 * Sources 语义 key（跨 Turn 稳定；Turn-local sourceId 不参与）：
 * - web：安全归一 URL（无 URL → source + domain + name）
 * - course-material：courseName + name
 * - 其它（chat / project-file）：source + name
 */
export function inspectorSourceKey(source: KiroSourceMeta): string {
  if (source.source === "web") {
    const normalizedUrl = normalizeSourceUrl(source.url);
    if (normalizedUrl) return `web:${normalizedUrl}`;
    return `web:${(source.domain ?? "").toLowerCase()}:${source.name.toLowerCase()}`;
  }
  if (source.source === "course-material") {
    return `course-material:${(source.courseName ?? "").toLowerCase()}:${source.name.toLowerCase()}`;
  }
  return `${source.source}:${source.name.toLowerCase()}`;
}

/** 归一 URL：去掉 hash 与末尾斜杠、小写 host、丢弃 tracking 之外的 query 保留（保守：保留 query 但排序稳定） */
export function normalizeSourceUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    parsed.hash = "";
    const search = parsed.search;
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname}${search}`;
  } catch {
    return null;
  }
}

/**
 * Sources 聚合：live Turn 优先 → 已绑定历史（新 → 旧）→ 更早；按语义 key 去重（首次出现保留）。
 */
export function aggregateInspectorSources(input: {
  currentTurnSources: KiroSourceMeta[];
  boundSources: KiroSourceMeta[][];
}): KiroSourceMeta[] {
  const seen = new Set<string>();
  const out: KiroSourceMeta[] = [];
  const push = (source: KiroSourceMeta) => {
    const key = inspectorSourceKey(source);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(source);
  };
  for (const source of input.currentTurnSources) push(source);
  for (const group of input.boundSources) {
    for (const source of group) push(source);
  }
  return out;
}

/** Sources 展示上限（超出 → 查看全部 disclosure） */
export const INSPECTOR_SOURCES_PREVIEW_LIMIT = 6;

/** Outputs 展示上限（Conversation Artifact） */
export const INSPECTOR_OUTPUTS_LIMIT = 8;
