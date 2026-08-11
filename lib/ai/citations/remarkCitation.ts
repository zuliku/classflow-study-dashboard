/**
 * Kiro Citation Remark Plugin（Citation Layout Hotfix）。
 *
 * 职责：Markdown 已解析成 mdast 后，只扫描 text node 中的 [[source:...]] marker，
 * 转换成 inline citation node。不修改 paragraph / list / heading / strong 等父结构
 * —— 整份 Markdown 只 parse 一次，标点与列表结构不再被拆分破坏。
 *
 * - 复用 splitCitationSegments（唯一 marker regex 权威，无第二套实现）
 * - 只处理 type === "text" 的节点；inlineCode / code 等携带 node.value 的节点不深入
 * - 不判断 source 是否真实存在（KiroCitation → resolveCitation 仍是最终可信边界）
 * - 不启用 rehype-raw；HTML 不作为渲染路径
 */
import { splitCitationSegments } from "@/lib/ai/citations/parser";
import { KiroCitation } from "@/lib/ai/citations/types";

/** 结构最小化 mdast 描述（不引入额外 unist/mdast 依赖） */
interface MdastNodeLike {
  type: string;
  value?: string;
  children?: MdastNodeLike[];
  data?: Record<string, unknown>;
}

/** Citation marker 快速预检（避免对每个 text node 都跑完整 split） */
const HAS_CITATION_MARKER = /\[\[source:/;

/** marker → inline kiroCitation node（data.hName → hast span + data 属性，由 ReactMarkdown components 消费） */
export function createKiroCitationNode(citation: KiroCitation): MdastNodeLike {
  const hProperties: Record<string, string> = {
    "data-kiro-citation": "true",
    "data-kiro-source-id": citation.sourceId,
  };
  if (citation.pageStart !== undefined) {
    hProperties["data-kiro-page-start"] = String(citation.pageStart);
  }
  if (citation.pageEnd !== undefined) {
    hProperties["data-kiro-page-end"] = String(citation.pageEnd);
  }
  return {
    type: "kiroCitation",
    data: {
      hName: "span",
      hProperties,
    },
  };
}

function walkChildren(nodes: MdastNodeLike[]): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.type === "text" && typeof node.value === "string") {
      if (!HAS_CITATION_MARKER.test(node.value)) continue;
      // 只在这里把 text 拆成 text + kiroCitation 序列（保持父结构不变）
      const segments = splitCitationSegments(node.value);
      const hasCitation = segments.some((s) => s.type === "citation");
      if (!hasCitation) continue;
      const replacement: MdastNodeLike[] = segments.map((seg) =>
        seg.type === "citation"
          ? createKiroCitationNode(seg.citation)
          : { type: "text", value: seg.text }
      );
      nodes.splice(i, 1, ...replacement);
      i += replacement.length - 1;
      continue;
    }
    if (node.children) walkChildren(node.children);
  }
}

/** remark plugin：与 remarkGfm / remarkMath 并列使用 */
export function remarkKiroCitation() {
  return (tree: MdastNodeLike) => {
    if (tree?.children) walkChildren(tree.children);
  };
}
