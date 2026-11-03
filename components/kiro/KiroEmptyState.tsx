"use client";

import React from "react";
import { CalendarCheck, ListChecks, BookOpen } from "lucide-react";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";
import { useAppStore } from "@/store/useAppStore";
import { KiroMark } from "@/components/kiro/KiroHeader";
import { cn } from "@/lib/utils";

/**
 * Kiro Empty State：通用建议 / Entry Context 建议二选一作为主操作区。
 * contextSuggestions 存在时隐藏通用建议（KiroChatSurface 保证两者不同时出现）。
 * Sidecar（compact）：内容略偏上（ChatGPT/Claude 式），不过度垂直居中。
 */
export function KiroEmptyState({
  onSuggestion,
  compact,
  centered = false,
  contextSuggestions,
  playIntro = false,
}: {
  onSuggestion: (text: string) => void;
  compact?: boolean;
  /** Dock 等宽屏内嵌面板：垂直居中（Sidecar 保持内容偏上） */
  centered?: boolean;
  /** Entry Context 建议节点（无消息时渲染在标题下方） */
  contextSuggestions?: React.ReactNode;
  /** Motion V1：本轮 empty generation 播放单次 intro（logo/title/subtitle/suggestions stagger） */
  playIntro?: boolean;
}) {
  const courses = useAppStore((s) => s.courses);
  const assignments = useAppStore((s) => s.assignments);
  const schedules = useAppStore((s) => s.schedules);
  const hasData = courses.length > 0 || assignments.length > 0 || schedules.length > 0;
  // P1：模式切换品牌柔切（只播 transform/opacity，logo 与标题位置零位移；首挂载不播）
  const computerEnabled = useKiroComputerStore((s) => s.computerEnabled);
  const [modeSwapping, setModeSwapping] = React.useState(false);
  const prevModeRef = React.useRef(computerEnabled);
  const swapTimerRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (prevModeRef.current === computerEnabled) return;
    prevModeRef.current = computerEnabled;
    setModeSwapping(true);
    if (swapTimerRef.current !== null) window.clearTimeout(swapTimerRef.current);
    swapTimerRef.current = window.setTimeout(() => {
      swapTimerRef.current = null;
      setModeSwapping(false);
    }, 260);
  }, [computerEnabled]);
  React.useEffect(
    () => () => {
      if (swapTimerRef.current !== null) window.clearTimeout(swapTimerRef.current);
    },
    []
  );

  // P0 产品化：有数据时只留最高频两项（此前 4 chip 挤占 hero 呼吸感；无数据新手保留 3 项发现入口）
  const suggestions = hasData
    ? [
        { icon: CalendarCheck, label: "帮我规划今天" },
        { icon: ListChecks, label: "查看最近 DDL" },
      ]
    : [
        { icon: BookOpen, label: "我该怎么开始记课程和作业？" },
        { icon: ListChecks, label: "制定一个学习计划" },
        { icon: CalendarCheck, label: "解释一个知识点" },
      ];

  return (
    <div
      data-testid="kiro-empty"
      className={cn(
        "flex-1 min-h-0 overflow-y-auto flex flex-col items-center text-center",
        centered || !compact ? "justify-center px-4 py-8" : "justify-start px-3 pt-10"
      )}
    >
      <div
        data-kiro-empty-logo
        className={cn(playIntro && "kiro-empty-logo-intro", modeSwapping && "kiro-mode-swap")}
      >
        <KiroMark size={compact ? "md" : "lg"} />
      </div>
      {/* P0 产品化：hero 问句（参考 Codex 中央大问句；单行护栏保持，不加副文案） */}
      <h2
        data-kiro-empty-title
        className={cn(
          "font-bold tracking-tight text-charcoal mt-4",
          compact ? "text-xl" : "text-[28px] md:text-[32px] leading-tight mt-5",
          playIntro && "kiro-empty-title-intro",
          modeSwapping && "kiro-mode-swap"
        )}
      >
        今天想先处理什么？
      </h2>

      <div data-kiro-empty-suggestions>
        {contextSuggestions ? (
          <div className={cn("w-full max-w-md", playIntro && "kiro-empty-suggestion-intro", compact ? "mt-5" : "mt-7")}>
            {contextSuggestions}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-7 w-full max-w-md">
            {suggestions.map((s, index) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.label}
                  data-kiro-empty-suggestion
                  style={{ "--kiro-stagger-index": index } as React.CSSProperties}
                  onClick={() => onSuggestion(s.label)}
                  className={cn(
                    "ux-press flex items-center gap-2.5 p-3 bg-surface border border-line rounded-xl text-left hover:bg-alabaster hover:border-line-strong transition-colors duration-[var(--motion-fast)] group",
                    playIntro && "kiro-empty-suggestion-intro"
                  )}
                >
                  <Icon className="w-4 h-4 text-sandrift group-hover:text-charcoal shrink-0" />
                  <span className="block text-xs font-bold text-charcoal truncate">{s.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
