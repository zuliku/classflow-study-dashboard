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
}: {
  canSend: boolean;
  preparing: boolean;
  inFlight: boolean;
  onSend: () => void;
  onStop: () => void;
}) {
  const state: "stop" | "preparing" | "ready" | "idle" = inFlight
    ? "stop"
    : preparing
      ? "preparing"
      : canSend
        ? "ready"
        : "idle";

  const disabled = state === "preparing" || state === "idle";
  const ariaLabel = state === "stop" ? "停止生成" : state === "preparing" ? "正在准备" : "发送";

  return (
    <button
      type="button"
      onClick={() => {
        if (state === "stop") onStop();
        else if (state === "ready") onSend();
      }}
      disabled={disabled}
      aria-label={ariaLabel}
      title={ariaLabel}
      data-send-state={state}
      className={cn(
        "ux-press relative w-9 h-9 shrink-0 rounded-full bg-charcoal text-white",
        state === "idle" ? "opacity-40 cursor-not-allowed" : "hover:bg-black transition-colors",
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
          "transition-[opacity,transform] duration-[90ms] ease-[var(--ease-standard)]",
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
          "transition-[opacity,transform] duration-[90ms] ease-[var(--ease-standard)]",
          state === "preparing" ? "opacity-100 scale-100" : "opacity-0 scale-[0.82] pointer-events-none"
        )}
      >
        <Loader2 className="w-4 h-4 animate-spin" />
      </span>
      <span
        data-send-icon="stop"
        aria-hidden="true"
        className={cn(
          "absolute inset-0 flex items-center justify-center",
          "transition-[opacity,transform] duration-[90ms] ease-[var(--ease-standard)]",
          state === "stop" ? "opacity-100 scale-100" : "opacity-0 scale-[0.82] pointer-events-none"
        )}
      >
        <Square className="w-3.5 h-3.5 fill-current" />
      </span>
    </button>
  );
}
