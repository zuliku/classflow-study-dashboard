"use client";

import React from "react";
import { PopoverPanel } from "@/components/ui/Popover";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import {
  ContextUsageSnapshot,
  buildContextUsageCompactView,
  formatContextUsageLabel,
  resolveContextUsageTone,
} from "@/lib/ai/contextBudget/usage";
import { cn } from "@/lib/utils";

/** Ring 几何（viewBox 24；stroke 2.5，留出圆角端点空间） */
const RING_SIZE = 20;
const RING_STROKE = 2.5;
const RING_RADIUS = (24 - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** 弹窗宽度（w-56）与 ring 点击区宽度：用于把弹窗精确居中对齐到 ring 中心 */
const PANEL_WIDTH = 224;
const RING_BUTTON_WIDTH = { compact: 36, regular: 28 } as const;

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
 * - 只展示 server 返回的估算快照；不改变任何预算 / 压缩 / 路由行为；
 * - 二级弹窗保持 Codex-style 三段式事实行（有官方模型窗口 → 窗口为分母；否则 → 输入预算），
 *   不做口径解释、不列内部固定开销；
 * - 无快照 → 中性空心环 + 单行提示；达到压缩阈值 → warning；超出预算 / 失败 → danger。
 */
export function KiroComposerContextUsage({
  snapshot,
  overflow,
  compact,
  windowTokens,
  open,
  onOpenChange,
}: {
  snapshot: ContextUsageSnapshot | null;
  /** 本 Turn 因超出输入预算失败（来自真实 error code，不猜测） */
  overflow?: boolean;
  compact?: boolean;
  /** 官方可核实的模型窗口（Phase 2；缺失 → 以 ClassFlow 输入预算为分母） */
  windowTokens?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const tone = overflow ? "danger" : resolveContextUsageTone(snapshot);
  const label = formatContextUsageLabel(snapshot, { overflow });
  const view = buildContextUsageCompactView(snapshot, windowTokens, { overflow });

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
              className="transition-[stroke-dasharray] duration-[var(--motion-data)] ease-[var(--ease-standard)]"
            />
          )}
        </svg>
      </button>

      {/* 弹窗锚点：位于 ring 中心（inline style 保证 containing block，不依赖祖先布局）；
          面板以固定宽度居中于锚点 → 与下方状态环精确对齐 */}
      <span
        aria-hidden="true"
        data-testid="kiro-composer-context-usage-anchor"
        className="pointer-events-none"
        style={{
          position: "absolute",
          left: (compact ? RING_BUTTON_WIDTH.compact : RING_BUTTON_WIDTH.regular) / 2,
          top: 0,
          width: 0,
          height: 0,
        }}
      >
        <PopoverPanel
          open={open}
          placement="anchor"
          motionProfile="kiro"
          className="pointer-events-auto w-56 max-w-[calc(100vw-24px)]"
          style={{ left: "50%", bottom: "100%", marginLeft: -(PANEL_WIDTH / 2), marginBottom: 6 }}
        >
          <div
            className="px-3 py-2 space-y-0.5"
            data-testid="kiro-composer-context-usage-menu"
            role="dialog"
            aria-label="上下文占用"
          >
            {!view ? (
              <>
                <p className="text-xs font-bold text-charcoal">上下文占用</p>
                <p className="text-[11px] text-sandrift">发送第一条消息后显示</p>
              </>
            ) : (
              <>
                <p className="text-xs font-bold text-charcoal">{view.title}</p>
                <p className="text-[11px] font-semibold text-charcoal tabular-nums">{view.percentLine}</p>
                <p className="text-[11px] text-sandrift tabular-nums">{view.tokensLine}</p>
                <DisclosureRegion open={!!view.compactedLine || !!view.overflowLine}>
                  {view.compactedLine && (
                    <p className="text-[11px] text-warning">{view.compactedLine}</p>
                  )}
                  {view.overflowLine && <p className="text-[11px] text-danger">{view.overflowLine}</p>}
                </DisclosureRegion>
              </>
            )}
          </div>
        </PopoverPanel>
      </span>
    </>
  );
}
