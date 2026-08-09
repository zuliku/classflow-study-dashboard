/**
 * Kiro Markdown 数学分隔符归一化（轻量、保守，纯函数）。
 *
 * remark-math 原生已支持：$...$（行内）、独占行的 $$...$$（display）、
 * \(...\)（行内）、独占行的 \[...\]（display）、```math 围栏。
 *
 * 这里只补充模型常见但 remark-math 默认不解析的三种形态：
 *  1. 段落中同一行的 $$...$$（默认按普通文本处理）→ 提升为独立 display block
 *  2. 同一行的 \[...\]（flow 语法要求独占行）→ 提升为独立 display block
 *  3. 跨行的 \(...\) / \[...\]（行内 math 不能跨行）→ 折叠为独立 display block
 *
 * 安全边界：
 *  - fenced code block（``` / ~~~）内部一律原样跳过
 *  - 行内 code（奇数个未转义反引号内）不转换
 *  - 转义（\$、\( 等）不转换
 *  - 未闭合的 delimiter（流式中）原样保留，绝不丢内容
 *  - 不匹配任何规则的行原样输出
 *
 * 不用做真正的 Markdown 解析：ReactMarkdown 负责解析，这里只做确定性换算。
 */

/** 字符前是否有奇数个反斜杠（即被转义） */
function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) slashes++;
  return slashes % 2 === 1;
}

/** 在 from 之后找第一个未转义的 target */
function findUnescaped(text: string, target: string, from = 0): number {
  let idx = text.indexOf(target, from);
  while (idx !== -1) {
    if (!isEscaped(text, idx)) return idx;
    idx = text.indexOf(target, idx + 1);
  }
  return -1;
}

/** 位置 pos 之前未转义反引号的数量（奇数 → 处于行内 code 中） */
function backticksBefore(line: string, pos: number): number {
  let n = 0;
  for (let i = 0; i < pos; i++) if (line[i] === "`" && !isEscaped(line, i)) n++;
  return n;
}

/** 找行内 code 区间外的第一个 $$ 对（返回首个 $ 的位置，调用方以闭区间外切片），找不到返回 -1 */
function findInlineDoubleDollarClose(line: string, from: number): number {
  for (let i = from; i < line.length; i++) {
    if (line[i] !== "$" || isEscaped(line, i)) continue;
    if (backticksBefore(line, i) % 2 === 1) continue;
    if (i + 1 < line.length && line[i + 1] === "$") return i;
  }
  return -1;
}

/** 行内出现的第一个未转义 delimiter：$$ / \( / \[（跳过行内 code） */
function findFirstDelimiter(line: string): { index: number; type: "$$" | "\\(" | "\\[" } | null {
  let best: { index: number; type: "$$" | "\\(" | "\\[" } | null = null;
  for (let i = 0; i < line.length; i++) {
    if (backticksBefore(line, i) % 2 === 1) continue;
    const ch = line[i];
    if (ch === "\\" && !isEscaped(line, i) && (line[i + 1] === "(" || line[i + 1] === "[")) {
      const type = line[i + 1] === "(" ? "\\(" : "\\[";
      if (!best || i < best.index) best = { index: i, type };
      i += 1;
      continue;
    }
    if (ch === "$" && !isEscaped(line, i)) {
      if (!best || i < best.index) best = { index: i, type: "$$" };
    }
  }
  return best;
}

export function normalizeMathDelimiters(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inFence = false;
  let pending: { open: "\\(" | "\\["; openIndex: number; close: string; lines: string[] } | null = null;
  let prefix = "";

  const flushPending = () => {
    if (!pending) return;
    if (prefix.trim()) out.push(prefix);
    out.push(...pending.lines);
    pending = null;
    prefix = "";
  };

  for (const line of lines) {
    // fenced code block：原样跳过（含 ```math / ~~~）
    if (!inFence) {
      if (/^\s*(`{3,}|~{3,})/.test(line)) {
        inFence = true;
        out.push(line);
        continue;
      }
    } else {
      if (/(`{3,}|~{3,})/.test(line)) inFence = false;
      out.push(line);
      continue;
    }

    // 跨行 \( / \[ 未闭合：缓冲直到闭合
    if (pending) {
      const closeTok = pending.close;
      const closeIdx = findUnescaped(line, closeTok);
      if (closeIdx !== -1) {
        const firstLine = pending.lines[0];
        const openContent = firstLine.slice(pending.openIndex + 2);
        const body = [openContent, ...pending.lines.slice(1), line.slice(0, closeIdx)].join("\n").trim();
        out.push(prefix, "", "$$", body, "$$");
        pending = null;
        prefix = "";
        const tail = line.slice(closeIdx + closeTok.length);
        if (tail.trim()) out.push("", tail);
        continue;
      }
      pending.lines.push(line);
      continue;
    }

    const first = findFirstDelimiter(line);
    if (!first) {
      out.push(line);
      continue;
    }

    if (first.type === "\\(" || first.type === "\\[") {
      const closeTok = first.type === "\\(" ? "\\)" : "\\]";
      const closeIdx = findUnescaped(line, closeTok, first.index + 2);
      if (closeIdx !== -1) {
        const body = line.slice(first.index + 2, closeIdx).trim();
        if (body) {
          if (first.type === "\\[") {
            // 同一行的 \[...\]：remark-math 不解析 → 提升为 display
            out.push(line.slice(0, first.index), "", "$$", body, "$$");
            const tail = line.slice(closeIdx + 2);
            if (tail.trim()) out.push("", tail);
            continue;
          }
          // 同一行的 \(...\)：remark-math 原生不支持 → 转成 $...$ 行内公式
          out.push(line.slice(0, first.index) + "$" + body + "$" + line.slice(closeIdx + 2));
          continue;
        }
        out.push(line);
        continue;
      }
      // 无闭合 → 跨行 pending（流式中未闭合时按原样输出，见 flushPending）
      prefix = line.slice(0, first.index);
      pending = { open: first.type, openIndex: first.index, close: closeTok, lines: [line] };
      continue;
    }

    // $$ 处理
    const closeIdx = findInlineDoubleDollarClose(line, first.index + 2);
    if (closeIdx === -1) {
      // 未闭合（流式中）：原样保留
      out.push(line);
      continue;
    }
    const body = line.slice(first.index + 2, closeIdx).trim();
    if (!body) {
      out.push(line);
      continue;
    }
    const before = line.slice(0, first.index);
    const after = line.slice(closeIdx + 1);
    if (!before.trim() && !after.trim()) {
      // 独占整行：remark-math 原生 display math，不动
      out.push(line);
      continue;
    }
    // 段落内联 $$...$$ → 独立 display block（after 跳过闭合的 $$ 对）
    out.push(before, "", "$$", body, "$$");
    if (after.trim()) out.push("", after);
  }

  flushPending();
  return out.join("\n");
}
