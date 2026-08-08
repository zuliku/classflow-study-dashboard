"use client";

import React from "react";
import { KiroMark } from "@/components/kiro/KiroHeader";

/**
 * Kiro 回复 Message：Kiro mark + 正常文档流（非左右气泡），
 * 为长回答 / cards / tool traces / context chips 预留结构化内容区。
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
          <div className="text-xs leading-relaxed text-charcoal whitespace-pre-wrap">
            {content}
            {streaming && (
              <span
                aria-hidden="true"
                className="inline-block w-[2px] h-3.5 ml-0.5 bg-sandrift align-middle animate-pulse"
              />
            )}
          </div>
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

/** 用户 Message：轻量 soft bubble，右对齐 */
export function KiroUserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end" data-testid="kiro-user-message">
      <div className="max-w-[85%] bg-alabaster border border-line rounded-2xl rounded-br-md px-4 py-2.5 text-xs font-medium text-charcoal whitespace-pre-wrap leading-relaxed">
        {content}
      </div>
    </div>
  );
}
