/**
 * Token 保守估算（V1）：不依赖精确 tokenizer（DeepSeek / OpenCode Go / Custom 不共享 tokenizer）。
 * CJK ≈ 1 token/字，英文/符号 ≈ 3 字符/token，加 safety overhead。
 * 目标不是计费精度，而是「不让 Context 无限制增长」。
 */

export function estimateTokens(value: string): number {
  if (!value) return 0;
  let cjk = 0;
  let other = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code > 0x2e7f) cjk++;
    else other++;
  }
  return Math.ceil(cjk * 1.05 + other / 3 + 8);
}

/** 保守的字符预算换算（混合中英内容） */
export function budgetCharsForTokens(tokens: number): number {
  return Math.floor(tokens * 2.5);
}
