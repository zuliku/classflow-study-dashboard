"use client";

import React, { useState } from "react";
import { Moon, SendHorizontal, Sparkles, Sun, X } from "lucide-react";
import {
  KiroModelSelector,
  type KiroModelOption,
} from "@/components/kiro/composer/KiroModelSelector";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import { cn } from "@/lib/utils";

/**
 * Model Selector Demo（dev-only）：
 * 访问 `/?model-selector-demo=1` 打开。独立于 activeTab / Store，只用于预览
 * 玻璃面板、动态背景模糊与 Framer Motion 进退场；production 永不渲染。
 *
 * z-index：demo 85 < scrim 90 < panel 110 —— 面板 Portal 到 body 后仍位于演示之上。
 */

const DEMO_MODELS: KiroModelOption[] = [
  { value: "gpt-5.6-sol", label: "GPT-5.6 Sol", vendor: "openai" },
  { value: "claude-haiku-5-5", label: "Claude Haiku 5.5", vendor: "anthropic" },
  { value: "gemini-4-argon", label: "Gemini 4 Argon", vendor: "google" },
  { value: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", vendor: "deepseek" },
  { value: "grok-4.7", label: "Grok 4.7", vendor: "xai" },
  { value: "glm-5.3-flash", label: "GLM 5.3 Flash", vendor: "zai" },
  { value: "kimi-k3.1-pro", label: "Kimi K3.1 Pro", vendor: "kimi" },
  { value: "qwen3.8-max", label: "Qwen3.8 Max", vendor: "qwen" },
  { value: "minimax-m3.1-flash", label: "MiniMax M3.1 Flash", vendor: "minimax" },
  { value: "longcat-2.0", label: "LongCat 2.0", vendor: "longcat" },
];

export function ModelSelectorDemo() {
  const [visible, setVisible] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("model-selector-demo") === "1"
  );
  const [appearance, setAppearance] = useState<"light" | "dark">("light");
  const [selectedId, setSelectedId] = useState("gpt-5.6-sol");
  const [selectorOpen, setSelectorOpen] = useState(false);
  const reducedMotion = useEffectiveReducedMotion();

  if (process.env.NODE_ENV !== "development" || !visible) return null;

  const selected = DEMO_MODELS.find((m) => m.value === selectedId) ?? DEMO_MODELS[0];
  const dark = appearance === "dark";

  const closeDemo = () => {
    setSelectorOpen(false);
    setVisible(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("model-selector-demo");
    window.history.replaceState({}, "", url);
  };

  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 top-[var(--titlebar-h)] z-[85] flex flex-col overflow-hidden",
        dark ? "bg-[#1b1b1b] text-[#f4f2ef]" : "bg-[#F7F5F5] text-charcoal"
      )}
      data-testid="model-selector-demo"
    >
      <div
        className={cn(
          "flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2.5",
          dark ? "border-white/10" : "border-line-soft"
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-lg",
              dark ? "bg-white/10" : "bg-white/70 border border-line-soft"
            )}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-bold">Model Selector · Glass</p>
            <p className={cn("truncate text-[10px]", dark ? "text-white/50" : "text-sandrift")}>
              180ms enter / 110ms exit · {reducedMotion ? "reduced motion" : "full motion"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setAppearance((v) => (v === "light" ? "dark" : "light"))}
            aria-label={`切换到${dark ? "浅色" : "深色"}主题`}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-bold transition-colors",
              dark
                ? "bg-white/10 text-white/80 hover:bg-white/15 hover:text-white"
                : "border border-line bg-white/70 text-satin-grey hover:text-charcoal"
            )}
          >
            {dark ? <Sun className="h-3.5 w-3.5" aria-hidden="true" /> : <Moon className="h-3.5 w-3.5" aria-hidden="true" />}
            {dark ? "浅色" : "深色"}
          </button>
          <button
            type="button"
            onClick={closeDemo}
            aria-label="关闭演示"
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
              dark
                ? "text-white/60 hover:bg-white/10 hover:text-white"
                : "text-sandrift hover:bg-white/70 hover:text-charcoal"
            )}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col justify-center gap-4 px-4 py-6 sm:px-6">
        <div className="space-y-3">
          <div
            className={cn(
              "max-w-[78%] rounded-2xl rounded-bl-md px-4 py-3 text-xs leading-relaxed shadow-subtle",
              dark ? "bg-white/[0.08] text-white/80" : "bg-white/80 text-satin-grey border border-line-soft"
            )}
          >
            帮我把这周的复习计划按考试优先级重新排一下，晚上留出两小时做真题。
          </div>
          <div
            className={cn(
              "ml-auto max-w-[82%] rounded-2xl rounded-br-md px-4 py-3 text-xs leading-relaxed shadow-subtle",
              dark ? "bg-[#2c2c2c] text-white/85" : "bg-[#F0EBE1] text-charcoal"
            )}
          >
            可以。周三的计量经济学考试优先级最高，我把 20:00–22:00 留给真题；周四上午复习错题，周五只做轻量回顾。
          </div>
          <div
            className={cn(
              "max-w-[70%] rounded-2xl rounded-bl-md px-4 py-3 text-xs leading-relaxed shadow-subtle",
              dark ? "bg-white/[0.08] text-white/70" : "bg-white/70 text-satin-grey border border-line-soft"
            )}
          >
            现在用 <span className="font-bold text-current">「{selected.label}」</span> 继续安排。
          </div>
        </div>

        <div
          className={cn(
            "rounded-2xl border p-3 shadow-card backdrop-blur-sm",
            dark ? "border-white/10 bg-white/[0.06]" : "border-line bg-white/65"
          )}
        >
          <p className={cn("mb-2 px-1 text-[10px] font-semibold", dark ? "text-white/45" : "text-sandrift")}>
            点击模型入口，观察背景模糊 / 玻璃面板 / 列表 active 位移
          </p>
          <div className="flex items-center justify-between gap-2">
            <KiroModelSelector
              modelOptions={DEMO_MODELS}
              selectedModelId={selectedId}
              activeModelName={selected.label}
              activeModelVendor={selected.vendor}
              onSelectModel={setSelectedId}
              onOpenSettings={() => setSelectorOpen(false)}
              open={selectorOpen}
              onOpenChange={setSelectorOpen}
              appearance={appearance}
            />
            <button
              type="button"
              aria-label="发送（演示）"
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                dark ? "bg-white text-black" : "bg-charcoal text-white"
              )}
            >
              <SendHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
