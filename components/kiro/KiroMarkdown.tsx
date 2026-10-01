"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { Copy, Check, ExternalLink, Globe2, AlertTriangle } from "lucide-react";
import { normalizeMathDelimiters } from "@/lib/ai/markdown";

const KiroMermaid = React.lazy(() =>
  import("@/components/kiro/KiroMermaid").then((m) => ({ default: m.KiroMermaid }))
);
const KiroChartBlock = React.lazy(() =>
  import("@/components/kiro/KiroChartBlock").then((m) => ({ default: m.KiroChartBlock }))
);
const KiroTimelineBlock = React.lazy(() =>
  import("@/components/kiro/KiroTimelineBlock").then((m) => ({ default: m.KiroTimelineBlock }))
);
import { KiroSourceMeta } from "@/lib/ai/citations/types";
import { KiroCitation } from "@/components/kiro/KiroCitation";
import { remarkKiroCitation } from "@/lib/ai/citations/remarkCitation";
import { useToastStore } from "@/store/useToastStore";
import { copyTextToClipboard } from "@/lib/ai/share";
import { usePresence } from "@/lib/usePresence";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Kiro Markdown：Assistant Markdown → ClassFlow styled React（prose + math 单一入口）。
 * Pipeline：normalizeMathDelimiters → remark-gfm → remark-math → remarkKiroCitation → rehype-katex → components。
 * - KaTeX：throwOnError:false，trust:false
 * - 不启用 rehype-raw
 * - 链接白名单 http/https/mailto，外链 target=_blank
 * - 全部样式集中在此
 * - 新增：h4-h6、img 灯箱、代码复制/mermaid、表格粘性头、链接卡片
 */

// ---------- helpers ----------
function isSafeHttpUrl(href: string): boolean {
  try {
    const u = new URL(href);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function getDomain(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

// ---------- img ----------
function KiroMarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState(false);
  // 灯箱对称进退（blur 只在全开时保留，进退场不逐帧重模糊）
  const lightboxPresence = usePresence(open, MOTION_EXIT_MS.base);
  const pushToast = useToastStore((s) => s.pushToast);
  if (!src) return null;
  const safe = isSafeHttpUrl(src) || src.startsWith("data:") || src.startsWith("blob:");
  if (!safe || error) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-alabaster border border-line text-[11px] text-satin-grey">
        <AlertTriangle className="w-3 h-3" />
        图片无法显示
        {isSafeHttpUrl(src) && (
          <a href={src} target="_blank" rel="noopener noreferrer" className="underline ml-1">
            打开链接
          </a>
        )}
      </span>
    );
  }
  return (
    <>
      <span className="block my-[0.85em]">
        <img
          src={src}
          alt={alt ?? ""}
          loading="lazy"
          decoding="async"
          onError={() => setError(true)}
          onClick={() => setOpen(true)}
          className="rounded-xl border border-line max-w-full h-auto cursor-zoom-in mx-auto max-h-[420px] object-contain bg-alabaster"
        />
        {alt && <span className="block text-center text-[11px] text-sandrift mt-1.5">{alt}</span>}
      </span>
      {lightboxPresence.mounted && (
        <div
          className={cn(
            "fixed inset-0 z-[80] bg-charcoal/60 flex items-center justify-center p-4 transition-opacity",
            lightboxPresence.visible
              ? "opacity-100 duration-[var(--motion-base)]"
              : "opacity-0 pointer-events-none duration-[var(--motion-exit-base)] ease-[var(--ease-exit)]",
            // blur 只在全开时保留（进退场透明度动画期间逐帧重模糊全屏最贵）
            lightboxPresence.visible && "backdrop-blur-sm"
          )}
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className={cn(
              "relative max-w-[90vw] max-h-[86vh] bg-white rounded-2xl overflow-auto p-2 shadow-card transition-[opacity,transform]",
              lightboxPresence.visible
                ? "opacity-100 scale-100 duration-[var(--motion-base)]"
                : "opacity-0 scale-[0.98] duration-[var(--motion-exit-base)] ease-[var(--ease-exit)]"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setOpen(false)}
              className="absolute top-2 right-2 w-8 h-8 rounded-full bg-surface border border-line flex items-center justify-center text-sandrift hover:text-charcoal"
              aria-label="关闭"
            >
              ✕
            </button>
            <img src={src} alt={alt ?? ""} className="max-w-full h-auto rounded-xl" />
          </div>
        </div>
      )}
    </>
  );
}

// ---------- code block ----------
function KiroCodeBlock({ children, className }: { children?: React.ReactNode; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  const text = String(children ?? "");
  const lang = className?.match(/language-(\w+)/)?.[1]?.toLowerCase();
  const isMermaid = lang === "mermaid";
  const pushToast = useToastStore((s) => s.pushToast);

  const onCopy = async () => {
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopied(true);
      pushToast({ message: "已复制代码" });
      setTimeout(() => setCopied(false), 1500);
    }
  };

  if (isMermaid) {
    return (
      <React.Suspense
        fallback={
          <div className="ux-skeleton my-[0.85em] rounded-xl border border-line bg-alabaster p-4 animate-pulse">
            <div className="h-3 w-24 rounded bg-surface mb-3" />
            <div className="h-32 rounded bg-surface/70" />
          </div>
        }
      >
        <KiroMermaid code={text} />
      </React.Suspense>
    );
  }
  const isChart = lang === "chart" || lang === "chart-json";
  if (isChart) {
    return (
      <React.Suspense
        fallback={
          <div className="ux-skeleton my-[0.85em] rounded-xl border border-line bg-alabaster p-4 animate-pulse">
            <div className="h-3 w-20 rounded bg-surface mb-3" />
            <div className="h-[260px] rounded bg-surface/70" />
          </div>
        }
      >
        <KiroChartBlock code={text} />
      </React.Suspense>
    );
  }
  const isTimeline = lang === "timeline" || lang === "steps";
  if (isTimeline) {
    return (
      <React.Suspense
        fallback={
          <div className="ux-skeleton my-[0.85em] rounded-xl border border-line bg-alabaster p-4 animate-pulse">
            <div className="h-3 w-20 rounded bg-surface mb-3" />
            <div className="space-y-2">
              <div className="h-3 w-full rounded bg-surface/70" />
              <div className="h-3 w-5/6 rounded bg-surface/50" />
            </div>
          </div>
        }
      >
        <KiroTimelineBlock code={text} />
      </React.Suspense>
    );
  }

  const label = lang ? lang.toUpperCase() : "CODE";
  return (
    <div className="my-[0.85em] rounded-xl border border-line bg-alabaster overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-alabaster border-b border-line">
        <span className="text-[10px] font-bold tracking-wide text-sandrift uppercase bg-white border border-line rounded-md px-1.5 py-0.5">{label}</span>
        <button
          onClick={onCopy}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white border border-line text-[11px] font-medium text-satin-grey hover:text-charcoal hover:border-line-strong transition-colors"
          aria-label="复制代码"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="m-0 p-4 overflow-x-auto font-mono text-[0.84em] leading-[1.65] text-charcoal">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

// ---------- link card ----------
function KiroLinkCard({ href, title }: { href: string; title?: string }) {
  const domain = getDomain(href);
  const displayTitle = title && title !== href ? title : domain;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="my-[0.85em] flex items-center gap-3 p-3 rounded-xl border border-line bg-surface hover:bg-alabaster hover:border-line-strong transition-colors no-underline"
    >
      <span className="w-9 h-9 rounded-lg bg-white border border-line flex items-center justify-center shrink-0">
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`}
          alt=""
          className="w-4 h-4"
          loading="lazy"
          onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
        />
        <Globe2 className="w-4 h-4 text-sandrift absolute opacity-0" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-semibold text-charcoal truncate">{displayTitle}</span>
        <span className="block text-[11px] text-sandrift truncate">{domain}</span>
      </span>
      <ExternalLink className="w-3.5 h-3.5 text-sandrift shrink-0" />
    </a>
  );
}

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
      const text = typeof children === "string" ? children : Array.isArray(children) ? children.join("") : "";
      const isBareUrl = typeof href === "string" && text === href && /^https?:\/\//.test(href);
      // 裸链接且文本即 URL → 卡片化（独行场景由 p 进一步判断，此处兜底行内也卡片化）
      if (isBareUrl && typeof href === "string" && href.length > 24) {
        // 行内裸链接仍用普通 a，避免 table 内卡片化；卡片仅在 p 单链接时由 p 组件接管
        // 这里保持行内 a，避免过度卡片
      }
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
  rehypeHighlight as any,
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
  const normalized = React.useMemo(() => normalizeMathDelimiters(content), [content]);
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
          img: () => null,
        }}
      >
        {normalized}
      </ReactMarkdown>
    );
  }

  return (
    <div
      className="kiro-markdown text-charcoal max-w-[65ch] [text-wrap:pretty]"
      style={{ fontSize: "clamp(14px, 0.9vw + 12px, var(--kiro-output-font-size))", lineHeight: 1.74 }}
      data-testid="kiro-markdown"
    >
      <ReactMarkdown
        remarkPlugins={kiroRemarkPlugins}
        rehypePlugins={kiroRehypePlugins}
        components={{
          p: ({ children, ...props }) => {
            // 独行裸链接 → 卡片
            const childArray = React.Children.toArray(children);
            if (childArray.length === 1) {
              const first = childArray[0] as any;
              if (first?.props?.href && typeof first.props.href === "string" && isSafeHttpUrl(first.props.href)) {
                const href: string = first.props.href;
                const text = typeof first.props.children === "string" ? first.props.children : "";
                if (text === href || (typeof text === "string" && text.includes(href))) {
                  return <KiroLinkCard href={href} title={text !== href ? text : undefined} />;
                }
                // 单链接但文本不同，仍卡片化
                if (childArray.length === 1 && first.type === "a") {
                  return <KiroLinkCard href={href} title={typeof text === "string" ? text : undefined} />;
                }
              }
            }
            return <p className="mb-[0.8em] last:mb-0 [text-wrap:pretty]">{children}</p>;
          },
          h1: ({ children }) => (
            <h1 className="text-[1.28em] leading-snug font-semibold text-charcoal mt-[1.6em] mb-[0.65em] first:mt-0 [text-wrap:balance]">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-[1.14em] leading-snug font-semibold text-charcoal mt-[1.45em] mb-[0.55em] first:mt-0 [text-wrap:balance]">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-[1.04em] leading-snug font-semibold text-charcoal mt-[1.25em] mb-[0.45em] first:mt-0 [text-wrap:balance]">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-[1em] leading-snug font-semibold text-charcoal mt-[1.2em] mb-[0.4em] first:mt-0 [text-wrap:balance]">
              {children}
            </h4>
          ),
          h5: ({ children }) => (
            <h5 className="text-[0.95em] leading-snug font-semibold text-charcoal mt-[1.1em] mb-[0.35em] first:mt-0 [text-wrap:balance]">
              {children}
            </h5>
          ),
          h6: ({ children }) => (
            <h6 className="text-[0.9em] leading-snug font-semibold text-satin-grey mt-[1em] mb-[0.3em] first:mt-0 tracking-wide uppercase [text-wrap:balance]">
              {children}
            </h6>
          ),
          ...inlineComponents,
          img: ({ src, alt }) => <KiroMarkdownImage src={src} alt={alt} />,
          div: ({ children, className, ...props }: any) => {
            const isKatexDisplay = typeof className === "string" && className.includes("katex-display");
            if (isKatexDisplay) {
              const latex = typeof children === "string" ? children : "";
              // 尝试从 katex 的 annotation 提取 LaTeX，否则用 text
              return (
                <div className="group relative">
                  <div className={className} {...props}>
                    {children}
                  </div>
                  <button
                    onClick={async () => {
                      const text = (children as any)?.props?.children ?? "";
                      // 降级：复制外层文本
                      const toCopy = typeof text === "string" ? text : String(text);
                      const ok = await copyTextToClipboard(toCopy || "");
                      if (ok) useToastStore.getState().pushToast({ message: "已复制公式" });
                    }}
                    className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 px-1.5 py-1 rounded-md bg-white border border-line text-[10px] font-medium text-satin-grey hover:text-charcoal"
                    aria-label="复制公式"
                  >
                    <Copy className="w-3 h-3" /> 复制
                  </button>
                </div>
              );
            }
            return (
              <div className={className} {...props}>
                {children}
              </div>
            );
          },
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
          blockquote: ({ children }) => {
            // 检测 GitHub 风格 callout: > [!NOTE] / [!WARNING] / [!TIP] / [!IMPORTANT] / [!CAUTION]
            const firstChild = React.Children.toArray(children)[0] as any;
            const text = typeof firstChild?.props?.children === "string" ? firstChild.props.children : Array.isArray(firstChild?.props?.children) ? firstChild.props.children.join("") : "";
            const match = typeof text === "string" ? text.match(/^\s*\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s*/i) : null;
            if (match) {
              const kind = match[1].toUpperCase();
              const iconMap: Record<string, string> = { NOTE: "💡", TIP: "✨", WARNING: "⚠️", IMPORTANT: "📌", CAUTION: "🚨" };
              const colorMap: Record<string, string> = {
                NOTE: "border-[#0969da] bg-[#ddf4ff]/50",
                TIP: "border-[#1a7f37] bg-[#dafbe1]/60",
                WARNING: "border-[#9a6700] bg-[#fff8c5]/60",
                IMPORTANT: "border-[#8250df] bg-[#fbefff]/60",
                CAUTION: "border-[#cf222e] bg-[#ffebe9]/60",
              };
              return (
                <div className={`my-[0.85em] rounded-xl border px-3 py-2.5 ${colorMap[kind] ?? "border-line bg-alabaster/40"}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span>{iconMap[kind] ?? "💡"}</span>
                    <span className="text-[11px] font-bold tracking-wide uppercase text-charcoal">{kind}</span>
                  </div>
                  <div className="text-[13px] leading-[1.7] text-satin-grey [&_p]:mb-[0.5em] [&_p:last-child]:mb-0">{children}</div>
                </div>
              );
            }
            return (
              <blockquote className="my-[0.8em] border-l-2 border-line-strong bg-alabaster/40 rounded-r-lg px-[0.9em] py-[0.65em] text-satin-grey [&_p]:mb-[0.5em] [&_p:last-child]:mb-0">
                {children}
              </blockquote>
            );
          },
          hr: () => <hr className="my-[1em] border-line-soft" />,
          pre: ({ children }) => {
            // children 是 <code className="language-xxx">，提取
            const codeElement = React.Children.toArray(children)[0] as any;
            const className: string | undefined = codeElement?.props?.className;
            const codeChildren = codeElement?.props?.children;
            return <KiroCodeBlock className={className}>{codeChildren}</KiroCodeBlock>;
          },
          code: ({ children, className }) => {
            // 行内 code 已在 pre 中处理，这里兜底行内
            const isBlock = /language-/.test(className ?? "") || String(children).includes("\n");
            if (isBlock) return <code className="block font-mono text-[0.84em] leading-[1.65]">{children}</code>;
            return (
              <code className="px-1.5 py-0.5 rounded-md bg-surface-muted font-mono text-[0.86em] text-charcoal break-words">
                {children}
              </code>
            );
          },
          table: ({ children }) => {
            // 空表格检测：若无 thead/tbody 内容，显示空状态
            const hasContent = React.Children.toArray(children).some((c: any) => c?.props?.children);
            if (!hasContent) {
              return <div className="my-[0.85em] rounded-xl border border-dashed border-line bg-alabaster/30 px-4 py-6 text-center text-[12px] text-sandrift">暂无数据</div>;
            }
            return (
              <div className="my-[0.85em] rounded-xl border border-line overflow-hidden">
                <div className="overflow-auto max-h-[60vh]" role="region" aria-label="表格" tabIndex={0}>
                  <table className="w-full border-collapse text-left text-[0.88em] [&_tr:last-child>td]:border-b-0">
                    {children}
                  </table>
                </div>
                <div className="flex justify-end px-2 py-1.5 bg-alabaster/40 border-t border-line">
                  <button
                    onClick={async () => {
                      // 提取表格文本为 TSV
                      const tableEl = document.activeElement?.closest("div")?.querySelector("table");
                      // 降级：复制当前表格的 innerText
                      const text = (tableEl as HTMLElement)?.innerText ?? "";
                      const ok = await copyTextToClipboard(text);
                      if (ok) useToastStore.getState().pushToast({ message: "已复制表格" });
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white border border-line text-[11px] font-medium text-satin-grey hover:text-charcoal"
                  >
                    <Copy className="w-3 h-3" /> 复制表格
                  </button>
                </div>
              </div>
            );
          },
          thead: ({ children }) => <thead className="bg-alabaster/60 [&_th]:font-semibold sticky top-0 z-10">{children}</thead>,
          th: ({ children, style }) => {
            const align = (style as any)?.textAlign as string | undefined;
            const alignClass = align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left";
            return (
              <th className={`px-3 py-2.5 border-b border-line-strong text-charcoal whitespace-nowrap ${alignClass}`}>{children}</th>
            );
          },
          td: ({ children, style }) => {
            const align = (style as any)?.textAlign as string | undefined;
            const alignClass = align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left";
            return <td className={`px-3 py-2.5 border-b border-line-soft/60 text-satin-grey align-top ${alignClass}`}>{children}</td>;
          },
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
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}
