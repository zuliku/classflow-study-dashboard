/**
 * Kiro Streaming Markdown Splitter（Worklog V2 Task 4 / Streaming UX V2 / V3 Phase 4）。
 *
 * 轻量 line scanner（不实现第二套完整 Markdown parser）：
 * - 空行 且 不在 code fence 且 不在 display math → stable boundary
 * - ``` 开启后：内部空行不 split；``` 闭合后：完整 code block 可稳定
 * - $$ display math：未闭合前不 split；闭合后：完整 math block 可稳定
 * - streaming=false：剩余全部内容升级成 stable
 *
 * tailState：Active Tail 的当前未闭合构造（供 KiroStreamingTail 选择
 * 与最终 Markdown 几何一致的 fallback 容器）：
 * - "fence"：尾部存在未闭合 ```（渲染为与稳定 code block 相同几何的 pre）
 * - "math" ：尾部存在未闭合 $$（渲染为与 katex-display 相近的块容器）
 * - "text" ：无未闭合块级构造（直接走同一套 Markdown pipeline 渲染）
 *
 * splitKiroInlineParagraph（Streaming UX V3 Phase 4）：
 * 超长单段（无空行）回答的「安全增量路径」——把段落切成有界的安全 chunk：
 * - 只在不破坏 inline 构造的位置切（** $ ` [link] [[citation]] 不跨 chunk）
 * - 不在 list / heading / quote 行内切（避免假段落 margin / 语义降级）
 * - CJK 任意字符可切（CJK 天然可任意换行）；Latin 只在词边界切
 * - chunk 与 tail 都走同一套 KiroMarkdown pipeline，streaming 与 settled 视觉语义一致
 * - React.memo 保证已稳定 chunk 不再重 parse；每 token 只有最后一个 chunk + tail 可变
 */

export type KiroMarkdownTailState = "text" | "fence" | "math";

export interface KiroMarkdownStreamSplit {
  stableBlocks: string[];
  tail: string;
  tailState: KiroMarkdownTailState;
}

/** 单段 tail 的可变窗口上界：超过后启用安全 chunking */
export const KIRO_INLINE_TAIL_MAX_CHARS = 2048;

export function splitKiroStreamingMarkdown(
  content: string,
  streaming: boolean
): KiroMarkdownStreamSplit {
  if (!streaming) {
    return { stableBlocks: content.length > 0 ? [content] : [], tail: "", tailState: "text" };
  }

  const lines = content.split("\n");
  const stableBlocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  let inDisplayMath = false;

  const flush = () => {
    if (current.length > 0) stableBlocks.push(current.join("\n"));
    current = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 状态切换必须先于边界判断（本行属于新状态）
    if (!inFence && trimmed.startsWith("```")) {
      inFence = true;
    } else if (inFence && trimmed.startsWith("```")) {
      inFence = false;
    } else if (!inFence && !inDisplayMath && trimmed.startsWith("$$")) {
      inDisplayMath = true;
    } else if (!inFence && inDisplayMath && trimmed.startsWith("$$")) {
      inDisplayMath = false;
    }

    if (line.length === 0 && !inFence && !inDisplayMath) {
      flush();
      continue;
    }
    current.push(line);
  }

  return {
    stableBlocks,
    tail: current.join("\n"),
    tailState: inFence ? "fence" : inDisplayMath ? "math" : "text",
  };
}

/** CJK / 全角字符：天然可任意换行，作为安全切点 */
const CJK_RE = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/;

/** block-level 行起始 marker（list / heading / quote）：这些行内不允许 chunk 边界 */
const BLOCK_LINE_RE = /^(#{1,6}(?:\s|$)|>(?:\s|$)|[-*+](?:\s|$)|(?:\d{1,3}\.)(?:\s|$))/;

/**
 * 轻量 inline 构造平衡扫描器（不是 Markdown parser）：
 * 返回 boolean[]：safe[i] = text[0..i) 可安全作为 chunk 边界（stack 为空且不违反行规则）。
 * 跟踪：** / *、`、$ / $$、[link](url)、[[citation]]、\ 转义。
 */
function inlineSafePositions(text: string): boolean[] {
  const n = text.length;
  const safe = new Array<boolean>(n + 1).fill(false);
  const stack: string[] = [];
  let i = 0;

  const markSafeAt = (boundary: number) => {
    if (stack.length > 0 || boundary <= 0 || boundary > n) return;
    const prev = text[boundary - 1];
    const cur = boundary < n ? text[boundary] : "";
    // 切点前后至少一边是 CJK / 全角，或前一个是空白（Latin 词边界；禁止单词中间断开）
    const charOk =
      CJK_RE.test(prev) || CJK_RE.test(cur) || /\s/.test(prev) || (boundary < n && /\s/.test(cur));
    if (!charOk) return;
    // 当前行不得是 block-level 行（list / heading / quote）：避免把列表/标题拦腰切断
    const lineStart = text.lastIndexOf("\n", boundary - 1) + 1;
    const lineHead = text.slice(lineStart, boundary).trimStart();
    if (BLOCK_LINE_RE.test(lineHead)) return;
    safe[boundary] = true;
  };

  while (i < n) {
    const ch = text[i];
    if (ch === "\\") {
      // 转义：跳过下一个字符（不进入构造栈）
      i += 2;
      markSafeAt(i);
      continue;
    }
    if (ch === "`") {
      let run = 0;
      while (i + run < n && text[i + run] === "`") run += 1;
      const token = run === 1 ? "`" : "``";
      if (stack[stack.length - 1] === token) stack.pop();
      else stack.push(token);
      i += run;
      markSafeAt(i);
      continue;
    }
    if (ch === "*") {
      let run = 0;
      while (i + run < n && text[i + run] === "*") run += 1;
      const token = run === 1 ? "*" : "**";
      if (stack[stack.length - 1] === token) stack.pop();
      else stack.push(token);
      i += run;
      markSafeAt(i);
      continue;
    }
    if (ch === "$") {
      let run = 0;
      while (i + run < n && text[i + run] === "$") run += 1;
      const token = run === 1 ? "$" : "$$";
      if (stack[stack.length - 1] === token) stack.pop();
      else stack.push(token);
      i += run;
      markSafeAt(i);
      continue;
    }
    if (ch === "[") {
      stack.push("[");
      i += 1;
      markSafeAt(i);
      continue;
    }
    if (ch === "]") {
      if (stack[stack.length - 1] === "[") stack.pop();
      i += 1;
      markSafeAt(i);
      continue;
    }
    if (ch === "(") {
      stack.push("(");
      i += 1;
      markSafeAt(i);
      continue;
    }
    if (ch === ")") {
      if (stack[stack.length - 1] === "(") stack.pop();
      i += 1;
      markSafeAt(i);
      continue;
    }
    i += 1;
    markSafeAt(i);
  }
  return safe;
}

/**
 * 安全增量切分：把「无空行的超长单段」切成有界 stable chunks + 有界 tail。
 * - 每个 chunk ≤ maxChars（构造跨窗口时最多延伸至构造闭合处）
 * - 不切断 ** $ ` [link] [[citation]]；不在 list/heading/quote 行内切
 * - chunks 从起点贪心确定 → 已稳定的 chunk 内容不变（React.memo 命中，不再重 parse）
 * - 返回值 chunks + tail 拼接 === 原文
 * - 病理情况（全文无安全切点，如永不闭合的巨型构造）→ 全部留在 tail（退化行为，可接受）
 */
export function splitKiroInlineParagraph(
  text: string,
  maxChars: number = KIRO_INLINE_TAIL_MAX_CHARS
): { chunks: string[]; tail: string } {
  if (text.length <= maxChars) return { chunks: [], tail: text };
  const safe = inlineSafePositions(text);
  const chunks: string[] = [];
  let start = 0;
  const n = text.length;
  while (n - start > maxChars) {
    const windowEnd = Math.min(start + maxChars, n);
    let end = -1;
    for (let i = windowEnd; i > start; i--) {
      if (safe[i]) {
        end = i;
        break;
      }
    }
    if (end < 0) {
      // 窗口内无安全切点：构造跨窗 → 向后找第一个安全切点（chunk 允许超过 maxChars）
      for (let i = windowEnd + 1; i <= n; i++) {
        if (safe[i]) {
          end = i;
          break;
        }
      }
      if (end < 0) break; // 病理：全文无安全切点 → 全部留在 tail
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return { chunks, tail: text.slice(start) };
}
