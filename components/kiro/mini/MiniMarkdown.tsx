"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { isSafeWebUrl } from "@/lib/ai/citations/parser";
import { copyTextToClipboard } from "@/lib/ai/share";

function childText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(childText).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(children)) {
    return childText(children.props.children);
  }
  return "";
}

function MiniCodeBlock({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const text = childText(children);
  const lang = className?.match(/language-(\w+)/)?.[1]?.toUpperCase() ?? "CODE";
  const onCopy = async () => {
    const ok = await copyTextToClipboard(text);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="my-2 rounded-lg border border-line bg-alabaster/70 overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 border-b border-line bg-alabaster">
        <span className="text-[9px] font-bold tracking-wide text-sandrift uppercase">{lang}</span>
        <button
          type="button"
          onClick={() => void onCopy()}
          aria-label="复制代码"
          className="mini-no-drag inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-sandrift hover:text-charcoal"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="m-0 overflow-x-auto p-2 text-[11px] leading-relaxed">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

/**
 * Mini Markdown Lite：
 * - 只渲染安全、常用的文本结构；不加载图表 / Mermaid / KaTeX / 远程图片；
 * - skipHtml 阻断原始 HTML；链接只允许 http(s)；
 * - 流式时复用 V5 的内联 caret（data-kiro-stream-cursor）。
 */
export const MiniMarkdown = React.memo(function MiniMarkdown({
  text,
  streaming,
}: {
  text: string;
  streaming?: boolean;
}) {
  return (
    <div data-kiro-stream-cursor={streaming ? "true" : undefined}>
      <div
        className="kiro-markdown mini-markdown max-w-none text-charcoal"
        style={{ fontSize: 12.5, lineHeight: 1.65 }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          skipHtml
          components={{
            p: ({ children }) => (
              <p className="mb-1.5 last:mb-0 whitespace-pre-wrap break-words [text-wrap:pretty]">
                {children}
              </p>
            ),
            h1: ({ children }) => (
              <h1 className="mb-1 mt-2 text-[14px] font-bold leading-snug first:mt-0">{children}</h1>
            ),
            h2: ({ children }) => (
              <h2 className="mb-1 mt-2 text-[13px] font-bold leading-snug first:mt-0">{children}</h2>
            ),
            h3: ({ children }) => (
              <h3 className="mb-1 mt-1.5 text-[12.5px] font-bold leading-snug first:mt-0">{children}</h3>
            ),
            strong: ({ children }) => <strong className="font-semibold text-charcoal">{children}</strong>,
            em: ({ children }) => <em className="italic">{children}</em>,
            a: ({ href, children }) => {
              if (!isSafeWebUrl(href)) return <span className="text-satin-grey">{children}</span>;
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-charcoal underline decoration-line-strong underline-offset-2 hover:decoration-charcoal"
                >
                  {children}
                </a>
              );
            },
            ul: ({ children }) => (
              <ul className="mb-1.5 ml-4 list-disc space-y-0.5 last:mb-0">{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className="mb-1.5 ml-4 list-decimal space-y-0.5 last:mb-0">{children}</ol>
            ),
            li: ({ children }) => <li className="break-words">{children}</li>,
            blockquote: ({ children }) => (
              <blockquote className="my-1.5 border-l-2 border-line-strong pl-2 text-satin-grey">
                {children}
              </blockquote>
            ),
            hr: () => <hr className="my-2 border-line-soft" />,
            pre: ({ children }) => {
              const child = React.Children.toArray(children)[0];
              const props = React.isValidElement<{ className?: string; children?: React.ReactNode }>(child)
                ? child.props
                : undefined;
              return <MiniCodeBlock className={props?.className}>{props?.children ?? children}</MiniCodeBlock>;
            },
            code: ({ children, className }) => {
              const block = /language-/.test(className ?? "") || String(children).includes("\n");
              if (block) return <code className={className}>{children}</code>;
              return (
                <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[0.88em] text-charcoal break-words">
                  {children}
                </code>
              );
            },
            table: ({ children }) => (
              <div className="my-1.5 max-w-full overflow-x-auto">
                <table className="text-[11px] border-collapse">{children}</table>
              </div>
            ),
            th: ({ children }) => (
              <th className="border border-line-soft px-1.5 py-1 text-left font-semibold">{children}</th>
            ),
            td: ({ children }) => (
              <td className="border border-line-soft px-1.5 py-1 align-top">{children}</td>
            ),
            img: () => null,
          }}
        >
          {text}
        </ReactMarkdown>
      </div>
    </div>
  );
});
