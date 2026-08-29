"use client";

import React from "react";
import { Copy, Check, AlertTriangle } from "lucide-react";
import { copyTextToClipboard } from "@/lib/ai/share";
import { useToastStore } from "@/store/useToastStore";

let mermaidInitialized = false;
async function getMermaid() {
  const m = await import("mermaid");
  const mm = (m as any).default ?? m;
  if (!mermaidInitialized) {
    mm.initialize({
      startOnLoad: false,
      theme: "base",
      themeVariables: {
        primaryColor: "#F0EBE1",
        primaryTextColor: "#313032",
        primaryBorderColor: "#E8E0D5",
        lineColor: "#8A7D6B",
        secondaryColor: "#F7F5F5",
        tertiaryColor: "#FFFFFF",
        background: "#FFFFFF",
        mainBkg: "#F0EBE1",
        nodeBorder: "#CDB9AB",
        clusterBkg: "#F7F5F5",
        titleColor: "#313032",
      },
      fontFamily: "var(--font-ui), sans-serif",
      securityLevel: "strict",
    });
    mermaidInitialized = true;
  }
  return mm;
}

export function KiroMermaid({ code }: { code: string }) {
  const [svg, setSvg] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const pushToast = useToastStore((s) => s.pushToast);
  const idRef = React.useRef(`mmd-${Math.random().toString(36).slice(2, 8)}`);

  React.useEffect(() => {
    let cancelled = false;
    const trimmed = code.trim();
    if (!trimmed) {
      setError("空图表");
      return;
    }
    // 流式中未闭合的 mermaid（常见：```mermaid 未闭合）先不渲染，避免闪错
    if (trimmed.length < 10) {
      setSvg(null);
      setError(null);
      return;
    }
    getMermaid()
      .then(async (mm) => {
        try {
          const { svg: rendered } = await mm.render(idRef.current + "-svg", trimmed);
          if (!cancelled) {
            setSvg(rendered);
            setError(null);
          }
        } catch (e: any) {
          if (!cancelled) setError(e?.message ?? "渲染失败");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const onCopy = async () => {
    const ok = await copyTextToClipboard(code);
    if (ok) {
      setCopied(true);
      pushToast({ message: "已复制 Mermaid 源码" });
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const onCopySvg = async () => {
    if (!svg) return;
    const ok = await copyTextToClipboard(svg);
    if (ok) pushToast({ message: "已复制 SVG" });
  };

  return (
    <div className="my-[0.85em] rounded-xl border border-line bg-white overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-alabaster border-b border-line">
        <span className="text-[10px] font-bold tracking-wide text-sandrift uppercase">Mermaid</span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onCopy}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white border border-line text-[11px] font-medium text-satin-grey hover:text-charcoal"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            源码
          </button>
          {svg && (
            <button
              onClick={onCopySvg}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white border border-line text-[11px] font-medium text-satin-grey hover:text-charcoal"
            >
              <Copy className="w-3 h-3" /> SVG
            </button>
          )}
        </div>
      </div>
      <div className="p-3 bg-white overflow-x-auto max-h-[520px]">
        {error ? (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-danger-bg border border-danger-border text-[12px] text-danger">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">预览失败，显示源码</p>
              <p className="text-[11px] text-satin-grey mt-1 break-words">{error}</p>
            </div>
          </div>
        ) : svg ? (
          <div className="flex justify-center [&_svg]:max-w-full [&_svg]:h-auto" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <div className="animate-pulse space-y-2">
            <div className="h-3 w-3/4 rounded bg-alabaster" />
            <div className="h-3 w-1/2 rounded bg-alabaster/70" />
            <div className="h-32 rounded bg-alabaster/50" />
          </div>
        )}
        {error && (
          <pre className="mt-3 p-3 rounded-lg bg-alabaster border border-line overflow-x-auto font-mono text-[0.84em] leading-[1.65] text-charcoal whitespace-pre">
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
