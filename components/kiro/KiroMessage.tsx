"use client";

import React from "react";
import { FileText, Image as ImageIcon } from "lucide-react";
import { KiroMark } from "@/components/kiro/KiroHeader";
import { KiroMarkdown } from "@/components/kiro/KiroMarkdown";
import { KiroAttachmentView } from "@/lib/ai/attachments/types";
import { cn } from "@/lib/utils";

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

/** 用户 Message：轻量 soft bubble，右对齐（纯文本 + 附件 chips，不显示提取全文） */
export function KiroUserMessage({
  content,
  attachments,
}: {
  content: string;
  attachments?: KiroAttachmentView[];
}) {
  return (
    <div className="flex justify-end" data-testid="kiro-user-message">
      <div className="max-w-[85%] flex flex-col items-end gap-1.5">
        {attachments && attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {attachments.map((a) => {
              const Icon = a.kind === "image" ? ImageIcon : FileText;
              return (
                <span
                  key={a.id}
                  data-testid="kiro-sent-attachment"
                  className="inline-flex items-center gap-1.5 pl-2 pr-2 h-7 rounded-lg bg-surface border border-line text-[11px] font-semibold text-satin-grey"
                >
                  <Icon className="w-3 h-3 text-sandrift shrink-0" />
                  <span className={cn("truncate max-w-[140px]")}>{a.name}</span>
                </span>
              );
            })}
          </div>
        )}
        <div className="bg-alabaster border border-line rounded-2xl rounded-br-md px-4 py-2.5 text-xs font-medium text-charcoal whitespace-pre-wrap leading-relaxed">
          {content}
        </div>
      </div>
    </div>
  );
}
