/**
 * Deterministic lexical tokenization（V3 Part 1；不安装搜索依赖）。
 * Normalization: Unicode NFKC → lowercase Latin → whitespace/punctuation 归一。
 * Latin/数字：word tokens；连续 CJK 段：overlapping 2-gram + 3-gram（单字符段 fallback 自身）。
 */

const CJK_RANGE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;
const CJK_SEQ = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]+/g;
const WORD_TOKEN = /[a-z0-9]+/g;

/** NFKC + lowercase + 空白/标点归一（保留 CJK 连续段） */
export function normalizeKnowledgeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\s\u3000]+/g, " ")
    .trim();
}

function isCjkChar(ch: string): boolean {
  return CJK_RANGE.test(ch);
}

/** 从归一化文本生成 tokens（Latin/数字 word tokens + CJK 2/3-gram） */
export function tokenizeKnowledgeText(input: string): string[] {
  const text = normalizeKnowledgeText(input);
  const tokens: string[] = [];
  // CJK 连续段
  const cjkMatches = text.match(CJK_SEQ) ?? [];
  for (const seq of cjkMatches) {
    if (seq.length === 1) {
      tokens.push(seq);
      continue;
    }
    for (let i = 0; i < seq.length - 1; i++) {
      tokens.push(seq.slice(i, i + 2));
    }
    for (let i = 0; i < seq.length - 2; i++) {
      tokens.push(seq.slice(i, i + 3));
    }
  }
  // Latin / 数字 word tokens（跳过 CJK 段）
  const noCjk = text.replace(CJK_SEQ, " ");
  for (const m of noCjk.match(WORD_TOKEN) ?? []) {
    if (m.length > 0) tokens.push(m);
  }
  return tokens;
}

/** token → 计数（ranking 用） */
export function knowledgeTokenCounts(tokens: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of tokens) {
    counts[t] = (counts[t] ?? 0) + 1;
  }
  return counts;
}

/** 是否存在 CJK 字符（snippet/切分辅助） */
export function containsCjk(text: string): boolean {
  return CJK_RANGE.test(text);
}
