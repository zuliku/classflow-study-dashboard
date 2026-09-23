"use client";

import React, { useEffect, useState } from "react";
import { ArrowLeft, ChevronDown, Plus, X } from "lucide-react";
import { useKiroSessionMeta, useKiroSessionActions } from "@/components/kiro/KiroSessionProvider";
import { KiroMenuPanel, KiroMenuItem, KiroMenuDivider } from "@/components/kiro/KiroMenu";
import { KiroThreadRow } from "@/components/kiro/KiroThreadRow";
import { KiroNavigatorProjectFiles } from "@/components/kiro/navigation/KiroNavigatorProjectFiles";
import { KiroNavigatorSectionHeader } from "@/components/kiro/navigation/KiroNavigatorProjects";
import { useToastStore } from "@/store/useToastStore";
import { listProjectConversations } from "@/lib/ai/projects/db";
import { KiroProjectRecord } from "@/lib/ai/projects/types";
import { KiroConversationRecord } from "@/lib/ai/history/types";

/**
 * Kiro Navigator — Project Detail 视图（V1）。
 * 能力来源：KiroProjectPanel Detail（项目指令 / 项目资料 / 项目内对话 / 移出项目 /
 * Project-scoped 新对话 / 编辑 / 删除），全部复用同一 Session actions + IndexedDB。
 */
export function KiroNavigatorProjectDetail({
  project,
  projectsVersion,
  historyVersion,
  onBack,
  onEdit,
  onDelete,
  onAddConversation,
  onOpenThread,
}: {
  project: KiroProjectRecord;
  /** meta.projectsVersion（归属 / 资料变化后刷新） */
  projectsVersion: number;
  /** meta.historyVersion（对话保存 / 重命名后刷新） */
  historyVersion: number;
  onBack: () => void;
  onEdit: (project: KiroProjectRecord) => void;
  onDelete: (project: KiroProjectRecord) => void;
  onAddConversation: () => void;
  onOpenThread: (id: string) => void;
}) {
  const meta = useKiroSessionMeta();
  const actions = useKiroSessionActions();
  const pushToast = useToastStore((s) => s.pushToast);
  const [conversations, setConversations] = useState<KiroConversationRecord[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  // lazy：只有进入 Detail 才读取项目内对话
  useEffect(() => {
    let cancelled = false;
    listProjectConversations(project.id)
      .then((list) => {
        if (!cancelled) setConversations(list);
      })
      .catch(() => {
        if (!cancelled) pushToast({ message: "对话列表加载失败，请重试", type: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, projectsVersion, historyVersion, pushToast]);

  const transitioning = meta.conversationTransitioning;
  const isTransientNewChat =
    meta.conversationProjectId === project.id && meta.currentConversationId === null;

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="kiro-navigator-project-detail">
      <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-2 border-b border-line">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回项目列表"
          className="p-1 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="text-xs font-semibold text-charcoal truncate flex-1 min-w-0">{project.name}</span>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={`项目 ${project.name} 更多操作`}
            aria-expanded={menuOpen}
            className="p-1 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
          <KiroMenuPanel open={menuOpen} placement="right-end" className="w-[160px]">
            <KiroMenuItem
              label="编辑项目"
              onClick={() => {
                setMenuOpen(false);
                onEdit(project);
              }}
            />
            <KiroMenuDivider />
            <KiroMenuItem
              label="删除项目"
              danger
              onClick={() => {
                setMenuOpen(false);
                onDelete(project);
              }}
            />
          </KiroMenuPanel>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-1">
        <button
          type="button"
          onClick={() => {
            if (transitioning) return;
            actions.newChatInProject(project.id);
          }}
          disabled={transitioning}
          aria-label="在此项目中新建对话"
          className="w-full flex items-center gap-2 px-2.5 h-8 rounded-lg text-xs font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" />
          在此项目中新对话
        </button>

        {project.description ? (
          <p className="text-[11px] text-satin-grey px-1.5 leading-relaxed">{project.description}</p>
        ) : null}

        {/* 项目指令（V1.2）：紧凑展示 + 可编辑 */}
        <div className="px-1.5 pb-1">
          <div className="flex items-center justify-between gap-1">
            <p className="text-[10px] font-semibold text-sandrift">项目指令</p>
            <button
              type="button"
              onClick={() => onEdit(project)}
              aria-label={project.instructions ? "编辑项目指令" : "添加项目指令"}
              className="text-[10px] font-bold text-charcoal bg-alabaster hover:bg-pastel-mint rounded-md px-1.5 h-5 transition-colors"
            >
              {project.instructions ? "编辑" : "添加"}
            </button>
          </div>
          {project.instructions ? (
            <p className="text-[10px] text-satin-grey leading-relaxed mt-0.5 max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-alabaster/60 px-2 py-1.5">
              {project.instructions}
            </p>
          ) : (
            <p className="text-[10px] text-sandrift mt-0.5">未设置项目指令</p>
          )}
        </div>

        {/* 项目资料（V1.3A；只在 Detail 挂载 → lazy 读取） */}
        <KiroNavigatorProjectFiles projectId={project.id} refreshToken={projectsVersion} />

        {/* 对话 */}
        <KiroNavigatorSectionHeader
          label={`对话 · ${conversations.length}`}
          action={
            <button
              type="button"
              onClick={onAddConversation}
              disabled={transitioning}
              aria-label="添加历史对话"
              className="px-1.5 h-5 rounded-md text-[10px] font-semibold text-satin-grey bg-alabaster hover:bg-pastel-mint hover:text-charcoal transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              添加历史
            </button>
          }
        />
        {isTransientNewChat ? (
          <div
            role="status"
            aria-label="当前项目新对话提示"
            className="px-1.5 py-1.5 text-[10px] font-semibold text-charcoal bg-pastel-mint/50 rounded-lg"
          >
            当前 · 新对话
          </div>
        ) : null}
        {conversations.length === 0 && !isTransientNewChat ? (
          <div className="flex flex-col items-center gap-1 py-6 text-center">
            <p className="text-xs font-semibold text-satin-grey">这个项目还没有对话</p>
            <button
              type="button"
              onClick={onAddConversation}
              className="mt-1 px-2.5 h-7 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors"
            >
              添加历史对话
            </button>
          </div>
        ) : (
          conversations.map((conversation) => (
            <div key={conversation.id} className="group/projconv flex items-center gap-0.5">
              <div className="min-w-0 flex-1">
                <KiroThreadRow
                  record={conversation}
                  isCurrent={meta.currentConversationId === conversation.id}
                  onOpen={onOpenThread}
                  disabled={transitioning}
                  transitioning={meta.conversationTransition.target === conversation.id}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  void actions.assignConversationToProject(conversation.id, null).then((ok) => {
                    if (ok) pushToast({ message: "已移出项目" });
                  });
                }}
                disabled={transitioning}
                aria-label={`从项目移出 ${conversation.title}`}
                title="移出项目（不删除对话）"
                className="p-1 rounded-md text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-40 disabled:cursor-not-allowed opacity-0 group-hover/projconv:opacity-100 group-focus-within/projconv:opacity-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
