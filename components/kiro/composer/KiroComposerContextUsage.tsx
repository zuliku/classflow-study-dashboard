"use client";

import React from "react";
import { PopoverPanel } from "@/components/ui/Popover";
import {
  ContextUsageSnapshot,
  formatContextUsageDetail,
  formatContextUsageLabel,
  formatContextUsageTokens,
  resolveContextUsageTone,
} from "@/lib/ai/contextBudget/usage";
import { cn } from "@/lib/utils";

/** Ring 几何（viewBox 24；stroke 2.5，留出圆角端点空间） */
const RING_SIZE = 20;
const RING_STROKE = 2.5;
const RING_RADIUS = (24 - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const TONE_CLASS: Record<"unknown" | "ok" | "warn" | "danger", string> = {
  unknown: "text-line-strong",
  ok: "text-charcoal",
  warn: "text-warning",
  danger: "text-danger",
};

/**
 * Kiro 上下文占用指示（Codex-style ring）。
 *
 * 契约：
 * - 只展示 server 返回的估算快照（对话部分 vs ClassFlow 输入预算；固定开销在明细里说明）；
 * - 不改变任何预算 / 压缩 / 路由行为（纯展示）；
 * - 无快照 → 中性空心环（等待首次请求）；达到压缩阈值 → warning；超出预算 / 失败 → danger；
 * - 单一 menu ownership 由 Composer 提供（open / onOpenChange）。
 */
export function KiroComposerContextUsage({
  snapshot,
  overflow,
  compact,
  open,
  onOpenChange,
}: {
  snapshot: ContextUsageSnapshot | null;
  /** 本 Turn 因超出输入预算失败（来自真实 error code，不猜测） */
  overflow?: boolean;
  compact?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const tone = overflow ? "danger" : resolveContextUsageTone(snapshot);
  const label = formatContextUsageLabel(snapshot, { overflow });
  const detail = formatContextUsageDetail(snapshot);

  // 进度只表达「对话部分 / 预算」；unknown → 空环（不假装有数据）
  const ratio = snapshot
    ? Math.max(0, Math.min(1, snapshot.conversationBudget.used / Math.max(1, snapshot.conversationBudget.max)))
    : 0;

  return (
    <>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={label}
        data-testid="kiro-composer-context-usage"
        data-tone={tone}
        className={cn(
          "flex items-center justify-center rounded-xl transition-colors",
          compact ? "w-9 h-9" : "w-7 h-7",
          open ? "bg-alabaster text-charcoal" : "text-sandrift hover:bg-alabaster hover:text-charcoal"
        )}
      >
        <svg
          width={RING_SIZE}
          height={RING_SIZE}
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className={cn("shrink-0", TONE_CLASS[tone])}
        >
          {/* 轨道 */}
          <circle cx="12" cy="12" r={RING_RADIUS} stroke="currentColor" strokeOpacity={0.18} strokeWidth={RING_STROKE} />
          {/* 进度弧（从 12 点顺时针） */}
          {ratio > 0 && (
            <circle
              cx="12"
              cy="12"
              r={RING_RADIUS}
              stroke="currentColor"
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={`${(RING_CIRCUMFERENCE * ratio).toFixed(2)} ${RING_CIRCUMFERENCE.toFixed(2)}`}
              transform="rotate(-90 12 12)"
            />
          )}
        </svg>
      </button>

      <PopoverPanel
        open={open}
        placement="top-end"
        motionProfile="kiro"
        className="w-72 max-w-[calc(100vw-24px)]"
      >
        <div className="p-3 space-y-2" data-testid="kiro-composer-context-usage-menu" role="dialog" aria-label="上下文占用">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-bold text-charcoal">上下文占用</span>
            {snapshot && (
              <span className="text-[10px] text-sandrift truncate max-w-[140px]" title={snapshot.model}>
                {snapshot.model}
              </span>
            )}
          </div>

          {!snapshot ? (
            <p className="text-[11px] text-sandrift leading-relaxed">
              发送第一条消息后显示占用估算（只统计对话上下文，不含系统提示与工具定义）。
            </p>
          ) : (
            <>
              {/* 对话上下文进度（真实驱动自动压缩的部分） */}
              <div>
                <p className="text-[11px] font-semibold text-charcoal">{detail!.conversation}</p>
                <div className="mt-1 h-1.5 rounded-full bg-alabaster overflow-hidden" aria-hidden="true">
                  <span
                    className={cn(
                      "block h-full rounded-full transition-[width] duration-[var(--motion-fast)]",
                      tone === "danger" ? "bg-danger" : tone === "warn" ? "bg-warning" : "bg-charcoal"
                    )}
                    style={{ width: `${Math.round(ratio * 100)}%` }}
                  />
                </div>
              </div>

              {/* 明细：对话构成（附件 / 摘要只在存在时显示） */}
              {(snapshot.breakdown.attachmentTokens > 0 || snapshot.breakdown.summaryTokens > 0) && (
                <ul className="space-y-0.5 text-[10px] text-sandrift">
                  {snapshot.breakdown.attachmentTokens > 0 && (
                    <li>附件正文 ~{formatContextUsageTokens(snapshot.breakdown.attachmentTokens)}</li>
                  )}
                  {snapshot.breakdown.summaryTokens > 0 && (
                    <li>较早对话摘要 ~{formatContextUsageTokens(snapshot.breakdown.summaryTokens)}</li>
                  )}
                </ul>
              )}

              <p className="text-[10px] text-sandrift leading-relaxed">{detail!.fixed}</p>
              <p className="text-[10px] text-sandrift leading-relaxed">{detail!.compact}</p>
            </>
          )}

          <p className="text-[10px] text-sandrift leading-relaxed">
            {overflow
              ? "本次请求因超出输入预算失败：请新开会话或清理上下文后重试。"
              : "估算值（CJK ≈ 1 token/字）；模型输出预留与计费不在其中。"}
          </p>
        </div>
      </PopoverPanel>
    </>
  );
}
