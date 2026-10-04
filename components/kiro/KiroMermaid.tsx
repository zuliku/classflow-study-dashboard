"use client";

import React from "react";
import { Copy, Check, AlertTriangle } from "lucide-react";
import { copyTextToClipboard } from "@/lib/ai/share";
import { useToastStore } from "@/store/useToastStore";

let mermaidInitialized = false;
/** 流式渲染防抖（非 motion 时长：等代码稳定 350ms 再全量布局，token 间隔通常远小于此） */
const MERMAID_RENDER_DEBOUNCE_MS = 350;
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

export function KiroMermaid({ code, streaming = false }: { code: string; streaming?: boolean }) {
  const [svg, setSvg] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const pushToast = useToastStore((s) => s.pushToast);
  const renderSeqRef = React.useRef(0);
  const copyTimerRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  React.useEffect(() => {
    // P1：单调 renderId（此前固定 id 复用撞 mermaid 唯一 id 要求 + 布尔 cancelled 竞态不可靠）
    const seq = (renderSeqRef.current += 1);
    const trimmed = code.trim();
    // 新 code 到达先清旧 error（保留旧 svg，避免 stale 红框闪 350ms）
    setError(null);
    if (!trimmed) {
      setError("空图表");
      return;
    }
    // 流式 fence 未闭合 / streaming 显式标记：只给骨架，不调 mm.render（此前短码才挡，稍长未闭合仍全量算废弃结果）
    if (streaming || trimmed.length < 10) {
      return;
    }
    // 流式防抖：代码高频变化时等稳定再全量渲染（mm.render 不可中途取消，
    // 每 token 都渲会把废弃结果也算完，主线程持续过载；350ms 内新 token 到达即顺延）
    const timer = window.setTimeout(() => {
      getMermaid()
        .then(async (mm) => {
          try {
            // 每次唯一 id（mermaid 要求），过期结果按 seq 丢弃
            const { svg: rendered } = await mm.render(`mmd-${seq}-${Date.now().toString(36)}`, trimmed);
            if (renderSeqRef.current !== seq) return;
            setSvg(rendered);
            setError(null);
          } catch (e: any) {
            if (renderSeqRef.current !== seq) return;
            setError(e?.message ?? "渲染失败");
          }
        })
        .catch((e) => {
          if (renderSeqRef.current !== seq) return;
          setError(String(e));
        });
    }, MERMAID_RENDER_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [code, streaming]);

  const onCopy = async () => {
    const ok = await copyTextToClipboard(code);
    if (ok) {
      setCopied(true);
      pushToast({ message: "已复制 Mermaid 源码" });
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
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
        {/* 三态同槽位 keyed 淡入（高度未知无法占位，淡入覆盖骨架→图/错的硬切） */}
        <div key={error ? "error" : svg ? "svg" : "loading"} className="ux-fade">
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
          <div className="ux-skeleton animate-pulse space-y-2">
            <div className="h-3 w-3/4 rounded bg-alabaster" />
            <div className="h-3 w-1/2 rounded bg-alabaster/70" />
            <div className="h-32 rounded bg-alabaster/50" />
          </div>
        )}
        </div>
        {error && (
          <pre className="mt-3 p-3 rounded-lg bg-alabaster border border-line overflow-x-auto font-mono text-[0.84em] leading-[1.65] text-charcoal whitespace-pre">
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
