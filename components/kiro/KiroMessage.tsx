"use client";

import React from "react";
import { KiroMark } from "@/components/kiro/KiroHeader";

/**
 * Kiro 回复 Message：不做左右对话气泡，采用 Kiro mark + 正常文档流。
 * 为后续长回答 / cards / tool traces / context chips 预留空间（children 可承载结构化内容）。
 */
export function KiroMessage({
  content,
  children,
  testid,
}: {
  content?: string;
  children?: React.ReactNode;
  testid?: string;
}) {
  return (
    <div className="flex gap-3" data-testid={testid ?? "kiro-message"}>
      <KiroMark size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        {content && (
          <div className="text-xs leading-relaxed text-charcoal whitespace-pre-wrap">{content}</div>
        )}
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
