"use client";

import React from "react";
import { Eye, X } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { KiroAgentTask, KiroComputerChange } from "@/lib/ai/computer/task";

const REVIEW_MAX_CHARS = 2000;

/**
 * Computer Change Review Dialog（Part 3）：
 * - text-patch：真实 exact edits（before → after；每侧最多 2000 字符展示）
 * - create：文件名 / workspace / root / size + 最多 2000 字符 preview
 * - document：Document IR / runtime 结构事实（不做 binary diff）
 * 绝不显示 native path / adapterRef / handle / bytes。
 */
export function KiroChangeReviewDialog({
  task,
  onOpenChange,
}: {
  task: KiroAgentTask | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = task !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      overlayId="kiro-change-review"
      stackZ={80}
      onEscapeKeyDown={() => onOpenChange(false)}
    >
      <div data-testid="kiro-change-review-dialog" className="p-4 space-y-3.5 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-full bg-pastel-mint/60 flex items-center justify-center shrink-0">
            <Eye className="w-4 h-4 text-charcoal" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-charcoal">更改详情</h2>
            <p className="text-[11px] text-sandrift truncate">{task?.title}</p>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            aria-label="关闭"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-sandrift hover:text-charcoal hover:bg-alabaster transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {task && (
          <div className="space-y-3">
            {task.changes.length === 0 && (
              <p className="text-[11px] text-satin-grey">本轮没有文件更改。</p>
            )}
            {task.changes.map((c) => (
              <ChangeReviewBlock key={c.id} change={c} />
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function ChangeReviewBlock({ change }: { change: KiroComputerChange }) {
  const meta = [
    change.workspaceLabel,
    change.rootLabel,
    change.size !== undefined ? formatSize(change.size) : undefined,
    change.changeCount !== undefined ? `${change.changeCount} 处修改` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="rounded-xl border border-line bg-[#F7F5F5] p-3 space-y-2">
      <p className="text-xs font-bold text-charcoal">
        {change.operation === "create" ? "创建" : "修改"} · {change.displayName}
      </p>
      {meta && <p className="text-[10px] text-sandrift">{meta}</p>}

      {change.review.kind === "create" && change.review.preview !== undefined && (
        <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-surface border border-line p-2.5 text-[10px] text-satin-grey leading-relaxed">
          {clampPreview(change.review.preview)}
        </pre>
      )}

      {change.review.kind === "text-patch" && (
        <div className="space-y-2">
          {change.review.edits.map((edit, i) => (
            <div key={i} className="rounded-lg border border-line bg-surface p-2.5 space-y-1.5">
              <p className="text-[10px] font-bold text-danger">修改前</p>
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[10px] text-satin-grey leading-relaxed">
                {clampPreview(edit.before)}
              </pre>
              <p className="text-[10px] font-bold text-success">修改后</p>
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[10px] text-satin-grey leading-relaxed">
                {clampPreview(edit.after)}
              </pre>
            </div>
          ))}
        </div>
      )}

      {change.review.kind === "document" && (
        <div className="rounded-lg border border-line bg-surface p-2.5 space-y-1.5">
          {change.review.title && (
            <p className="text-[11px] font-bold text-charcoal">{change.review.title}</p>
          )}
          <ul className="space-y-0.5 text-[10px] text-satin-grey">
            <li>章节标题：{change.review.headings}</li>
            <li>段落：{change.review.paragraphs}</li>
            <li>列表：{change.review.lists}</li>
            <li>表格：{change.review.tables}</li>
            <li>代码块：{change.review.codeBlocks}</li>
            <li>字符数：{change.review.characters}</li>
          </ul>
        </div>
      )}
    </div>
  );
}

function clampPreview(text: string): string {
  if (text.length <= REVIEW_MAX_CHARS) return text;
  return `${text.slice(0, REVIEW_MAX_CHARS)}\n…（已截断）`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
