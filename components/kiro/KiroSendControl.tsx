"use client";

import React from "react";
import { ArrowUp, Loader2, Square } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Kiro Motion System V1 —— Send Control（单一 36×36 control）。
 * 三分支（Send / Preparing / Stop）合并为同一 button DOM：
 * - inFlight → stop（Square，可点击）
 * - preparing → preparing（Loader，disabled）
 * - canSend → ready（Arrow，可点击）
 * - else → idle-disabled（Arrow，disabled）
 * Icon layers absolute center 交叉淡化（exit 60–80ms / enter 90–110ms），button 不 remount。
 */
export function KiroSendControl({
  canSend,
  preparing,
  inFlight,
  onSend,
  onStop,
  disabledReason,
  onCancelPreparing,
}: {
  canSend: boolean;
  preparing: boolean;
  inFlight: boolean;
  onSend: () => void;
  onStop: () => void;
  /** 禁用原因（idle 态的 title/aria-label；此前恒为“发送”，用户不知为何点不动） */
  disabledReason?: string | null;
  /** 准备中取消（preparing 卡住可打断；缺失则 preparing 保持纯 loading） */
  onCancelPreparing?: () => void;
}) {
  const state: "stop" | "preparing" | "ready" | "idle" = inFlight
    ? "stop"
    : preparing
      ? "preparing"
      : canSend
        ? "ready"
        : "idle";

  // P0：准备中可取消（此前 preparing 转菊花无处可点，卡住只能干等）
  const cancellablePreparing = state === "preparing" && !!onCancelPreparing;
  const disabled = state === "idle" || (state === "preparing" && !onCancelPreparing);
  const idleLabel = state === "idle" && disabledReason ? `发送（${disabledReason}）` : "发送";
  const ariaLabel =
    state === "stop"
      ? "停止生成"
      : cancellablePreparing
        ? "取消准备"
        : state === "preparing"
          ? "正在准备"
          : idleLabel;

  return (
    <button
      type="button"
      onClick={() => {
        if (state === "stop") onStop();
        else if (cancellablePreparing) onCancelPreparing?.();
        else if (state === "ready") onSend();
      }}
      disabled={disabled}
      aria-label={ariaLabel}
      title={ariaLabel}
      data-send-state={state}
      className={cn(
        // P0 产品化：idle 为描边幽灵态（此前 charcoal 40% 实心，与可点态过近）
        "ux-press relative w-9 h-9 shrink-0 rounded-full transition-[opacity,background-color] duration-[var(--kiro-motion-control,var(--motion-fast))] ease-[var(--ease-standard)]",
        state === "idle"
          ? "bg-transparent border border-line-strong text-sandrift cursor-not-allowed"
          : "bg-charcoal text-white hover:bg-black",
        // Motion V1：canSend false→true 激活（opacity .4→1 + scale .96→1，只响应 boolean 状态变化）
        state === "ready" && "kiro-send-activate"
      )}
    >
      {/* 三个 icon layer 绝对居中；crossfade 由 data-send-state 驱动 */}
      <span
        data-send-icon="arrow"
        aria-hidden="true"
        className={cn(
          "absolute inset-0 flex items-center justify-center",
          "transition-[opacity,transform] duration-[var(--kiro-motion-control,var(--motion-snap))] ease-[var(--ease-standard)]",
          state === "stop" || state === "preparing"
            ? "opacity-0 scale-[0.82] pointer-events-none"
            : "opacity-100 scale-100"
        )}
      >
        <ArrowUp className="w-4 h-4" />
      </span>
      <span
        data-send-icon="loader"
        aria-hidden="true"
        className={cn(
          "absolute inset-0 flex items-center justify-center",
          "transition-[opacity,transform] duration-[var(--kiro-motion-control,var(--motion-snap))] ease-[var(--ease-standard)]",
          state === "preparing" && !cancellablePreparing
            ? "opacity-100 scale-100"
            : "opacity-0 scale-[0.82] pointer-events-none"
        )}
      >
        <Loader2 className="w-4 h-4 animate-spin" />
      </span>
      <span
        data-send-icon="stop"
        aria-hidden="true"
        className={cn(
          "absolute inset-0 flex items-center justify-center",
          "transition-[opacity,transform] duration-[var(--kiro-motion-control,var(--motion-snap))] ease-[var(--ease-standard)]",
          state === "stop" || cancellablePreparing
            ? "opacity-100 scale-100"
            : "opacity-0 scale-[0.82] pointer-events-none"
        )}
      >
        <Square className="w-3.5 h-3.5 fill-current" />
      </span>
    </button>
  );
}
