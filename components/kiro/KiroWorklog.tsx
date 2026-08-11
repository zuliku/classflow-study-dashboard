"use client";

import React, { useState } from "react";
import { Check, Loader2, AlertCircle, ChevronDown } from "lucide-react";
import { KiroAssistantTurnPresentation, KiroWorklogBlock } from "@/lib/ai/presentation/turnPresentation";
import { KiroLogoIcon } from "@/components/kiro/KiroLogo";
import { cn } from "@/lib/utils";

type ToolBlock = Extract<KiroWorklogBlock, { kind: "tool" }>;

/**
 * Tool Row：真实 button（aria-expanded）；展开只显示 safeDetails（Task 1 已清洗）。
 * 组件禁止读取 raw input / raw output。
 */
function KiroToolRow({ block }: { block: ToolBlock }) {
  const [open, setOpen] = useState(false);
  const working = block.status === "working";
  const error = block.status === "error";
  const expandable = block.safeDetails.length > 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        aria-expanded={open}
        disabled={!expandable}
        className={cn(
          "flex items-center gap-1.5 px-2 h-7 w-full text-left text-[11px] rounded-lg transition-colors",
          error
            ? "text-danger bg-danger-bg/50 border border-danger-border"
            : working
              ? "text-charcoal font-semibold bg-alabaster/50 border border-line-soft"
              : "text-satin-grey hover:bg-alabaster"
        )}
      >
        {error ? (
          <AlertCircle className="w-3.5 h-3.5 text-danger shrink-0" aria-hidden="true" />
        ) : working ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-charcoal shrink-0" aria-hidden="true" />
        ) : (
          <Check className="w-3.5 h-3.5 text-success shrink-0" aria-hidden="true" />
        )}
        <span className="truncate">{block.label}</span>
        {expandable && (
          <ChevronDown
            className={cn(
              "w-3 h-3 text-sandrift shrink-0 ml-auto transition-transform duration-[var(--motion-fast)]",
              open && "rotate-180"
            )}
            aria-hidden="true"
          />
        )}
      </button>
      {open && expandable && (
        <div className="mt-0.5 pl-2 pr-2 pb-1 space-y-0.5">
          {block.safeDetails.map((d) => (
            <p key={d} className="text-[10px] text-satin-grey leading-relaxed">
              {d}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Kiro 紧凑 Worklog（Worklog V2 Task 2）：
 * commentary → tool → commentary → tool → final answer 的真实时序。
 * - commentary：低权重 11px，最多视觉 2 行，无 Logo / Markdown / cursor / 卡片 / 时间戳
 * - tool：默认一行；done 低权重 / working 强调 / error danger
 * - Footer：composing → 「正在整理结果…」；worklogDone 且 >1 个工具 → 「已完成 N 个步骤」
 * - Final Answer 前使用极弱分割线（border-line-soft）
 */
export function KiroWorklog({ turn }: { turn: KiroAssistantTurnPresentation }) {
  const toolCount = turn.worklog.filter((b) => b.kind === "tool").length;

  return (
    <div data-testid="kiro-worklog" className="space-y-1 max-w-[560px]">
      {turn.worklog.map((block) =>
        block.kind === "commentary" ? (
          <p
            key={block.id}
            className="text-[11px] text-sandrift leading-relaxed line-clamp-2"
          >
            {block.text}
          </p>
        ) : (
          <KiroToolRow key={block.id} block={block} />
        )
      )}

      {/* Footer：composing 阶段提示；完成后步骤计数（仅 >1 个工具时显示） */}
      {turn.phase === "composing" && (
        <p className="flex items-center gap-1.5 text-[11px] text-sandrift">
          <Loader2 className="w-3 h-3 animate-spin text-sandrift shrink-0" aria-hidden="true" />
          正在整理结果…
        </p>
      )}
      {turn.worklogDone && toolCount > 1 && (
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-sandrift">
          <Check className="w-3.5 h-3.5 text-success shrink-0" aria-hidden="true" />
          已完成 {toolCount} 个步骤
        </p>
      )}

      {/* Final Answer 前的极弱分割线（worklog 与回答衔接） */}
      {turn.worklog.length > 0 && turn.answer.length > 0 && (
        <div className="border-t border-line-soft my-1.5" aria-hidden="true" />
      )}
    </div>
  );
}

/**
 * 首 token 前占位：Kiro Logo（glow）+ 「正在处理」。
 * Assistant 任一可见 part（content / worklog / action）出现后自动消失，绝不与消息 Logo 同时出现。
 */
export function KiroPendingIndicator() {
  return (
    <div data-testid="kiro-pending" role="status" className="flex items-center gap-3">
      <span className="w-5 h-5 flex items-center justify-center shrink-0" aria-hidden="true">
        <KiroLogoIcon className="w-5 h-5 kiro-agent-logo-active kiro-agent-logo-glow" />
      </span>
      <span className="text-xs font-medium text-charcoal">正在处理</span>
    </div>
  );
}
