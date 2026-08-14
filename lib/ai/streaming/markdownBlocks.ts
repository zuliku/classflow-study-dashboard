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

/**
 * 流式窗口目标上限（V4.2 Phase 9）：streaming 期间 tail 超过该值且存在安全切点时，
 * 每帧至多把一个「稳定前缀」切为 chunk（React.memo 命中 → 不再逐 token 重 parse），
 * tail 渐进收敛到 ≈ 该值。未闭合构造（无安全切点）允许 tail 暂时扩大。
 * 效果：每次 token 的 ReactMarkdown/KaTeX parse 成本与「新增内容」相关，
 * 而不是与「整个可变 tail」相关（Long Task 减少）。
 */
export const KIRO_INLINE_STREAM_WINDOW = 256;

import { bumpStreamPerf, addStreamPerfChars } from "@/lib/ai/perf/streamPerf";

export function splitKiroStreamingMarkdown(
  content: string,
  streaming: boolean
): KiroMarkdownStreamSplit {
  bumpStreamPerf("splitterCalls");
  addStreamPerfChars("splitterChars", content.length);
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
  bumpStreamPerf("inlineSplitterCalls");
  addStreamPerfChars("inlineSplitterChars", text.length);
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

// ============================================================
// Streaming UX V4.2：Incremental Markdown Scan State
// （Phase 4：block scanner 增量；Phase 5：长单段 inline 增量窗口）
//
// 规则：
// - append-only streaming（nextContent.startsWith(prev.prefix)）→ 只扫描新增 suffix；
//   stable prefix 永不重扫（block：stableBlocks 不再重建；inline：safe 数组增量扩展）
// - retry / regenerate / edit / history restore / 非 append-only → deterministic full reset
// - 幂等：nextContent.length === prev.sourceLength 时返回 prev（React StrictMode 安全）
// - 输出拼接 === source（stableBlocks.join("\n\n") + tail 语义与原 split 完全一致）
// ============================================================

export interface KiroMarkdownScanState {
  /** 已消费的 source 前缀（startsWith 比较用） */
  prefix: string;
  /** 已稳定 block（与原 split 同语义：不含空行分隔符） */
  stableBlocks: string[];
  /** 当前未稳定 tail（可能含 fence/math 内空行） */
  tail: string;
  /** tail 中「最后一行」之前的部分（含行分隔 \n；增量拼接起点，避免 O(tail) 重扫） */
  tailPrefix: string;
  /** tail 的最后一行（不含 \n；增量扫描起点） */
  tailLastLine: string;
  inFence: boolean;
  inDisplayMath: boolean;
}

/** 全量建立（首轮 / reset 共用；保持原 splitKiroStreamingMarkdown 语义） */
export function createKiroMarkdownScanState(content: string): KiroMarkdownScanState {
  const split = splitKiroStreamingMarkdown(content, true);
  const tailLastLine = split.tail.slice(split.tail.lastIndexOf("\n") + 1);
  const tailPrefix = split.tail
    .slice(0, split.tail.length - tailLastLine.length)
    .replace(/\n$/, "");
  return {
    prefix: content,
    stableBlocks: split.stableBlocks,
    tail: split.tail,
    tailPrefix,
    tailLastLine,
    inFence: split.tailState === "fence",
    inDisplayMath: split.tailState === "math",
  };
}

/**
 * 增量推进（append-only 时只扫描新增 suffix；否则 full reset）。
 * 每次调用成本 = O(新增 suffix + 新完整行数)；stable prefix 永不重扫。
 */
export function advanceKiroMarkdownScan(
  prev: KiroMarkdownScanState,
  nextContent: string
): KiroMarkdownScanState {
  if (nextContent.length < prev.prefix.length || !nextContent.startsWith(prev.prefix)) {
    return createKiroMarkdownScanState(nextContent);
  }
  if (nextContent.length === prev.prefix.length) return prev;
  bumpStreamPerf("splitterCalls");
  addStreamPerfChars("splitterChars", nextContent.length - prev.prefix.length);

  const suffix = nextContent.slice(prev.prefix.length);
  const working = prev.tailLastLine + suffix;
  const lastNl = working.lastIndexOf("\n");
  if (lastNl < 0) {
    // 仍无完整行：纯 append 到 tail（tailPrefix 不变）
    return {
      ...prev,
      prefix: nextContent,
      tail: prev.tail + suffix,
      tailLastLine: working,
    };
  }

  const lines = working.slice(0, lastNl).split("\n");
  const incomplete = working.slice(lastNl + 1);
  // acc 起始 = prev 的 tail 前缀（未 flush 的完整行们）；flush 时清空——与原 split 的
  // current 累积语义一致（prev.tailPrefix 不含最后一行，最后一行在 working 里）
  let acc = prev.tailPrefix;
  let inFence = prev.inFence;
  let inDisplayMath = prev.inDisplayMath;
  const newStable: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // 状态切换必须先于边界判断（本行属于新状态）——与原 split 一致
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
      if (acc.length > 0) {
        newStable.push(acc);
        acc = "";
      }
      continue;
    }
    acc = acc.length === 0 ? line : `${acc}\n${line}`;
  }

  let tail: string;
  let tailPrefix: string;
  let tailLastLine: string;
  if (incomplete === "") {
    // working 以 \n 结尾 = 尾部空行：fence/math 内按空行累积（acc 补尾 \n），否则 flush
    if (!inFence && !inDisplayMath) {
      if (acc.length > 0) {
        newStable.push(acc);
        acc = "";
      }
    } else if (acc.length > 0) {
      acc += "\n";
    }
    tail = acc;
    tailPrefix = acc.replace(/\n$/, "");
    tailLastLine = "";
  } else {
    tail = acc.length === 0 ? incomplete : `${acc}\n${incomplete}`;
    tailPrefix = acc;
    tailLastLine = incomplete;
  }
  return {
    prefix: nextContent,
    stableBlocks: [...prev.stableBlocks, ...newStable],
    tail,
    tailPrefix,
    tailLastLine,
    inFence,
    inDisplayMath,
  };
}

export interface KiroInlineScanState {
  /** 已消费的 source 前缀 */
  prefix: string;
  /** 已稳定 chunk */
  chunks: string[];
  /** 当前窗口起点（= 最后一个 chunk 的末尾） */
  start: number;
  /** 当前 tail（= source.slice(start)） */
  tail: string;
  /** 扫描到 prefix.length 处的未闭合 inline 构造栈 */
  stack: string[];
  /** safe[i] = text[0..i) 可安全切分（数组已算到 prefix.length） */
  safe: boolean[];
  /** 扫描到 prefix.length 处的当前行首位置（避免每次切点 O(n) lastIndexOf） */
  lineStart: number;
  maxChars: number;
}

/** 全量建立 inline 增量状态（首轮 / reset） */
export function createKiroInlineScanState(
  text: string,
  maxChars: number = KIRO_INLINE_TAIL_MAX_CHARS
): KiroInlineScanState {
  bumpStreamPerf("inlineSplitterCalls");
  addStreamPerfChars("inlineSplitterChars", text.length);
  const safe = inlineSafePositions(text);
  const { chunks, tail } = cutChunks(text, safe, maxChars);
  return {
    prefix: text,
    chunks,
    start: text.length - tail.length,
    tail,
    stack: [],
    safe,
    lineStart: text.lastIndexOf("\n") + 1,
    maxChars,
  };
}

/** 从起点贪心切 chunk（与 splitKiroInlineParagraph 同规则；start 通常 > 0） */
function cutChunks(text: string, safe: boolean[], maxChars: number): { chunks: string[]; tail: string } {
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
      for (let i = windowEnd + 1; i <= n; i++) {
        if (safe[i]) {
          end = i;
          break;
        }
      }
      if (end < 0) break;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return { chunks, tail: text.slice(start) };
}

/** 从 prev 的栈状态继续扩展 safe 数组到 nextText（只扫新增 suffix；stable 前缀不重扫） */
function extendInlineSafe(
  prev: KiroInlineScanState,
  nextText: string
): { safe: boolean[]; stack: string[]; lineStart: number } {
  const start = prev.prefix.length;
  const n = nextText.length;
  const safe = prev.safe.slice(); // 前段已计算（复制保证不可变；增量段在末尾追加）
  const stack = [...prev.stack];
  let lineStart = prev.lineStart;
  let i = start;
  const markSafeAt = (boundary: number) => {
    if (stack.length > 0 || boundary <= 0 || boundary > n) return;
    const prevCh = nextText[boundary - 1];
    const cur = boundary < n ? nextText[boundary] : "";
    const charOk =
      CJK_RE.test(prevCh) || CJK_RE.test(cur) || /\s/.test(prevCh) || (boundary < n && /\s/.test(cur));
    if (!charOk) return;
    const lineHead = nextText.slice(lineStart, boundary).trimStart();
    if (BLOCK_LINE_RE.test(lineHead)) return;
    safe[boundary] = true;
  };
  while (i < n) {
    const ch = nextText[i];
    if (ch === "\n") {
      lineStart = i + 1;
      i += 1;
      markSafeAt(i);
      continue;
    }
    if (ch === "\\") {
      i += 2;
      markSafeAt(i);
      continue;
    }
    if (ch === "`") {
      let run = 0;
      while (i + run < n && nextText[i + run] === "`") run += 1;
      const token = run === 1 ? "`" : "``";
      if (stack[stack.length - 1] === token) stack.pop();
      else stack.push(token);
      i += run;
      markSafeAt(i);
      continue;
    }
    if (ch === "*") {
      let run = 0;
      while (i + run < n && nextText[i + run] === "*") run += 1;
      const token = run === 1 ? "*" : "**";
      if (stack[stack.length - 1] === token) stack.pop();
      else stack.push(token);
      i += run;
      markSafeAt(i);
      continue;
    }
    if (ch === "$") {
      let run = 0;
      while (i + run < n && nextText[i + run] === "$") run += 1;
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
  return { safe, stack, lineStart };
}

/**
 * 增量推进长单段 inline 窗口（Phase 5 + Phase 9）：
 * - append-only → 只扩展 safe 数组到新增 suffix；再对「窗口起点之后」贪心切 chunk
 * - 已 stable chunk 内容不变（React.memo 命中）；可变区域渐进收敛（每帧 ≤1 个窗口 chunk）
 * - 非 append-only / 缩短 → deterministic full reset
 * - 幂等：text.length === prev.prefix.length 时返回 prev
 */
export function advanceKiroInlineScan(
  prev: KiroInlineScanState,
  text: string
): KiroInlineScanState {
  if (text.length < prev.prefix.length || !text.startsWith(prev.prefix)) {
    return createKiroInlineScanState(text, prev.maxChars);
  }
  if (text.length === prev.prefix.length) return prev;
  bumpStreamPerf("inlineSplitterCalls");
  addStreamPerfChars("inlineSplitterChars", text.length - prev.prefix.length);

  const { safe, stack, lineStart } = extendInlineSafe(prev, text);
  const { chunks: newChunks, tail } = cutChunksFrom(text, safe, prev.start, prev.maxChars);
  // Phase 9：流式窗口收敛——每帧至多切出一个窗口 chunk（渐进缩小可变 tail）
  const windowCut = cutStreamWindow(text, safe, text.length - tail.length, KIRO_INLINE_STREAM_WINDOW);
  const finalTail = windowCut.tail;
  return {
    prefix: text,
    chunks: [...prev.chunks, ...newChunks, ...windowCut.chunks],
    start: text.length - finalTail.length,
    tail: finalTail,
    stack,
    safe,
    lineStart,
    maxChars: prev.maxChars,
  };
}

/**
 * 流式窗口收敛：tail > windowChars 且前 windowChars 内存在安全切点（且最小进步
 * ≥ 32 chars）时，切出一个 chunk（内容永久稳定，memo 命中）。每帧最多一个，
 * 避免一次性插入大量 chunk 的渲染集中。未闭合构造（无安全切点）→ 不切（允许
 * tail 暂时扩大，构造闭合后自动收敛）。
 */
function cutStreamWindow(
  text: string,
  safe: boolean[],
  start: number,
  windowChars: number
): { chunks: string[]; tail: string } {
  const n = text.length;
  if (n - start <= windowChars) return { chunks: [], tail: text.slice(start) };
  const probeEnd = Math.min(start + windowChars, n);
  let end = -1;
  for (let i = probeEnd; i > start + 32; i--) {
    if (safe[i]) {
      end = i;
      break;
    }
  }
  if (end < 0) return { chunks: [], tail: text.slice(start) };
  return { chunks: [text.slice(start, end)], tail: text.slice(end) };
}

/** 从指定 start 起贪心切（start 之前已有 chunk；规则与全量一致） */
function cutChunksFrom(
  text: string,
  safe: boolean[],
  start: number,
  maxChars: number
): { chunks: string[]; tail: string } {
  const chunks: string[] = [];
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
      for (let i = windowEnd + 1; i <= n; i++) {
        if (safe[i]) {
          end = i;
          break;
        }
      }
      if (end < 0) break;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return { chunks, tail: text.slice(start) };
}
