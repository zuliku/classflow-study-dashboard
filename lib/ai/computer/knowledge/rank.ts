/**
 * Deterministic lexical ranking（V3 Part 1）。
 * metadataScore 与 contentScore 分离（Task 2 权限过滤需去掉正文 evidence）。
 * 固定常量分数，不使用 filesystem recency；每个加性分量设上限，防止单个 token 主导。
 */
import {
  KIRO_KNOWLEDGE_SNIPPET_MAX_CHARS,
  KiroKnowledgeChunkRecord,
  KiroKnowledgeFileRecord,
  KiroKnowledgeScoredCandidate,
  KiroKnowledgeSearchResult,
} from "@/lib/ai/computer/knowledge/types";
import { knowledgeTokenCounts, normalizeKnowledgeText, tokenizeKnowledgeText } from "@/lib/ai/computer/knowledge/tokenize";

const SCORE = {
  exactFilename: 100,
  filenameToken: 20,
  pathToken: 10,
  titleToken: 15,
  phrase: 50,
  contentToken: 6,
  termFrequency: 2,
} as const;

const CAP = {
  filenameToken: 40,
  pathToken: 30,
  titleToken: 30,
  phrase: 100,
  contentToken: 60,
  termFrequency: 20,
} as const;

export interface KnowledgeCandidate {
  file: KiroKnowledgeFileRecord;
  chunks: KiroKnowledgeChunkRecord[];
}

function matchReasonSet() {
  return new Set<"filename" | "path" | "title" | "phrase" | "content-token">();
}

/** 生成 ≤320 字符 snippet，围绕首个 phrase/token 命中居中 */
export function buildKnowledgeSnippet(chunks: KiroKnowledgeChunkRecord[], queryTokens: string[]): string {
  const full = chunks.map((c) => c.text).join("\n");
  if (!full) return "";
  let index = -1;
  const norm = normalizeKnowledgeText(full);
  for (const token of queryTokens) {
    const i = norm.indexOf(token);
    if (i !== -1) {
      index = i;
      break;
    }
  }
  if (index === -1) {
    return full.slice(0, KIRO_KNOWLEDGE_SNIPPET_MAX_CHARS);
  }
  const start = Math.max(0, index - Math.floor(KIRO_KNOWLEDGE_SNIPPET_MAX_CHARS / 2));
  return full.slice(start, start + KIRO_KNOWLEDGE_SNIPPET_MAX_CHARS);
}

/** 对单个 candidate 评分（分离 metadata/content evidence） */
export function scoreKnowledgeCandidate(
  candidate: KnowledgeCandidate,
  query: string,
  queryTokens: string[]
): KiroKnowledgeScoredCandidate {
  const reasons = matchReasonSet();
  let metadataScore = 0;
  let contentScore = 0;

  const fileName = candidate.file.relativePath.split("/").pop() ?? "";
  const normalizedQuery = normalizeKnowledgeText(query);
  const baseName = fileName.includes(".") ? fileName.slice(0, fileName.lastIndexOf(".")) : fileName;
  const normalizedFileName = normalizeKnowledgeText(fileName);
  const normalizedBaseName = normalizeKnowledgeText(baseName);
  const normalizedPath = normalizeKnowledgeText(candidate.file.relativePath);

  // metadata evidence
  if (normalizedBaseName === normalizedQuery || normalizedFileName === normalizedQuery) {
    metadataScore += SCORE.exactFilename;
    reasons.add("filename");
  }
  const nameTokens = tokenizeKnowledgeText(fileName);
  for (const t of queryTokens) {
    if (nameTokens.includes(t)) {
      metadataScore += Math.min(SCORE.filenameToken, CAP.filenameToken);
      reasons.add("filename");
      break;
    }
  }
  const pathTokens = tokenizeKnowledgeText(candidate.file.relativePath);
  for (const t of queryTokens) {
    if (pathTokens.includes(t)) {
      metadataScore += Math.min(SCORE.pathToken, CAP.pathToken);
      reasons.add("path");
      break;
    }
  }
  if (candidate.file.title) {
    const titleTokens = tokenizeKnowledgeText(candidate.file.title);
    for (const t of queryTokens) {
      if (titleTokens.includes(t)) {
        metadataScore += Math.min(SCORE.titleToken, CAP.titleToken);
        reasons.add("title");
        break;
      }
    }
  }

  // content evidence（正文 chunks）
  if (candidate.chunks.length > 0) {
    const contentTokens: Record<string, number> = {};
    for (const chunk of candidate.chunks) {
      for (const [token, count] of Object.entries(chunk.tokenCounts)) {
        contentTokens[token] = (contentTokens[token] ?? 0) + count;
      }
    }
    const normQuery = normalizeKnowledgeText(query);
    for (const chunk of candidate.chunks) {
      if (normalizeKnowledgeText(chunk.text).includes(normQuery)) {
        contentScore += Math.min(SCORE.phrase, CAP.phrase);
        reasons.add("phrase");
        break;
      }
    }
    for (const t of queryTokens) {
      const count = contentTokens[t] ?? 0;
      if (count > 0) {
        contentScore += Math.min(SCORE.contentToken * count, CAP.contentToken);
        reasons.add("content-token");
      }
    }
  }

  const score = metadataScore + contentScore;
  const result: KiroKnowledgeSearchResult = {
    rootId: candidate.file.rootId,
    path: candidate.file.relativePath,
    title: candidate.file.title,
    type: candidate.file.type,
    snippet: undefined,
    score,
    matchReasons: Array.from(reasons),
  };
  return { result, metadataScore, contentScore };
}

/** 确定性排序：score DESC → path ASC（tie-break） */
export function rankKnowledgeCandidates(
  candidates: KnowledgeCandidate[],
  query: string
): KiroKnowledgeScoredCandidate[] {
  const tokens = Array.from(new Set(tokenizeKnowledgeText(query)));
  const scored = candidates.map((c) => scoreKnowledgeCandidate(c, query, tokens));
  scored.sort((a, b) => {
    if (b.result.score !== a.result.score) return b.result.score - a.result.score;
    return a.result.path.localeCompare(b.result.path);
  });
  return scored;
}

/** 为已排序候选附加 snippet（由调用方基于候选 chunks 生成；仅在当前 fs.read=allow 时使用） */
export function buildCandidateSnippet(chunks: KiroKnowledgeChunkRecord[], query: string): string {
  const tokens = Array.from(new Set(tokenizeKnowledgeText(query)));
  return buildKnowledgeSnippet(chunks, tokens);
}

export { knowledgeTokenCounts };
