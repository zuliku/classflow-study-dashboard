"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeMathDelimiters } from "@/lib/ai/markdown";
import { KiroSourceMeta } from "@/lib/ai/citations/types";
import { KiroCitation } from "@/components/kiro/KiroCitation";
import { remarkKiroCitation } from "@/lib/ai/citations/remarkCitation";

/**
 * Kiro Markdown：Assistant Markdown → ClassFlow styled React（prose + math 单一入口）。
 * Pipeline：normalizeMathDelimiters → remark-gfm → remark-math → remarkKiroCitation → rehype-katex → components。
 * Citation（Hotfix）：[[source:...]] 由 remarkKiroCitation 在 mdast 内转成 inline node，
 * 整份 Markdown 只 parse 一次 —— 段落 / 列表 / 强调等父结构不再被 marker 拆散，
 * 「正文 [来源]。」保持同一 <p> / <li>（修复标点与列表独占一行 Bug）。
 * - KaTeX：throwOnError:false（非法/未完成公式退化为可读 source），trust:false（模型输入不可信）
 * - 不启用 rehype-raw：模型输出中的 HTML 按普通内容处理（无 script/iframe/style）
 * - 链接只允许 http/https/mailto；外链 target=_blank + noopener
 * - 全部样式集中在此，不散落到 KiroMessage
 *
 * mode="inline-fragment"（Streaming UX V4.3）：长单段的「安全 inline chunk」渲染。
 * 只允许 incremental inline scanner 已证明安全（isFragmentSafeChunk）的内容使用：
 * 只产出 inline 元素（strong / em / code / link / citation / inline math），
 * 不生成 p / h1 / list / table / blockquote / pre（block 级构造被压成文本节点）。
 * Outer container 负责 paragraph geometry（多个 fragment 拼接在同一个 <p> 内）。
 * 不是完整 document renderer——block 输入必须走默认 mode。
 */

/** 内联元素组件（block / inline-fragment 两种模式共享；sources 供 citation pill 查找） */
function makeKiroInlineComponents(sources?: KiroSourceMeta[]) {
  return {
    strong: ({ children }: { children?: React.ReactNode }) => (
      <strong className="font-semibold text-charcoal">{children}</strong>
    ),
    em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>,
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
      const safe = typeof href === "string" && /^(https?:|mailto:)/i.test(href);
      if (!safe) return <span className="text-satin-grey">{children}</span>;
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-charcoal underline underline-offset-4 decoration-[#CDB9AB] hover:text-black hover:decoration-line-strong"
        >
          {children}
        </a>
      );
    },
    code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
      const isBlock = /language-/.test(className ?? "") || String(children).includes("\n");
      if (isBlock) {
        return <code className="block font-mono text-[0.84em] leading-[1.65]">{children}</code>;
      }
      return (
        <code className="px-1.5 py-0.5 rounded-md bg-surface-muted font-mono text-[0.86em] text-charcoal break-words">
          {children}
        </code>
      );
    },
    // Hotfix：remarkKiroCitation 生成的 span（data-kiro-citation）→ KiroCitation pill；
    // 普通 span（KaTeX 等）必须原样传递（不把 node 传到 DOM）。
    span: (props: { node?: unknown; children?: React.ReactNode } & React.HTMLAttributes<HTMLSpanElement>) => {
      const { node: _node, children, ...rest } = props;
      const attrs = rest as unknown as Record<string, unknown>;
      const sourceId = attrs["data-kiro-source-id"];
      if (attrs["data-kiro-citation"] === "true" && typeof sourceId === "string") {
        const citation: {
          sourceId: string;
          pageStart?: number;
          pageEnd?: number;
        } = { sourceId };
        const pageStart = attrs["data-kiro-page-start"];
        const pageEnd = attrs["data-kiro-page-end"];
        if (typeof pageStart === "string" && pageStart) {
          citation.pageStart = parseInt(pageStart, 10);
          citation.pageEnd = typeof pageEnd === "string" && pageEnd ? parseInt(pageEnd, 10) : citation.pageStart;
        }
        return <KiroCitation citation={citation} sources={sources} />;
      }
      return <span {...rest}>{children}</span>;
    },
  };
}

/** 行内渲染的公共 remark/rehype 插件栈（类型保持 ReactMarkdown Options 形状） */
const kiroRemarkPlugins = [remarkGfm, remarkMath, remarkKiroCitation];
const kiroRehypePlugins: Parameters<typeof ReactMarkdown>[0]["rehypePlugins"] = [
  [rehypeKatex, { throwOnError: false, trust: false }],
];

export function KiroMarkdown({
  content,
  sources,
  mode = "block",
}: {
  content: string;
  sources?: KiroSourceMeta[];
  /** inline-fragment：仅限 scanner 证明安全的 inline chunk；block 级构造会被压成文本 */
  mode?: "block" | "inline-fragment";
}) {
  const inlineComponents = React.useMemo(() => makeKiroInlineComponents(sources), [sources]);
  if (mode === "inline-fragment") {
    return (
      <ReactMarkdown
        remarkPlugins={kiroRemarkPlugins}
        rehypePlugins={kiroRehypePlugins}
        components={{
          ...inlineComponents,
          p: ({ children }) => <>{children}</>,
          h1: ({ children }) => <span className="font-semibold text-charcoal">{children}</span>,
          h2: ({ children }) => <span className="font-semibold text-charcoal">{children}</span>,
          h3: ({ children }) => <span className="font-semibold text-charcoal">{children}</span>,
          h4: ({ children }) => <span className="font-semibold text-charcoal">{children}</span>,
          h5: ({ children }) => <span className="font-semibold text-charcoal">{children}</span>,
          h6: ({ children }) => <span className="font-semibold text-charcoal">{children}</span>,
          ul: ({ children }) => <>{children}</>,
          ol: ({ children }) => <>{children}</>,
          li: ({ children }) => <>{children}</>,
          blockquote: ({ children }) => <span className="text-satin-grey">{children}</span>,
          pre: ({ children }) => <>{children}</>,
          hr: () => null,
          table: ({ children }) => <>{children}</>,
          thead: ({ children }) => <>{children}</>,
          tbody: ({ children }) => <>{children}</>,
          tr: ({ children }) => <>{children}</>,
          th: ({ children }) => <>{children}</>,
          td: ({ children }) => <>{children}</>,
        }}
      >
        {normalizeMathDelimiters(content)}
      </ReactMarkdown>
    );
  }

  return (
    <div
      className="kiro-markdown text-charcoal"
      style={{ fontSize: "var(--kiro-output-font-size)", lineHeight: 1.74 }}
      data-testid="kiro-markdown"
    >
      <ReactMarkdown
        remarkPlugins={kiroRemarkPlugins}
        rehypePlugins={kiroRehypePlugins}
        components={{
          p: ({ children }) => <p className="mb-[0.8em] last:mb-0">{children}</p>,
          h1: ({ children }) => (
            <h1 className="text-[1.28em] leading-snug font-semibold text-charcoal mt-[1.6em] mb-[0.65em] first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-[1.14em] leading-snug font-semibold text-charcoal mt-[1.45em] mb-[0.55em] first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-[1.04em] leading-snug font-semibold text-charcoal mt-[1.25em] mb-[0.45em] first:mt-0">
              {children}
            </h3>
          ),
          ...inlineComponents,
          ul: ({ children }) => (
            <ul className="list-disc pl-5 my-[0.75em] space-y-[0.3em] marker:text-sandrift">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 my-[0.75em] space-y-[0.3em] marker:text-sandrift">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="leading-[1.7] [&_ul]:my-[0.55em] [&_ol]:my-[0.55em] [&_input[type='checkbox']]:mr-1.5 [&_input[type='checkbox']]:accent-charcoal">
              {children}
            </li>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-[0.8em] border-l-2 border-line-strong bg-alabaster/40 rounded-r-lg px-[0.9em] py-[0.65em] text-satin-grey [&_p]:mb-[0.5em] [&_p:last-child]:mb-0">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-[1em] border-line-soft" />,
          pre: ({ children }) => (
            <pre className="my-[0.85em] overflow-x-auto rounded-xl bg-alabaster border border-line px-4 py-3.5 text-charcoal">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-[0.85em] overflow-x-auto rounded-xl border border-line">
              <table className="w-full border-collapse text-left text-[0.88em] [&_tr:last-child>td]:border-b-0">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-alabaster/60 [&_th]:font-semibold">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2.5 border-b border-line-strong text-charcoal whitespace-nowrap">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2.5 border-b border-line-soft/60 text-satin-grey align-top">
              {children}
            </td>
          ),
        }}
      >
        {normalizeMathDelimiters(content)}
      </ReactMarkdown>
    </div>
  );
}
