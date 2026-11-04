"use client";

import React, { useState } from "react";
import { ArrowUp, MessageCircleQuestion } from "lucide-react";
import {
  buildAskUserAnswerText,
  KiroUserQuestion,
} from "@/lib/ai/agent/ask";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import { cn } from "@/lib/utils";

/**
 * Kiro Agent Ask Card（Agent Superpowers V1）：
 * - 只展示真实 ask_user Tool Result 归一化后的问题；
 * - 只允许最后一条 assistant message 回答（历史只读）；
 * - 选择/自由输入作为下一条普通 user message 发送，再走正常 Agent Turn；
 *   不直接执行任何写操作，也不绕过确认。
 */
export function KiroAskUserCard({
  question,
  answerable,
  onAnswer,
}: {
  question: KiroUserQuestion;
  answerable: boolean;
  /** 测试注入；默认使用当前 Kiro Session 的 chat.send */
  onAnswer?: (text: string) => Promise<boolean> | boolean | void;
}) {
  const session = useKiroSession();
  const [freeform, setFreeform] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const waitingTurn = session.chat.turnInFlight;
  const disabled = !answerable || sent || sending || waitingTurn;

  const submit = async (text: string | null) => {
    if (!text || disabled) return;
    setSending(true);
    try {
      const send = onAnswer ?? session.chat.send;
      const result = await send(text);
      if (result === false) {
        setSent(false);
        return;
      }
      setSent(true);
      setFreeform("");
    } catch {
      setSent(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      data-testid="kiro-ask-user"
      aria-label="Kiro 需要你确认"
      className={cn(
        "rounded-2xl border border-line bg-surface px-3.5 py-3 space-y-2.5 min-w-0",
        !answerable && "opacity-75"
      )}
    >
      <div className="flex items-center gap-1.5">
        <MessageCircleQuestion className="w-3.5 h-3.5 text-sandrift shrink-0" aria-hidden="true" />
        <p className="text-[10px] font-bold uppercase tracking-wider text-sandrift">
          {question.header || "需要你确认"}
        </p>
      </div>
      <p className="text-xs font-semibold text-charcoal leading-relaxed break-words">
        {question.question}
      </p>

      <div className="space-y-1.5">
        {question.options.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            onClick={() => void submit(buildAskUserAnswerText(question, option.id))}
            className={cn(
              "w-full text-left rounded-xl border border-line bg-[#F7F5F5] px-3 py-2 transition-colors",
              disabled
                ? "cursor-not-allowed opacity-60"
                : "hover:border-line-strong hover:bg-alabaster ux-press"
            )}
          >
            <span className="block text-[11px] font-bold text-charcoal">{option.label}</span>
            {option.description && (
              <span className="mt-0.5 block text-[10px] leading-relaxed text-satin-grey">
                {option.description}
              </span>
            )}
          </button>
        ))}
      </div>

      {question.allowFreeform && (
        <div className="flex items-center gap-1.5">
          <input
            value={freeform}
            onChange={(e) => setFreeform(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit(buildAskUserAnswerText(question, undefined, freeform));
              }
            }}
            disabled={disabled}
            aria-label="自定义回答"
            placeholder="其他回答…"
            className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-white px-2.5 text-[11px] text-charcoal placeholder:text-sandrift focus:outline-none focus:border-charcoal disabled:opacity-60"
          />
          <button
            type="button"
            aria-label="发送回答"
            disabled={disabled || !freeform.trim()}
            onClick={() => void submit(buildAskUserAnswerText(question, undefined, freeform))}
            className="w-8 h-8 shrink-0 rounded-full bg-charcoal text-white flex items-center justify-center disabled:opacity-40 transition-opacity"
          >
            <ArrowUp className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {!answerable && (
        <p className="text-[10px] text-sandrift">此问题已回答或已过期。</p>
      )}
      {answerable && waitingTurn && !sent && (
        <p className="text-[10px] text-sandrift">等待本轮结束…</p>
      )}
      {sent && answerable && (
        <p className="text-[10px] text-sandrift">已发送，等待 Kiro 继续。</p>
      )}
    </section>
  );
}
