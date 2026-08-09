"use client";

import React, { useEffect, useState } from "react";
import { Check, Loader2, Circle, ChevronDown, PencilLine } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { KiroActivityStep, KiroAgentPhase } from "@/hooks/useKiroChat";
import { KiroLogoIcon } from "@/components/kiro/KiroLogo";
import { cn } from "@/lib/utils";

const PHASE_LABEL: Record<KiroAgentPhase, string> = {
  thinking: "Kiro 正在思考",
  reading: "Kiro 正在读取 ClassFlow 数据",
  acting: "Kiro 正在执行修改",
  composing: "Kiro 正在整理结果",
  done: "",
  error: "Kiro 遇到问题",
};

/**
 * Kiro Agent Progress（Task：执行反馈）。
 * 从真实 Runtime phase 推导，只展示用户可理解的阶段文案与真实 Tool Step；
 * 绝不展示 chain-of-thought / tool arguments / JSON。
 * - submitted 持续 <300ms 不显示（避免快速请求闪烁）；elapsed 仅视觉（>1.5s 显示，aria-hidden）
 * - thinking：Logo 缓慢呼吸；reading/acting：品牌色 perimeter sweep；done：停止动画
 * - 文本开始流式后：progress 淡出（fade 由 Conversation 包装层处理），有工具时保留完成摘要
 */
export function KiroActivityTrace({
  steps,
  done,
  phase,
  compact: compactProp,
}: {
  steps: KiroActivityStep[];
  done: boolean;
  phase: KiroAgentPhase;
  /** sidecar：更紧凑 */
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentDensity = useAppStore((s) => s.preferences.contentDensity);
  const compact = compactProp ?? contentDensity === "compact";

  // 延迟显示：phase 持续 <300ms 不渲染（避免快速回答闪烁 loading）
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (phase === "done") {
      setShow(false);
      setExpanded(false);
      return;
    }
    const t = setTimeout(() => setShow(true), 300);
    return () => clearTimeout(t);
  }, [phase]);
  // elapsed timer（仅视觉）：500ms 步进；不进入 Chat State / History
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!show || phase === "done") return;
    const tick = setInterval(() => setElapsed((e) => e + 0.5), 500);
    return () => clearInterval(tick);
  }, [show, phase]);

  if (phase === "done" && steps.length === 0) return null;

  const writeCount = steps.filter((s) => s.kind === "write").length;
  const summary = done
    ? writeCount > 0
      ? `✓ 完成 ${steps.length} 个步骤 · 修改 ${writeCount} 项内容`
      : `✓ 读取 ${steps.length} 项 ClassFlow 信息`
    : PHASE_LABEL[phase];

  const working = phase !== "done" && phase !== "error";
  const sweep = phase === "reading" || phase === "acting";
  const thinking = phase === "thinking";

  return (
    <div
      data-testid="kiro-activity-trace"
      role="status"
      aria-live="polite"
      className={cn("inline-flex flex-col items-start", !show && working && "opacity-0", !working && "opacity-100")}
    >
      <button
        onClick={() => steps.length > 0 && setExpanded((v) => !v)}
        aria-expanded={steps.length > 0 ? expanded : undefined}
        disabled={steps.length === 0}
        className={cn(
          "flex items-center gap-2 text-[11px] font-semibold text-satin-grey hover:text-charcoal transition-colors",
          steps.length > 0 && "cursor-pointer",
          steps.length === 0 && "cursor-default"
        )}
      >
        {/* Kiro Logo + 阶段动效（reduced-motion 关闭动画，见 globals.css） */}
        <span className="relative w-5 h-5 flex items-center justify-center shrink-0" aria-hidden="true">
          <span
            className={cn(
              "absolute inset-0 rounded-full kiro-ring",
              sweep && "kiro-ring-animated",
              phase === "acting" && "kiro-ring-fast",
              !sweep && "opacity-0"
            )}
          />
          <KiroLogoIcon className={cn("w-4 h-4 relative", thinking && "kiro-agent-logo-thinking")} />
        </span>
        <span className="truncate">{summary}</span>
        {/* elapsed 只做视觉（aria-hidden），语义状态由文案承担 */}
        {working && show && elapsed >= 1.5 && (
          <span aria-hidden="true" className="text-sandrift tabular-nums shrink-0">
            · {elapsed.toFixed(1)}s
          </span>
        )}
        {steps.length > 0 && (
          <ChevronDown
            className={cn(
              "w-3 h-3 text-sandrift shrink-0 transition-transform duration-[var(--motion-fast)]",
              expanded && "rotate-180"
            )}
          />
        )}
      </button>

      {expanded && steps.length > 0 && (
        <div
          role="list"
          aria-label="Kiro 工具记录"
          className={cn(
            "mt-1.5 w-full rounded-xl bg-[#F7F5F5] border border-line p-1.5 space-y-0.5 ux-fade",
            compact ? "max-w-[300px]" : "max-w-[420px]"
          )}
        >
          {steps.map((s) => (
            <div
              key={s.label}
              role="listitem"
              className={cn(
                "flex items-center gap-2 px-2 rounded-lg text-[11px]",
                compact ? "py-1.5" : "py-2",
                s.status === "done"
                  ? "text-satin-grey"
                  : s.status === "working"
                  ? "text-charcoal font-semibold"
                  : "text-danger"
              )}
            >
              {s.status === "done" ? (
                <Check className="w-3.5 h-3.5 text-success shrink-0" />
              ) : s.status === "working" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-charcoal shrink-0" aria-hidden="true" />
              ) : (
                <Circle className="w-3.5 h-3.5 text-danger shrink-0" />
              )}
              <span className="truncate">{s.label}</span>
              {s.kind === "write" && s.status !== "error" && (
                <PencilLine className="w-3 h-3 text-sandrift shrink-0 ml-auto" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
