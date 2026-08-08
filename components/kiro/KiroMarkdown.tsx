"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Kiro Markdown：Assistant Markdown → ClassFlow styled React。
 * - remark-gfm：表格 / 任务列表 / 删除线
 * - 不启用 rehype-raw：模型输出中的 HTML 按普通内容处理（无 script/iframe/style）
 * - 链接只允许 http/https/mailto；外链 target=_blank + noopener
 * - 全部样式集中在此，不散落到 KiroMessage
 */
export function KiroMarkdown({ content }: { content: string }) {
  return (
    <div className="text-[13px] leading-[1.7] text-charcoal" data-testid="kiro-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          h1: ({ children }) => (
            <h1 className="text-base font-semibold text-charcoal mt-4 mb-2 first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-sm font-semibold text-charcoal mt-4 mb-1.5 first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-[13px] font-semibold text-charcoal mt-3 mb-1.5 first:mt-0">{children}</h3>
          ),
          strong: ({ children }) => <strong className="font-semibold text-charcoal">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="leading-[1.7]">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-line-strong bg-alabaster/50 rounded-r-lg px-3 py-1.5 my-2 text-satin-grey">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-line-soft" />,
          a: ({ href, children }) => {
            const safe = typeof href === "string" && /^(https?:|mailto:)/i.test(href);
            if (!safe) return <span className="text-satin-grey">{children}</span>;
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-charcoal underline underline-offset-2 decoration-line-strong hover:text-black"
              >
                {children}
              </a>
            );
          },
          code: ({ children, className }) => {
            const isBlock = /language-/.test(className ?? "") || String(children).includes("\n");
            if (isBlock) {
              return (
                <code className="block font-mono text-[12px] leading-relaxed">{children}</code>
              );
            }
            return (
              <code className="px-1.5 py-0.5 rounded bg-surface-muted font-mono text-[12px] text-charcoal">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-2.5 overflow-x-auto rounded-xl bg-alabaster border border-line px-3.5 py-3 text-charcoal">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-2.5 overflow-x-auto rounded-xl border border-line">
              <table className="w-full border-collapse text-left text-[12.5px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-alabaster/60 [&_th]:font-semibold">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 border-b border-line-soft text-charcoal whitespace-nowrap">{children}</th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 border-b border-line-soft text-satin-grey align-top">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
