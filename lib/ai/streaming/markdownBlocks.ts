/**
 * Kiro Streaming Markdown Splitter（Worklog V2 Task 4 / Streaming UX V2）。
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
 * 调用方：KiroStreamingMarkdown 按 block 稳定渲染（React.memo），
 * 只有 Active Tail 每 token 变化，避免长回答逐 chunk 重跑 Markdown pipeline。
 */

export type KiroMarkdownTailState = "text" | "fence" | "math";

export interface KiroMarkdownStreamSplit {
  stableBlocks: string[];
  tail: string;
  tailState: KiroMarkdownTailState;
}

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
