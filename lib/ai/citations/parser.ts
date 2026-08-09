/**
 * Citation Protocol 解析 / 校验 / 文本化（Task 11）。
 * Marker 协议：[[source:doc-1:p12]] / [[source:doc-1:p12-p13]] / [[source:doc-2]]
 * 安全规则：
 * - 未闭合 marker（流式中）按普通文本处理，不 throw、不吞正文
 * - UI 显示前必须 resolveCitation 校验（sourceId 存在 + 页码在 availablePages 内）
 * - 无效引用不渲染 Citation pill（正文保留）
 */

import { KiroCitation, KiroSourceMeta } from "@/lib/ai/citations/types";

const MARKER_RE = /\[\[source:([A-Za-z0-9_-]+)(?::p(\d+)(?:-p(\d+))?)?\]\]/g;

/** 解析文本中的全部闭合 Citation marker（流式未闭合部分忽略） */
export function parseCitationMarkers(text: string): KiroCitation[] {
  const out: KiroCitation[] = [];
  if (!text) return out;
  MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER_RE.exec(text)) !== null) {
    const citation: KiroCitation = { sourceId: m[1] };
    if (m[2]) {
      const start = parseInt(m[2], 10);
      const end = m[3] ? parseInt(m[3], 10) : start;
      citation.pageStart = start;
      citation.pageEnd = Math.max(start, end);
    }
    out.push(citation);
  }
  return out;
}

export type CitationSegment =
  | { type: "text"; text: string }
  | { type: "citation"; citation: KiroCitation };

/**
 * 按 marker 把文本切成渲染段：
 * 闭合 marker → citation 段；其余（含未闭合 marker）→ 原样 text 段。
 * 未闭合 marker 必须按普通文本保留（流式安全：不删除正文、不报错）。
 */
export function splitCitationSegments(text: string): CitationSegment[] {
  const segments: CitationSegment[] = [];
  if (!text) return segments;
  let last = 0;
  MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER_RE.exec(text)) !== null) {
    const idx = m.index;
    if (idx > last) segments.push({ type: "text", text: text.slice(last, idx) });
    const citation: KiroCitation = { sourceId: m[1] };
    if (m[2]) {
      const start = parseInt(m[2], 10);
      const end = m[3] ? parseInt(m[3], 10) : start;
      citation.pageStart = start;
      citation.pageEnd = Math.max(start, end);
    }
    segments.push({ type: "citation", citation });
    last = idx + m[0].length;
  }
  if (last < text.length) segments.push({ type: "text", text: text.slice(last) });
  return segments;
}

/** 校验引用：sourceId 必须在本 Turn 注册；页码必须在该 source 实际提供的范围内 */
export function resolveCitation(citation: KiroCitation, sources: KiroSourceMeta[]): KiroSourceMeta | null {
  const source = sources.find((s) => s.sourceId === citation.sourceId);
  if (!source) return null;
  if (citation.pageStart !== undefined) {
    const pages = source.availablePages ?? [];
    for (let p = citation.pageStart; p <= (citation.pageEnd ?? citation.pageStart); p++) {
      if (!pages.includes(p)) return null;
    }
  }
  return source;
}

/** 页码范围 → 中文（第 12 页 / 第 12–13 页）；无页码 → 文件级 */
export function citationRangeText(citation: KiroCitation): string {
  if (citation.pageStart !== undefined) {
    if (citation.pageEnd !== undefined && citation.pageEnd > citation.pageStart) {
      return `第 ${citation.pageStart}–${citation.pageEnd} 页`;
    }
    return `第 ${citation.pageStart} 页`;
  }
  return "";
}

/** Citation pill 中文文案（来源真实存在时） */
export function citationLabel(source: KiroSourceMeta, citation: KiroCitation): string {
  const range = citationRangeText(citation);
  return range ? `${source.name} · ${range}` : source.name;
}

/** 无效引用的降级显示（不展示可信来源；正文保留） */
export const INVALID_CITATION_TEXT = "来源不可验证";

/**
 * 导出 / 复制用：marker → 可读文本（不暴露内部协议）。
 * 有 Source Registry：转成 [第三章讲义.pdf · 第 12 页]；
 * 无 registry（或无效）：直接移除 marker（避免暴露 doc-1 等内部 ID）。
 */
export function citationsToReadableText(content: string, sources?: KiroSourceMeta[]): string {
  if (!content) return content;
  if (!sources || sources.length === 0) {
    return content.replace(MARKER_RE, "");
  }
  return content.replace(MARKER_RE, (_full, sourceId: string, pStart?: string, pEnd?: string) => {
    const citation: KiroCitation = { sourceId };
    if (pStart) {
      const start = parseInt(pStart, 10);
      const end = pEnd ? parseInt(pEnd, 10) : start;
      citation.pageStart = start;
      citation.pageEnd = Math.max(start, end);
    }
    const source = resolveCitation(citation, sources);
    if (!source) return `[${INVALID_CITATION_TEXT}]`;
    return `[${citationLabel(source, citation)}]`;
  });
}
