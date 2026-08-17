"use client";

import React, { useState } from "react";
import { Clock } from "lucide-react";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { cn } from "@/lib/utils";
import {
  ActivityRow,
  ActivityScope,
  ACTIVITY_EXPANDED_LIMIT,
  ACTIVITY_INLINE_LIMIT,
  formatActivityGroupLabel,
  formatActivityTime,
} from "@/lib/history/activityView";
import { useEntityLearningHistory } from "@/hooks/useEntityLearningHistory";

const SOURCE_LABEL: Record<string, string> = {
  kiro: "Kiro",
  system: "系统",
  import: "导入",
};

const TONE_DOT: Record<ActivityRow["tone"], string> = {
  neutral: "bg-[#C9C4BC]",
  positive: "bg-[#627566]",
  warning: "bg-[#A87952]",
};

/**
 * Entity Activity Timeline（Activity = secondary context，默认 CLOSED）：
 * - 首次展开才 lazy 加载 IndexedDB（collapsed 不触发 history I/O，避免 panel 打开时 layout jump）
 * - 真实 Learning History 消费；覆盖起点 / 清空 / 错误 / 空态均诚实展示
 * - 每行不可编辑（immutable facts）；"查看更多" 展开到最多 20 条
 */
export function EntityActivitySection({
  scope,
  assignmentId,
  courseId,
  className,
}: {
  scope: ActivityScope;
  assignmentId?: string;
  courseId?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { rows, hasMore, coverageStartedAt, loading, error, retry } = useEntityLearningHistory({
    assignmentId: scope === "assignment" ? assignmentId : undefined,
    courseId: scope === "course" ? courseId : undefined,
    enabled: open,
  });

  const visibleRows = expanded ? rows : rows.slice(0, ACTIVITY_INLINE_LIMIT);
  const hiddenCount = Math.max(0, rows.length - visibleRows.length);

  // 按 localDate 分组（保持 desc 顺序）
  const groups: { label: string; rows: ActivityRow[] }[] = [];
  for (const r of visibleRows) {
    const last = groups[groups.length - 1];
    if (last && last.label === formatActivityGroupLabel(r.localDate)) {
      last.rows.push(r);
    } else {
      groups.push({ label: formatActivityGroupLabel(r.localDate), rows: [r] });
    }
  }

  const coverageText =
    coverageStartedAt !== null
      ? `记录自 ${formatActivityGroupLabel(
          `${new Date(coverageStartedAt).getFullYear()}-${String(new Date(coverageStartedAt).getMonth() + 1).padStart(2, "0")}-${String(new Date(coverageStartedAt).getDate()).padStart(2, "0")}`
        )}起`
      : null;

  return (
    <section className={className}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`entity-activity-${scope}`}
          data-testid={`entity-activity-trigger-${scope}`}
          onClick={() => setOpen((v) => !v)}
          className="ux-press flex min-w-0 items-center gap-1.5 rounded-lg py-0.5 pr-1 text-left text-xs font-semibold text-sandrift transition-colors hover:text-charcoal"
        >
          <Clock className="h-3.5 w-3.5 shrink-0 text-[#A48F82]" />
          <span className="truncate">活动记录</span>
          {rows.length > 0 && !open && (
            <span className="shrink-0 text-[10px] font-bold text-satin-grey">{rows.length}</span>
          )}
        </button>
      </div>

      <DisclosureRegion open={open}>
        <div id={`entity-activity-${scope}`} className="pt-1">
          {loading && (
            <div aria-live="polite" className="space-y-1.5 py-1">
              <div className="h-3 w-2/3 animate-pulse rounded bg-line-soft" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-line-soft" />
            </div>
          )}

          {!loading && error && (
            <div className="flex items-center gap-2 py-1.5 text-[11px] text-sandrift">
              <span>活动记录暂不可用</span>
              <button
                type="button"
                onClick={retry}
                className="rounded-lg border border-line bg-white px-2 py-0.5 font-bold text-satin-grey transition-colors hover:text-charcoal"
              >
                重试
              </button>
            </div>
          )}

          {!loading && !error && rows.length === 0 && (
            <div className="py-1.5 text-[11px] text-sandrift">
              <p className="font-semibold">暂无已记录活动</p>
              <p className="mt-0.5 text-[10px] text-sandrift/80">
                学习历史仅记录启用后的操作。
              </p>
            </div>
          )}

          {!loading && !error && rows.length > 0 && (
            <ol className="space-y-0" aria-label="活动记录">
              {groups.map((group) => (
                <li key={group.label}>
                  <p className="pt-1 pb-0.5 text-[10px] font-bold text-sandrift">{group.label}</p>
                  <ol className="space-y-0">
                    {group.rows.map((r, idx) => (
                      <li key={r.id} className="relative flex gap-2.5 pb-2">
                        {/* connector（decorative，读屏忽略） */}
                        {idx < group.rows.length - 1 && (
                          <span
                            aria-hidden="true"
                            className="absolute left-[3px] top-3 bottom-0 w-px bg-line-soft"
                          />
                        )}
                        <span
                          aria-hidden="true"
                          className={cn(
                            "relative top-1.5 h-[7px] w-[7px] shrink-0 rounded-full",
                            TONE_DOT[r.tone]
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-baseline justify-between gap-2 text-xs">
                            <span className="flex min-w-0 items-baseline gap-1.5">
                              <span className="truncate font-semibold text-charcoal">
                                {r.title}
                              </span>
                              {r.source && (
                                <span className="shrink-0 rounded border border-line bg-white px-1 py-px text-[9px] font-bold text-satin-grey">
                                  {SOURCE_LABEL[r.source] ?? r.source}
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 text-[10px] font-medium text-sandrift">
                              {formatActivityTime(r.occurredAt, r.localDate)}
                            </span>
                          </p>
                          {r.detail && (
                            <p className="mt-0.5 text-[11px] text-satin-grey">{r.detail}</p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ol>
          )}

          {!loading && !error && hiddenCount > 0 && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="w-full py-1 text-left text-[11px] font-bold text-satin-grey transition-colors hover:text-charcoal"
            >
              {expanded ? "收起" : `查看更多（${rows.length} 条）`}
            </button>
          )}

          {!loading && !error && rows.length >= ACTIVITY_EXPANDED_LIMIT && !expanded && (
            <p className="pb-0.5 text-[10px] text-sandrift/80">仅显示最近 {ACTIVITY_EXPANDED_LIMIT} 条</p>
          )}

          {!loading && !error && hasMore && expanded && (
            <p className="pb-0.5 text-[10px] text-sandrift/80">
              仅显示最近 {ACTIVITY_EXPANDED_LIMIT} 条
            </p>
          )}

          {coverageText && (
            <p className="pt-1 text-[10px] text-sandrift/70">{coverageText}</p>
          )}
        </div>
      </DisclosureRegion>
    </section>
  );
}
