"use client";

import React, { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useKiroSessionActions } from "@/components/kiro/KiroSessionProvider";
import { useToastStore } from "@/store/useToastStore";
import { listConversations } from "@/lib/ai/history/db";
import { KiroConversationRecord } from "@/lib/ai/history/types";
import { formatHistoryTime } from "@/lib/ai/history/sanitize";
import { KiroProjectRecord } from "@/lib/ai/projects/types";

/**
 * Kiro Navigator — 「添加 / 移动历史对话到项目」视图（V1.1 能力迁移）。
 * 数据：listConversations()（本地 IndexedDB；只在进入该视图时读取）。
 */
export function KiroNavigatorAddConversation({
  projectId,
  projects,
  refreshToken,
  onBack,
}: {
  projectId: string;
  projects: KiroProjectRecord[];
  /** meta.projectsVersion（归属变化后刷新候选） */
  refreshToken: number;
  onBack: () => void;
}) {
  const actions = useKiroSessionActions();
  const pushToast = useToastStore((s) => s.pushToast);
  const [candidates, setCandidates] = useState<KiroConversationRecord[]>([]);
  const transitioning = false;

  useEffect(() => {
    let cancelled = false;
    listConversations()
      .then((all) => {
        if (!cancelled) setCandidates(all.filter((c) => c.projectId !== projectId));
      })
      .catch(() => {
        if (!cancelled) pushToast({ message: "对话列表加载失败，请重试", type: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshToken, pushToast]);

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="kiro-navigator-add-conversation">
      <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-2 border-b border-line">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回项目"
          className="p-1 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="text-xs font-semibold text-charcoal truncate">添加历史对话</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-0.5">
        {candidates.length === 0 ? (
          <p className="text-[11px] text-sandrift text-center py-6">没有可添加的对话</p>
        ) : (
          candidates.map((conversation) => {
            const fromProject = projects.find((p) => p.id === conversation.projectId);
            return (
              <div key={conversation.id} className="flex items-center gap-2 px-2 h-9 rounded-lg hover:bg-alabaster/70">
                <div className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-charcoal truncate">{conversation.title}</span>
                  <span className="block text-[10px] text-sandrift truncate">
                    {conversation.projectId ? `来自「${fromProject?.name ?? "其他项目"}」` : "未归类"} ·{" "}
                    {formatHistoryTime(conversation.updatedAt)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void actions
                      .assignConversationToProject(conversation.id, projectId)
                      .then((ok) => {
                        if (ok) pushToast({ message: conversation.projectId ? "已移动" : "已添加" });
                      });
                  }}
                  disabled={transitioning}
                  aria-label={`${conversation.projectId ? "移动" : "添加"}对话 ${conversation.title}`}
                  className="px-2 h-6 rounded-lg text-[10px] font-bold text-charcoal bg-pastel-mint/70 hover:bg-pastel-mint transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {conversation.projectId ? "移动" : "添加"}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
