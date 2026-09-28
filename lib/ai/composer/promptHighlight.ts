/**
 * Kiro Composer 输入高亮（纯逻辑）：
 * - `/命令`：仅输入开头 `^/[^\s]*`（选中后 `/name …` 仍高亮命令段；菜单是否展开由 slashMenu 判定）。
 * - `@上下文`：任意位置 `@[^\s@]*`，但 `@` 前是 ASCII 词字符/另一个 @ 时视为邮箱/标识符，不高亮
 *  （与 mentionMenu.parseMentionQuery 的邮箱防护同规则；CJK 前无空格正常高亮）。
 * - 返回分段 concat 后恒等于原文（backdrop 镜像可逐段渲染，布局与 textarea 严格一致）。
 * - 背景 pill 只用 background + radius（无 padding/border），避免改变换行位置。
 */
export type ComposerTokenKind = "plain" | "slash" | "mention";

export interface ComposerToken {
  text: string;
  kind: ComposerTokenKind;
}

const SLASH_HEAD_RE = /^\/[^\s]*/;
const MENTION_RE = /@[^\s@]*/g;

function tokenizeMentions(segment: string): ComposerToken[] {
  if (!segment) return [];
  const tokens: ComposerToken[] = [];
  let last = 0;
  MENTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_RE.exec(segment)) !== null) {
    const atIndex = match.index;
    const prev = atIndex > 0 ? segment[atIndex - 1] : "";
    // 邮箱/标识符防护（与 parseMentionQuery 同规则）
    if (prev && /[\w@]/.test(prev)) continue;
    if (atIndex > last) tokens.push({ text: segment.slice(last, atIndex), kind: "plain" });
    tokens.push({ text: match[0], kind: "mention" });
    last = atIndex + match[0].length;
  }
  if (last < segment.length) tokens.push({ text: segment.slice(last), kind: "plain" });
  return tokens.length > 0 ? tokens : [{ text: segment, kind: "plain" }];
}

export function tokenizeComposerPrompt(text: string): ComposerToken[] {
  if (!text) return [];
  const slashMatch = SLASH_HEAD_RE.exec(text);
  if (slashMatch && text.startsWith("/")) {
    const head = slashMatch[0];
    const rest = text.slice(head.length);
    return [{ text: head, kind: "slash" }, ...tokenizeMentions(rest)];
  }
  return tokenizeMentions(text);
}
