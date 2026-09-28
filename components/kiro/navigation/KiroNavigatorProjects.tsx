"use client";

import React from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { KIRO_PROJECT_ICON } from "@/components/kiro/kiroProjectIcon";
import { KiroProjectRecord } from "@/lib/ai/projects/types";
import { formatHistoryTime } from "@/lib/ai/history/sanitize";
import { cn } from "@/lib/utils";

/**
 * Kiro Navigator — 项目列表单元（V1）。
 * 供 Navigator Home / 搜索结果复用；行内不嵌套交互控件：
 * 「打开项目」为真实 button，编辑 / 删除为相邻 button（hover / focus-within 显现）。
 */
export function KiroNavigatorProjectRow({
  project,
  isCurrent,
  disabled,
  onOpen,
  onEdit,
  onDelete,
}: {
  project: KiroProjectRecord;
  /** meta.conversationProjectId === project.id（当前 Session 归属项目） */
  isCurrent: boolean;
  disabled?: boolean;
  onOpen: (projectId: string) => void;
  onEdit: (project: KiroProjectRecord) => void;
  onDelete: (project: KiroProjectRecord) => void;
}) {
  return (
    <div
      className={cn(
        "group/project flex items-center rounded-lg transition-colors",
        isCurrent ? "bg-pastel-mint/50" : "hover:bg-alabaster/70"
      )}
    >
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          onOpen(project.id);
        }}
        disabled={disabled}
        aria-label={`打开项目 ${project.name}`}
        aria-current={isCurrent ? "true" : undefined}
        className={cn(
          "min-w-0 flex-1 flex items-center gap-2 px-2 h-9 text-left",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <span className="w-6 h-6 shrink-0 flex items-center justify-center rounded-lg bg-alabaster text-sandrift">
          <KIRO_PROJECT_ICON className="w-3.5 h-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-semibold text-charcoal truncate">{project.name}</span>
            {isCurrent && (
              <span className="shrink-0 text-[9px] font-bold text-charcoal bg-pastel-mint/70 rounded-full px-1.5 py-0.5">
                当前
              </span>
            )}
          </span>
          <span className="block text-[10px] text-sandrift truncate">
            {[project.description, formatHistoryTime(project.updatedAt)].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>
      <span className="flex items-center gap-0.5 pr-1 shrink-0 opacity-0 group-hover/project:opacity-100 group-focus-within/project:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={() => onEdit(project)}
          aria-label={`编辑项目 ${project.name}`}
          className="p-1 rounded-md text-sandrift hover:bg-white/70 hover:text-charcoal transition-colors"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(project)}
          aria-label={`删除项目 ${project.name}`}
          className="p-1 rounded-md text-sandrift hover:bg-white/70 hover:text-danger transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </span>
    </div>
  );
}

/** 区块标题（项目 / 最近）：大写微标题（uppercase + tracking），与内容字重/颜色拉开层级 */
export function KiroNavigatorSectionHeader({
  label,
  action,
}: {
  label: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-1 px-1.5 pt-1 pb-1">
      <p className="text-[10px] font-bold uppercase tracking-wider text-sandrift">{label}</p>
      {action}
    </div>
  );
}

/** 「＋ 新建项目」行（项目区块底部；与列表行同密度） */
export function KiroNavigatorCreateProjectRow({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="新建项目"
      className="w-full flex items-center gap-2 px-2 h-8 rounded-lg text-[11px] font-semibold text-sandrift hover:bg-alabaster/70 hover:text-charcoal transition-colors"
    >
      <Plus className="w-3.5 h-3.5" />
      新建项目
    </button>
  );
}
