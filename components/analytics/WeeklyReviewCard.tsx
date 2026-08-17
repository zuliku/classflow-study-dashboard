"use client";

import React, { useMemo } from "react";
import { CalendarPlus, Info } from "lucide-react";
import { LearningAnalyticsSnapshot } from "@/lib/analytics/types";
import { buildWeeklyReview, weeklyReviewCopy } from "@/lib/analytics/weeklyReview";
import { useKiroSessionActions } from "@/components/kiro/KiroSessionProvider";
import { KiroFlowButton } from "@/components/kiro/KiroFlow";
import { KiroLogoIcon } from "@/components/kiro/KiroLogo";

const DEEP_REVIEW_PROMPT =
  "基于我本周的学习洞察，帮我做一次简洁复盘：先总结本周投入、计划与实际、任务完成和学习节奏，再指出最值得调整的 1–3 个方面。请基于 ClassFlow 的真实学习数据，不要给学习力评分。";

const PLAN_NEXT_WEEK_PROMPT =
  "结合我本周的学习洞察和未来 7 天任务，帮我规划下一阶段学习。先判断哪些任务最需要安排，再给出可执行的学习计划建议。";

function formatMD(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 本周回顾（ephemeral deterministic projection；不访问 IndexedDB；不重复计算指标） */
export function WeeklyReviewCard({ snapshot }: { snapshot: LearningAnalyticsSnapshot }) {
  const review = useMemo(() => buildWeeklyReview(snapshot), [snapshot]);
  const copy = useMemo(() => weeklyReviewCopy(review), [review]);
  const { handoffPrompt } = useKiroSessionActions();

  const isEmpty = snapshot.isEmpty;
  const coverageDate = snapshot.coverage.historyStartedAt
    ? new Date(snapshot.coverage.historyStartedAt)
    : null;
  const coverageNote =
    !snapshot.coverage.fullCoverage && coverageDate
      ? `完整历史自 ${coverageDate.getFullYear()}/${String(coverageDate.getMonth() + 1).padStart(2, "0")}/${String(
          coverageDate.getDate()
        ).padStart(2, "0")} 起记录，本周部分数据可能不完整。`
      : null;

  const headline = review.headline;

  return (
    <div className="bg-surface border border-line rounded-2xl shadow-subtle overflow-hidden" data-testid="weekly-review-card">
      <div className="px-4 pt-4 pb-3 border-b border-line-soft">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-charcoal">本周回顾</h3>
          <span className="text-[10px] font-semibold text-sandrift">
            {formatMD(review.range.from)} – {formatMD(review.range.to)}
          </span>
        </div>
        {coverageNote && (
          <div className="flex items-start gap-1.5 mt-2 px-2.5 py-1.5 bg-alabaster/60 border border-line rounded-lg text-[10px] text-sandrift">
            <Info className="w-3 h-3 shrink-0 mt-0.5" />
            <p>{coverageNote}</p>
          </div>
        )}
      </div>

      {isEmpty ? (
        <div className="px-4 py-6 flex flex-col items-center justify-center text-center gap-1.5">
          <p className="text-xs font-bold text-charcoal">本周还没有足够的学习记录形成回顾</p>
          <p className="text-[11px] text-sandrift">完成任务、安排学习计划或进行专注后即可生成</p>
          <KiroFlowButton
            icon={KiroLogoIcon}
            label="让 Kiro 帮我规划本周"
            size="sm"
            className="mt-2 self-center"
            onClick={() => handoffPrompt(PLAN_NEXT_WEEK_PROMPT)}
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-line-soft">
            <div className="px-4 py-3">
              <p className="text-[10px] font-semibold text-sandrift">专注</p>
              <p className="text-lg font-extrabold text-charcoal mt-0.5">{headline.focusLabel}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-[10px] font-semibold text-sandrift">完成任务</p>
              <p className="text-lg font-extrabold text-charcoal mt-0.5">{headline.completedAssignments} 项</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-[10px] font-semibold text-sandrift">活跃天数</p>
              <p className="text-lg font-extrabold text-charcoal mt-0.5">{headline.activeDays} 天</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-[10px] font-semibold text-sandrift">按时完成</p>
              <p className="text-lg font-extrabold text-charcoal mt-0.5">
                {headline.onTimeRate !== null ? `${headline.onTimeRate}%` : "—"}
              </p>
            </div>
          </div>

          <div className="px-4 py-3 border-t border-line-soft space-y-1">
            {copy.planActualLines.length > 0 && (
              <p className="text-[11px] text-satin-grey leading-relaxed">
                计划与实际：{copy.planActualLines.join("；")}
              </p>
            )}
            {copy.investmentLines.length > 0 && (
              <p className="text-[11px] text-satin-grey leading-relaxed">主要投入：{copy.investmentLines.join("；")}</p>
            )}
            <p className="text-[11px] text-satin-grey leading-relaxed">
              截止节奏：{headline.onTimeEligible >= 0 && headline.onTimeEligible > 0
                ? `${headline.onTimeCount} / ${headline.onTimeEligible} 个可判断任务按时完成`
                : "暂无可靠截止时间可判断"}
            </p>
            <p className="text-[11px] text-satin-grey leading-relaxed">{copy.changeLines[0]}</p>
          </div>

          {(copy.highlightLines.length > 0 || copy.attentionLines.length > 0) && (
            <div className="px-4 py-3 border-t border-line-soft space-y-1">
              <p className="text-[10px] font-bold text-charcoal">本周值得注意</p>
              {[...copy.highlightLines, ...copy.attentionLines].map((line, i) => (
                <p key={i} className="text-[11px] text-satin-grey leading-relaxed flex items-start gap-1.5">
                  <span className="text-sandrift mt-0.5">·</span>
                  {line}
                </p>
              ))}
            </div>
          )}

          <div className="px-4 py-3 border-t border-line-soft flex flex-wrap items-center gap-2">
            <KiroFlowButton
              icon={KiroLogoIcon}
              label="让 Kiro 深入复盘"
              size="sm"
              onClick={() => handoffPrompt(DEEP_REVIEW_PROMPT)}
            />
            <button
              type="button"
              onClick={() => handoffPrompt(PLAN_NEXT_WEEK_PROMPT)}
              className="ux-press inline-flex items-center gap-1.5 px-3 py-1.5 bg-charcoal hover:bg-black text-white text-[11px] font-bold rounded-xl transition-colors shadow-subtle"
            >
              <CalendarPlus className="w-3.5 h-3.5" />
              规划下周
            </button>
          </div>
        </>
      )}
    </div>
  );
}
