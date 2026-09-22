"use client";

import React, { useMemo, useState } from "react";
import { ExternalLink, FileText, FolderOpen, Globe2, MessagesSquare } from "lucide-react";
import { useKiroSessionMeta, useKiroSessionActions } from "@/components/kiro/KiroSessionProvider";
import { isSafeWebUrl } from "@/lib/ai/citations/parser";
import type { KiroSourceMeta } from "@/lib/ai/citations/types";
import {
  INSPECTOR_SOURCES_PREVIEW_LIMIT,
  aggregateInspectorSources,
} from "@/lib/ai/ui/kiroInspector";
import { KiroInspectorEmptyState, KiroInspectorSection } from "@/components/kiro/inspector/KiroInspectorSection";

function sourceIcon(source: KiroSourceMeta) {
  switch (source.source) {
    case "web":
      return <Globe2 className="w-3.5 h-3.5 shrink-0 text-sandrift" aria-hidden="true" />;
    case "course-material":
      return <FileText className="w-3.5 h-3.5 shrink-0 text-sandrift" aria-hidden="true" />;
    case "project-file":
      return <FolderOpen className="w-3.5 h-3.5 shrink-0 text-sandrift" aria-hidden="true" />;
    default:
      return <MessagesSquare className="w-3.5 h-3.5 shrink-0 text-sandrift" aria-hidden="true" />;
  }
}

function sourceMetaLine(source: KiroSourceMeta): string {
  if (source.source === "web") return source.domain ?? "网页来源";
  if (source.source === "course-material") {
    return ["课程资料", source.courseName].filter(Boolean).join(" · ");
  }
  if (source.source === "project-file") return "项目资料";
  return "对话附件";
}

/**
 * Kiro Inspector — Sources（V1）。
 *
 * 数据：Conversation 已登记 Source metadata（live Turn 优先 → 已绑定历史；语义去重）。
 * 只读展示：不重新抓网页 / 不重新读文件；Web 只允许 safe URL 点击；
 * 绝不显示 snippet / 正文 / query / score / provider raw response。
 * 单条 Message 的精确 Citation 入口仍在 KiroMessage More → 来源（本组件不替代）。
 */
export function KiroInspectorSources() {
  const meta = useKiroSessionMeta();
  const actions = useKiroSessionActions();
  const [showAll, setShowAll] = useState(false);

  const sources = useMemo(
    () =>
      aggregateInspectorSources({
        currentTurnSources: meta.currentTurnSources,
        boundSources: [actions.getConversationSources()],
      }),
    [actions, meta.currentTurnSources, meta.conversationSourcesVersion, meta.currentConversationId]
  );

  const visible = showAll ? sources : sources.slice(0, INSPECTOR_SOURCES_PREVIEW_LIMIT);

  return (
    <KiroInspectorSection
      title="来源"
      testId="kiro-inspector-sources"
      action={sources.length > 0 ? <span className="text-[10px] text-sandrift">{sources.length}</span> : undefined}
    >
      {sources.length === 0 ? (
        <KiroInspectorEmptyState
          text="暂无来源"
          hint="Kiro 使用资料或网页后会显示在这里。"
        />
      ) : (
        <>
          <ul className="space-y-0.5">
            {visible.map((source) => {
              const url = isSafeWebUrl(source.url) ? source.url : null;
              const rowKey = `${source.source}:${source.sourceId}:${source.name}`;
              return (
                <li
                  key={rowKey}
                  data-testid="kiro-inspector-source-row"
                  className="flex items-start gap-2 px-1.5 py-1.5 rounded-lg hover:bg-alabaster/60 transition-colors"
                >
                  <span className="mt-0.5">{sourceIcon(source)}</span>
                  <div className="min-w-0 flex-1">
                    <span className="block text-[11px] font-semibold text-charcoal truncate" title={source.name}>
                      {source.name}
                    </span>
                    <span className="block text-[10px] text-sandrift truncate">
                      {sourceMetaLine(source)}
                      {source.publishedAt ? ` · ${source.publishedAt}` : ""}
                    </span>
                  </div>
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`打开来源：${source.name}`}
                      className="shrink-0 mt-0.5 p-1 rounded-md text-sandrift hover:bg-white/70 hover:text-charcoal transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {!showAll && sources.length > INSPECTOR_SOURCES_PREVIEW_LIMIT ? (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              aria-expanded={false}
              className="mt-1 w-full text-left px-1.5 py-1 rounded-lg text-[10px] font-semibold text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
            >
              查看全部（{sources.length}）
            </button>
          ) : null}
        </>
      )}
    </KiroInspectorSection>
  );
}
