"use client";

import React from "react";
import { KIRO_PROJECT_ICON } from "@/components/kiro/kiroProjectIcon";
import { KiroProjectRecord } from "@/lib/ai/projects/types";
import { KiroConversationRecord } from "@/lib/ai/history/types";
import { formatHistoryTime } from "@/lib/ai/history/sanitize";
import { filterConversations } from "@/lib/ai/history/search";
import { cn } from "@/lib/utils";

const MAX_PROJECT_RESULTS = 6;
const MAX_THREAD_RESULTS = 10;

/**
 * Kiro Navigator — 统一搜索（V1）：本地过滤 Projects + Conversation titles。
 * 不引入全文搜索 / embedding / 新数据库；搜索属于 Navigation，不进入模型 Context。
 */
export function KiroNavigatorSearch({
  query,
  projects,
  threads,
  disabled,
  onOpenProject,
  onOpenThread,
}: {
  query: string;
  projects: KiroProjectRecord[];
  threads: KiroConversationRecord[];
  disabled?: boolean;
  onOpenProject: (projectId: string) => void;
  onOpenThread: (id: string) => void;
}) {
  const q = query.trim().toLowerCase();
  const matchedProjects = q
    ? projects.filter(
        (project) =>
          project.name.toLowerCase().includes(q) ||
          (project.description ?? "").toLowerCase().includes(q)
      )
    : [];
  // P1：标题 + 摘要 + 正文（此前只搜标题，记得内容搜不到）
  const matchedWithKind = q ? filterConversations(threads, q) : [];
  const matchedThreads = matchedWithKind.map((m) => m.thread);
  const matchById = new Map(matchedWithKind.map((m) => [m.thread.id, m.match]));

  if (matchedProjects.length === 0 && matchedThreads.length === 0) {
    return (
      <div className="px-1.5 py-6 text-center" data-testid="kiro-navigator-search-empty">
        <p className="text-[11px] text-sandrift">未找到匹配的项目或对话</p>
      </div>
    );
  }

  return (
    <div className="space-y-1" data-testid="kiro-navigator-search-results">
      {matchedProjects.length > 0 && (
        <section aria-label="项目搜索结果">
          <p className="text-[10px] font-bold uppercase tracking-wider text-sandrift px-1.5 pt-1 pb-1">项目</p>
          <div className="space-y-0.5">
            {matchedProjects.slice(0, MAX_PROJECT_RESULTS).map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => {
                  if (disabled) return;
                  onOpenProject(project.id);
                }}
                disabled={disabled}
                aria-label={`打开项目 ${project.name}`}
                className={cn(
                  "w-full flex items-center gap-2 px-2 h-9 rounded-lg text-left hover:bg-alabaster/70 transition-colors",
                  disabled && "opacity-50 cursor-not-allowed"
                )}
              >
                <span className="w-6 h-6 shrink-0 flex items-center justify-center rounded-lg bg-alabaster text-sandrift">
                  <KIRO_PROJECT_ICON className="w-3.5 h-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-charcoal truncate">{project.name}</span>
                  <span className="block text-[10px] text-sandrift truncate">
                    {project.description ?? formatHistoryTime(project.updatedAt)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {matchedThreads.length > 0 && (
        <section aria-label="对话搜索结果">
          <p className="text-[10px] font-bold uppercase tracking-wider text-sandrift px-1.5 pt-1 pb-1">
            对话 · 标题/摘要/正文
          </p>
          <div className="space-y-0.5">
            {matchedThreads.slice(0, MAX_THREAD_RESULTS).map((thread) => {
              const match = matchById.get(thread.id);
              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => {
                    if (disabled) return;
                    onOpenThread(thread.id);
                  }}
                  disabled={disabled}
                  aria-label={`打开对话 ${thread.title}`}
                  className={cn(
                    "w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-left hover:bg-alabaster/70 transition-colors",
                    disabled && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-charcoal truncate">{thread.title}</span>
                    {match && match.kind !== "title" && match.excerpt && (
                      <span className="block text-[10px] text-sandrift truncate">{match.excerpt}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-[10px] text-sandrift tabular-nums">{formatHistoryTime(thread.updatedAt)}</span>
                </button>
              );
            })}
          </div>
          {/* 截断声明（此前超 10 条静默丢弃，以为没有） */}
          {matchedThreads.length > MAX_THREAD_RESULTS && (
            <p className="px-1.5 py-1 text-[10px] text-sandrift">
              仅显示前 {MAX_THREAD_RESULTS} 条，共 {matchedThreads.length} 条匹配
            </p>
          )}
        </section>
      )}
    </div>
  );
}
