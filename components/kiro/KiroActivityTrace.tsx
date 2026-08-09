"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, Loader2, Circle, ChevronDown, PencilLine } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { KiroActivityStep, KiroAgentPhase } from "@/hooks/useKiroChat";
import { KiroLogoIcon } from "@/components/kiro/KiroLogo";
import { cn } from "@/lib/utils";

const PHASE_LABEL: Record<KiroAgentPhase, string> = {
  thinking: "正在思考",
  reading: "正在读取 ClassFlow 数据",
  acting: "正在执行修改",
  composing: "正在整理结果",
  done: "",
  error: "遇到问题",
};

/**
 * Kiro Agent Worklog（Codex-style）：一个 Assistant Turn 的连续执行记录。
 * Working：Logo（glow/breathe）+「正在处理 · Xs」/ 无步骤时显示具体 phase；展开可见 phase 行 + 真实 Tool Steps。
 * Done：「已处理 Xs」+ 展开保留 ✓ summary 与 Steps；不再显示 Logo。
 * 底部极弱分割线（border-line-soft）衔接同 Turn 的最终回答，形成连续文档流。
 * 计时器跨 phase 连续；新一轮（done/error→working）重置。绝不展示 chain-of-thought / tool args / JSON。
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

  // 延迟显示（<300ms 不渲染，避免快速回答闪烁）+ 跨 phase 连续 elapsed + 新一轮重置
  const [show, setShow] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const prevPhaseRef = useRef(phase);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    if (phase === "done") {
      setShow(false);
      setExpanded(false);
      return;
    }
    if (prev === "done" || prev === "error") setElapsed(0); // 新 Turn 开始
    const t = setTimeout(() => setShow(true), 300);
    return () => clearTimeout(t);
  }, [phase]);
  useEffect(() => {
    if (!show || phase === "done") return;
    const tick = setInterval(() => setElapsed((e) => e + 0.5), 500);
    return () => clearInterval(tick);
  }, [show, phase]);

  if (phase === "done" && steps.length === 0) return null;

  const working = phase !== "done" && phase !== "error";
  const writeCount = steps.filter((s) => s.kind === "write").length;
  const changeSetCount = steps.reduce((acc, s) => acc + (s.count ?? 0), 0);
  // Change Set：整体摘要直接展示「完成 N 项修改」；其余按写/读分类
  const doneSummary =
    changeSetCount > 0
      ? `完成 ${changeSetCount} 项修改`
      : writeCount > 0
        ? `完成 ${steps.length} 个步骤 · 修改 ${writeCount} 项内容`
        : `已读取 ${steps.length} 项 ClassFlow 信息`;

  // Codex-style 顶部行：working =「正在处理」/ 无步骤 = 具体 phase；done =「已处理 Xs」
  const topLabel = done
    ? `已处理${elapsed >= 1 ? ` ${elapsed.toFixed(1)}s` : ""}`
    : steps.length > 0
      ? "正在处理"
      : PHASE_LABEL[phase];

  const glowClass =
    phase === "thinking"
      ? "kiro-agent-logo-glow"
      : phase === "reading"
        ? "kiro-agent-logo-glow"
        : phase === "acting"
          ? "kiro-agent-logo-glow-strong"
          : phase === "composing"
            ? "kiro-agent-logo-glow-soft"
            : "";

  return (
    <div data-testid="kiro-activity-trace" role="status" aria-live="polite" className={cn("w-full", !show && working && "opacity-0")}>
      {/* Worklog 行 */}
      <div className="flex gap-3">
        {/* Logo 槽：working 显示 Kiro Logo；done 留空（与回答共享 Logo） */}
        <span className="w-5 h-5 flex items-center justify-center shrink-0" aria-hidden="true">
          {working ? (
            <span className={cn("flex items-center justify-center", phase === "thinking" && "kiro-agent-logo-thinking")}>
              <KiroLogoIcon className={cn("w-5 h-5 kiro-agent-logo-active", glowClass)} />
            </span>
          ) : null}
        </span>

        <div className="flex-1 min-w-0 pt-0.5">
          <button
            onClick={() => steps.length > 0 && setExpanded((v) => !v)}
            aria-expanded={steps.length > 0 ? expanded : undefined}
            disabled={steps.length === 0}
            className={cn(
              "flex items-center gap-1.5 text-left transition-colors",
              working ? "text-xs font-medium text-charcoal" : "text-[11px] font-semibold text-sandrift hover:text-charcoal",
              steps.length > 0 && "cursor-pointer"
            )}
          >
            {done ? (
              <Check className="w-3.5 h-3.5 text-success shrink-0" aria-hidden="true" />
            ) : (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-sandrift shrink-0" aria-hidden="true" />
            )}
            <span className="truncate">{topLabel}</span>
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
              className={cn("mt-1.5 space-y-0.5", compact ? "max-w-[300px]" : "max-w-[420px]")}
            >
              {!done && (
                <p className="text-[11px] font-semibold text-sandrift px-1 pb-0.5">{PHASE_LABEL[phase]}</p>
              )}
              {done && <p className="text-[11px] font-semibold text-success px-1 pb-0.5">{doneSummary}</p>}
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
      </div>

      {/* 极弱分割线：Worklog 与同一 Turn 的最终回答衔接 */}
      <div className="border-t border-line-soft my-1.5" aria-hidden="true" />
    </div>
  );
}
