/**
 * V3 Part 2 — Live Text Excerpt（Grounded Workspace Retrieval）。
 * 职责：live text + query → 有界相关 excerpt。
 * 知识 snippet 绝不直接作为最终正文；excerpt 必须来自当前 live read 的文本。
 * 复用 tokenizeKnowledgeText / normalizeKnowledgeText（不建第二套 search）。
 */
import {
  KIRO_KNOWLEDGE_SNIPPET_MAX_CHARS,
  KiroKnowledgeContentType,
} from "@/lib/ai/computer/knowledge/types";
import { normalizeKnowledgeText, tokenizeKnowledgeText } from "@/lib/ai/computer/knowledge/tokenize";

export const RETRIEVE_EXCERPT_MAX_CHARS = 1_600;
export const RETRIEVE_EXCERPT_PADDING = 160;

export interface LiveExcerptResult {
  excerpt: string;
  truncated: boolean;
}

/** 在 live text 中定位 query 最相关区域并返回有界 excerpt（围绕首个命中居中；无命中则取前部） */
export function buildLiveExcerpt(text: string, query: string): LiveExcerptResult {
  const trimmed = text.trim();
  if (!trimmed) return { excerpt: "", truncated: false };
  const normalized = normalizeKnowledgeText(trimmed);
  const tokens = Array.from(new Set(tokenizeKnowledgeText(query)));

  let index = -1;
  const normQuery = normalizeKnowledgeText(query);
  if (normQuery) {
    index = normalized.indexOf(normQuery);
  }
  if (index === -1) {
    for (const token of tokens) {
      if (!token) continue;
      const i = normalized.indexOf(token);
      if (i !== -1) {
        index = i;
        break;
      }
    }
  }

  const truncated = trimmed.length > KIRO_KNOWLEDGE_SNIPPET_MAX_CHARS;
  if (index === -1) {
    return { excerpt: trimmed.slice(0, RETRIEVE_EXCERPT_MAX_CHARS), truncated };
  }
  const start = Math.max(0, index - RETRIEVE_EXCERPT_PADDING);
  return {
    excerpt: trimmed.slice(start, start + RETRIEVE_EXCERPT_MAX_CHARS),
    truncated,
  };
}

export function retrievalContentType(extension: string): KiroKnowledgeContentType | null {
  if (extension === "docx") return "docx";
  return "text";
}
