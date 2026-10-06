"use client";

import React, { useMemo, useState } from "react";
import { Crosshair, ExternalLink, FileText, FolderOpen, Globe2, MessagesSquare } from "lucide-react";
import { useKiroSessionMeta, useKiroSessionActions } from "@/components/kiro/KiroSessionProvider";
import { useToastStore } from "@/store/useToastStore";
import { isSafeWebUrl } from "@/lib/ai/citations/parser";
import type { KiroSourceMeta } from "@/lib/ai/citations/types";
import {
  INSPECTOR_SOURCES_PREVIEW_LIMIT,
  aggregateInspectorSources,
} from "@/lib/ai/ui/kiroInspector";
import {
  KiroInspectorEmptyState,
  KiroInspectorRow,
  KiroInspectorSection,
} from "@/components/kiro/inspector/KiroInspectorSection";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";

function sourceIcon(source: KiroSourceMeta) {
  switch (source.source) {
    case "web":
      return <Globe2 className="w-3.5 h-3.5" aria-hidden="true" />;
    case "course-material":
      return <FileText className="w-3.5 h-3.5" aria-hidden="true" />;
    case "project-file":
      return <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />;
    default:
      return <MessagesSquare className="w-3.5 h-3.5" aria-hidden="true" />;
  }
}

/** Source row 第二行：来源类别 + 归属（低权重；绝不显示 snippet / query / score） */
function sourceMetaLine(source: KiroSourceMeta): string {
  if (source.source === "web") return source.domain ?? "网页来源";
  if (source.source === "course-material") {
    return ["课程资料", source.courseName].filter(Boolean).join(" · ");
  }
  if (source.source === "project-file") return "项目资料";
  return "对话附件";
}

/**
 * Kiro Inspector — Sources（V1.2，Codex-style 层级）。
 *
 * 数据：Conversation 已登记 Source metadata（live Turn 优先 → 已绑定历史；语义去重）。
 * 只读展示：不重新抓网页 / 不重新读文件；Web 只允许 safe URL 点击；
 * 绝不显示 snippet / 正文 / query / score / provider raw response。
 * 单条 Message 的精确 Citation 入口仍在 KiroMessage More → 来源（本组件不替代）。
 * 行点击：在对话中定位首次引用该来源的位置（滚动 + 高亮；无引用则 toast 说明）。
 */

/** 在对话区定位首次引用该 sourceId 的位置；返回是否找到 */
function locateSourceCitation(sourceId: string): boolean {
  try {
    const scope =
      document.querySelector('[data-testid="kiro-conversation"]') ?? document;
    // jsdom 无 CSS.escape：sourceId 均为 [A-Za-z0-9_-] 安全字符，仅转义引号与反斜杠兜底
    const esc =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(sourceId)
        : sourceId.replace(/["\\]/g, "\\$&");
    const el = scope.querySelector(`[data-citation-source="${esc}"]`);
    if (!el) return false;
    // 减弱动效（应用内开关 / 系统偏好）时瞬时定位，与回到底部同语义
    const reduced =
      document.documentElement.dataset.motionEffective === "reduced" ||
      (typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    el.classList.remove("kiro-citation-flash");
    // 强制重启动画（同一来源连续点击两次也闪）
    void (el as HTMLElement).offsetWidth;
    el.classList.add("kiro-citation-flash");
    window.setTimeout(() => el.classList.remove("kiro-citation-flash"), 1600);
    return true;
  } catch {
    return false;
  }
}
export function KiroInspectorSources() {
  const meta = useKiroSessionMeta();
  const actions = useKiroSessionActions();
  const pushToast = useToastStore((s) => s.pushToast);
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

  const renderSourceRow = (source: (typeof sources)[number]) => {
    const url = isSafeWebUrl(source.url) ? source.url : null;
    const rowKey = `${source.source}:${source.sourceId}:${source.name}`;
    return (
      <li key={rowKey} className="animate-enter">
        <KiroInspectorRow
          testId="kiro-inspector-source-row"
          icon={sourceIcon(source)}
          actions={
            <>
              {/* P1：在对话中定位首次引用（此前来源看得到但定位不到，依据不可溯源） */}
              <button
                type="button"
                onClick={() => {
                  if (!locateSourceCitation(source.sourceId)) {
                    pushToast({ message: "对话中暂无该来源的引用", type: "info" });
                  }
                }}
                aria-label={`在对话中定位来源 ${source.name}`}
                title="在对话中定位引用位置"
                className="p-1 rounded-md text-sandrift hover:bg-white/70 hover:text-charcoal transition-colors"
              >
                <Crosshair className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`打开来源：${source.name}`}
                  className="p-1 rounded-md text-sandrift hover:bg-white/70 hover:text-charcoal transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
              ) : null}
            </>
          }
        >
          <span className="block text-xs font-semibold text-charcoal truncate" title={source.name}>
            {source.name}
          </span>
          <span className="block text-[10px] text-sandrift truncate">
            {sourceMetaLine(source)}
            {source.publishedAt ? ` · ${source.publishedAt}` : ""}
          </span>
        </KiroInspectorRow>
      </li>
    );
  };

  return (
    <KiroInspectorSection title="来源" count={sources.length} testId="kiro-inspector-sources">
      {sources.length === 0 ? (
        <KiroInspectorEmptyState
          icon={<Globe2 className="w-3.5 h-3.5" />}
          text="暂无来源"
        />
      ) : (
        <>
          <ul className="space-y-0.5">
            {visible.slice(0, INSPECTOR_SOURCES_PREVIEW_LIMIT).map((source) => {
              return renderSourceRow(source);
            })}
          </ul>
          {/* 超限行进退场走折叠（此前收起瞬删全部） */}
          <DisclosureRegion open={showAll}>
            <ul className="space-y-0.5">
              {visible.slice(INSPECTOR_SOURCES_PREVIEW_LIMIT).map((source) => renderSourceRow(source))}
            </ul>
          </DisclosureRegion>
          {sources.length > INSPECTOR_SOURCES_PREVIEW_LIMIT ? (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
              className="mt-0.5 w-full text-left px-2 py-1.5 rounded-lg text-[11px] font-semibold text-satin-grey hover:bg-alabaster hover:text-charcoal transition-colors"
            >
              {showAll ? "收起" : `查看全部（${sources.length}）`}
            </button>
          ) : null}
        </>
      )}
    </KiroInspectorSection>
  );
}
