"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeMathDelimiters } from "@/lib/ai/markdown";

/**
 * Kiro Markdown：Assistant Markdown → ClassFlow styled React（prose + math 单一入口）。
 * Pipeline：normalizeMathDelimiters → remark-gfm → remark-math → rehype-katex → semantic components。
 * - KaTeX：throwOnError:false（非法/未完成公式退化为可读 source），trust:false（模型输入不可信）
 * - 不启用 rehype-raw：模型输出中的 HTML 按普通内容处理（无 script/iframe/style）
 * - 链接只允许 http/https/mailto；外链 target=_blank + noopener
 * - 全部样式集中在此，不散落到 KiroMessage
 */
export function KiroMarkdown({ content }: { content: string }) {
  return (
    <div
      className="text-[14px] md:text-[15px] leading-[1.8] text-charcoal"
      data-testid="kiro-markdown"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, trust: false }]]}
        components={{
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
          h1: ({ children }) => (
            <h1 className="text-[19px] leading-snug font-semibold text-charcoal mt-6 mb-3 first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-[16px] leading-snug font-semibold text-charcoal mt-6 mb-2 first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-[15px] leading-snug font-semibold text-charcoal mt-5 mb-2 first:mt-0">
              {children}
            </h3>
          ),
          strong: ({ children }) => <strong className="font-semibold text-charcoal">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => (
            <ul className="list-disc pl-5 my-3 space-y-1.5 marker:text-sandrift">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 my-3 space-y-1.5 marker:text-sandrift">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="leading-[1.8] [&_ul]:my-2 [&_ol]:my-2 [&_input[type='checkbox']]:mr-1.5 [&_input[type='checkbox']]:accent-charcoal">
              {children}
            </li>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-line-strong bg-alabaster/40 rounded-r-lg px-4 py-2.5 text-satin-grey [&_p]:mb-1.5 [&_p:last-child]:mb-0">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-line-soft" />,
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
              return <code className="block font-mono text-[12.5px] leading-[1.7]">{children}</code>;
            }
            return (
              <code className="px-1.5 py-0.5 rounded-md bg-surface-muted font-mono text-[12.5px] text-charcoal break-words">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-3 overflow-x-auto rounded-xl bg-alabaster border border-line px-4 py-3.5 text-charcoal">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-xl border border-line">
              <table className="w-full border-collapse text-left text-[13px] [&_tr:last-child>td]:border-b-0">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-alabaster/60 [&_th]:font-semibold">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2.5 border-b border-line-strong text-charcoal whitespace-nowrap text-[12.5px]">
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
