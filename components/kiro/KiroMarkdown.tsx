"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeMathDelimiters } from "@/lib/ai/markdown";
import { KiroSourceMeta } from "@/lib/ai/citations/types";
import { splitCitationSegments } from "@/lib/ai/citations/parser";
import { KiroCitation } from "@/components/kiro/KiroCitation";

/**
 * Kiro Markdown：Assistant Markdown → ClassFlow styled React（prose + math 单一入口）。
 * Pipeline：normalizeMathDelimiters → remark-gfm → remark-math → rehype-katex → semantic components。
 * Citation（Task 11）：[[source:doc-1:p12]] 在进入 Markdown 前切成独立段，
 * 闭合 marker → KiroCitation pill；未闭合（流式中）→ 按普通文本保留（不报错、不吞正文）。
 * - KaTeX：throwOnError:false（非法/未完成公式退化为可读 source），trust:false（模型输入不可信）
 * - 不启用 rehype-raw：模型输出中的 HTML 按普通内容处理（无 script/iframe/style）
 * - 链接只允许 http/https/mailto；外链 target=_blank + noopener
 * - 全部样式集中在此，不散落到 KiroMessage
 */
export function KiroMarkdown({ content, sources }: { content: string; sources?: KiroSourceMeta[] }) {
  // Citation 分段：text 段各自走 Markdown 渲染；citation 段渲染 pill（流式未闭合 marker 留在 text 段）
  const segments = splitCitationSegments(content);
  const renderMarkdown = (text: string, key: number) => (
    <ReactMarkdown
      key={key}
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { throwOnError: false, trust: false }]]}
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
          strong: ({ children }) => <strong className="font-semibold text-charcoal">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
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
          a: ({ href, children }) => {
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
          code: ({ children, className }) => {
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
        {normalizeMathDelimiters(text)}
      </ReactMarkdown>
  );

  return (
    <div
      className="kiro-markdown text-charcoal"
      style={{ fontSize: "var(--kiro-output-font-size)", lineHeight: 1.74 }}
      data-testid="kiro-markdown"
    >
      {segments.map((seg, i) =>
        seg.type === "citation" ? (
          <KiroCitation key={i} citation={seg.citation} sources={sources} />
        ) : (
          renderMarkdown(seg.text, i)
        )
      )}
    </div>
  );
}
