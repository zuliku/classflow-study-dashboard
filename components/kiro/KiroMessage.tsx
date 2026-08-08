"use client";

import React from "react";
import { KiroMark } from "@/components/kiro/KiroHeader";
import { KiroMarkdown } from "@/components/kiro/KiroMarkdown";

/**
 * Kiro 回复 Message：Kiro mark + 文档流（非左右气泡）。
 * 内容经 KiroMarkdown 渲染（真实 Markdown，不显示原始符号）。
 * 流式光标在 Markdown 渲染器外部显示，不拼进 Markdown source（避免破坏 table/code/bold）。
 */
export function KiroMessage({
  content,
  streaming,
  children,
  testid,
}: {
  content?: string;
  /** 流式进行中：末尾显示克制状态光标 */
  streaming?: boolean;
  children?: React.ReactNode;
  testid?: string;
}) {
  return (
    <div className="flex gap-3" data-testid={testid ?? "kiro-message"}>
      <KiroMark size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        {content ? (
          <>
            <KiroMarkdown content={content} />
            {streaming && (
              <span
                aria-hidden="true"
                className="inline-block w-[2px] h-3.5 bg-sandrift align-middle animate-pulse"
              />
            )}
          </>
        ) : streaming ? (
          <div className="flex items-center gap-1.5 pt-1" aria-label="Kiro 正在回复">
            <span className="w-1.5 h-1.5 rounded-full bg-sandrift animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-sandrift animate-pulse [animation-delay:120ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-sandrift animate-pulse [animation-delay:240ms]" />
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

/** 用户 Message：轻量 soft bubble，右对齐（纯文本） */
export function KiroUserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end" data-testid="kiro-user-message">
      <div className="max-w-[85%] bg-alabaster border border-line rounded-2xl rounded-br-md px-4 py-2.5 text-xs font-medium text-charcoal whitespace-pre-wrap leading-relaxed">
        {content}
      </div>
    </div>
  );
}
