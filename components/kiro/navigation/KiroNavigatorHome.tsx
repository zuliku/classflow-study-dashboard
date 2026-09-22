"use client";

import React from "react";
import { Plus, Search } from "lucide-react";
import { KiroThreadRow } from "@/components/kiro/KiroThreadRow";
import { KiroNavigatorSearch } from "@/components/kiro/navigation/KiroNavigatorSearch";
import {
  KiroNavigatorCreateProjectRow,
  KiroNavigatorProjectRow,
  KiroNavigatorSectionHeader,
} from "@/components/kiro/navigation/KiroNavigatorProjects";
import { KiroProjectRecord } from "@/lib/ai/projects/types";
import { KiroConversationRecord } from "@/lib/ai/history/types";

/** Home 默认显示最近对话条数（超出折叠为「查看全部」） */
export const KIRO_NAVIGATOR_RECENT_LIMIT = 8;

/**
 * Kiro Navigator — Home 视图（V1）。
 * flat list + soft hover + small active surface；不使用 Card。
 */
export function KiroNavigatorHome({
  projects,
  threads,
  query,
  showAllThreads,
  disabled,
  currentConversationId,
  conversationProjectId,
  transitionTargetId,
  searchInputRef,
  onQueryChange,
  onNewChat,
  onOpenProject,
  onCreateProject,
  onEditProject,
  onDeleteProject,
  onOpenThread,
  onShowAllThreads,
}: {
  projects: KiroProjectRecord[];
  threads: KiroConversationRecord[];
  query: string;
  showAllThreads: boolean;
  disabled?: boolean;
  currentConversationId: string | null;
  conversationProjectId: string | null;
  transitionTargetId: string | null;
  searchInputRef?: React.Ref<HTMLInputElement>;
  onQueryChange: (query: string) => void;
  onNewChat: () => void;
  onOpenProject: (projectId: string) => void;
  onCreateProject: () => void;
  onEditProject: (project: KiroProjectRecord) => void;
  onDeleteProject: (project: KiroProjectRecord) => void;
  onOpenThread: (id: string) => void;
  onShowAllThreads: () => void;
}) {
  const searching = query.trim().length > 0;
  const visibleThreads =
    searching || showAllThreads ? threads : threads.slice(0, KIRO_NAVIGATOR_RECENT_LIMIT);

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="kiro-navigator-home">
      <div className="shrink-0 px-2.5 pt-2.5 pb-2 space-y-1.5">
        <button
          type="button"
          onClick={onNewChat}
          disabled={disabled}
          aria-label="新对话"
          className="w-full flex items-center gap-2 px-2.5 h-8 rounded-lg text-xs font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" />
          新对话
        </button>
        <div className="flex items-center gap-1.5 bg-[#F7F5F5] border border-line rounded-lg px-2 h-8">
          <Search className="w-3.5 h-3.5 text-sandrift shrink-0" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="搜索对话与项目"
            aria-label="搜索对话与项目"
            className="w-full bg-transparent text-xs text-charcoal placeholder-sandrift focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
        {searching ? (
          <KiroNavigatorSearch
            query={query}
            projects={projects}
            threads={threads}
            disabled={disabled}
            onOpenProject={onOpenProject}
            onOpenThread={onOpenThread}
          />
        ) : (
          <>
            <section aria-label="项目">
              <KiroNavigatorSectionHeader
                label="项目"
                action={
                  <button
                    type="button"
                    onClick={onCreateProject}
                    aria-label="新建项目"
                    title="新建项目"
                    className="p-1 rounded-md text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                }
              />
              {projects.length === 0 ? (
                <p className="px-1.5 pb-1 text-[10px] text-sandrift">还没有项目</p>
              ) : (
                <div className="space-y-0.5">
                  {projects.map((project) => (
                    <KiroNavigatorProjectRow
                      key={project.id}
                      project={project}
                      isCurrent={conversationProjectId === project.id}
                      disabled={disabled}
                      onOpen={onOpenProject}
                      onEdit={onEditProject}
                      onDelete={onDeleteProject}
                    />
                  ))}
                </div>
              )}
              <KiroNavigatorCreateProjectRow onClick={onCreateProject} />
            </section>

            <section aria-label="最近对话" className="mt-1">
              <KiroNavigatorSectionHeader label="最近" />
              {visibleThreads.length === 0 ? (
                <p className="px-1.5 py-4 text-center text-[11px] text-sandrift">暂无历史对话</p>
              ) : (
                <div className="space-y-0.5">
                  {visibleThreads.map((thread) => (
                    <KiroThreadRow
                      key={thread.id}
                      record={thread}
                      isCurrent={currentConversationId === thread.id}
                      onOpen={onOpenThread}
                      disabled={disabled}
                      transitioning={transitionTargetId === thread.id}
                    />
                  ))}
                </div>
              )}
              {!showAllThreads && threads.length > KIRO_NAVIGATOR_RECENT_LIMIT && (
                <button
                  type="button"
                  onClick={onShowAllThreads}
                  className="w-full text-left px-2 py-1.5 rounded-lg text-[11px] font-semibold text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
                >
                  查看全部
                </button>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
