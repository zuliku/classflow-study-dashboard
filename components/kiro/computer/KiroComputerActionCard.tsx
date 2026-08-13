"use client";

import React from "react";
import { CheckCircle2, FileText, FileType2, FolderPlus, PencilLine } from "lucide-react";
import { ComputerActionFact } from "@/lib/ai/computer/types";

/** Computer mutation 真实事实 Action Card（Part 2；只展示 runtime 验证结果） */
export function KiroComputerActionCard({ fact }: { fact: ComputerActionFact }) {
  const isDocument = fact.resourceType === "document";
  const isDirectory = fact.resourceType === "directory";
  const Icon = isDirectory ? FolderPlus : isDocument ? FileType2 : fact.operation === "modify" ? PencilLine : FileText;

  const title =
    isDirectory
      ? "已创建目录"
      : isDocument
        ? fact.operation === "modify"
          ? "已修改文档"
          : "已创建文档"
        : fact.operation === "modify"
          ? "已修改文件"
          : "已创建文件";

  const meta = [
    fact.workspaceLabel && fact.rootLabel ? `${fact.workspaceLabel} / ${fact.rootLabel}` : undefined,
    fact.format ? (fact.format === "docx" ? "Word" : "Markdown") : undefined,
    fact.size !== undefined ? formatSize(fact.size) : undefined,
    fact.changeCount !== undefined ? `${fact.changeCount} 处精确修改` : undefined,
    "已验证",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      data-testid="kiro-computer-action-card"
      className="flex items-start gap-2.5 rounded-2xl border border-line bg-[#F7F5F5] p-3"
    >
      <span className="w-6 h-6 rounded-full bg-pastel-mint/60 flex items-center justify-center shrink-0">
        <Icon className="w-3.5 h-3.5 text-charcoal" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-charcoal">
          <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" aria-hidden="true" />
          {title}
        </p>
        <p className="text-xs font-bold text-charcoal truncate mt-0.5">{fact.displayName}</p>
        <p className="text-[10px] text-sandrift mt-0.5 truncate">{meta}</p>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
