"use client";

import React from "react";
import { CalendarClock, Sparkles, ChevronRight } from "lucide-react";
import { OutlookHealth, OutlookTask, StudyOutlook, StudyOutlookHorizon } from "@/lib/outlook/types";
import { useKiroSessionActions } from "@/components/kiro/KiroSessionProvider";
import { cn } from "@/lib/utils";

const HEALTH_COPY: Record<OutlookHealth, { label: string; cls: string }> = {
  safe: { label: "已覆盖", cls: "text-[#627566] bg-[#627566]/10 border-[#627566]/25" },
  attention: { label: "需留意", cls: "text-[#A87952] bg-[#A87952]/10 border-[#A87952]/25" },
  "at-risk": { label: "时间可能不足", cls: "text-[#9B5B57] bg-[#9B5B57]/10 border-[#9B5B57]/25" },
  unscheduled: { label: "尚未安排", cls: "text-sandrift bg-alabaster border-line" },
  overdue: { label: "已逾期", cls: "text-danger bg-danger-bg border-danger-border" },
  unknown: { label: "信息不足", cls: "text-sandrift bg-alabaster border-line" },
};

const PLAN_OUTLOOK_PROMPT =
  "结合未来 7 天学习前瞻，帮我处理最需要安排的任务。缺少估时的任务先指出，不要自行假设耗时；需要排期时走学习计划 Proposal。";

const ESTIMATE_PROMPT = "帮我根据任务内容估算预计耗时，并先给出建议，不要直接修改。";

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function formatDeadline(ddl: string | null): string {
  if (!ddl) return "";
  const [datePart, timePart] = ddl.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const time = timePart ? timePart.slice(0, 5) : "23:59";
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${m}/${d} ${weekday} ${time}`;
}

/** 未来 7 / 14 天学习前瞻（确定性；Top 5；不做大 Calendar 复制） */
export function StudyOutlookCard({
  outlook,
  horizonDays,
  onHorizonChange,
}: {
  outlook: StudyOutlook;
  horizonDays: StudyOutlookHorizon;
  onHorizonChange: (h: StudyOutlookHorizon) => void;
}) {
  const { handoffPrompt } = useKiroSessionActions();
  const { summary, tasks, bottleneckDays, firstCapacityShortfall } = outlook;
  const top = tasks.slice(0, 5);
  const attentionCount = summary.counts.atRisk + summary.counts.attention;

  const fmt = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}m`;
  };
  const shortfall = summary.workload.shortfallMinutes;
  const hasMissing = summary.counts.missingEstimate > 0;
  const affectedTitles = (firstCapacityShortfall?.affectedAssignmentIds ?? [])
    .map((id) => tasks.find((t) => t.assignmentId === id)?.title)
    .filter((t): t is string => !!t);
  // Rebalance handoff 条件：存在容量缺口 或 有 scheduled_after_deadline 的任务
  const rebalanceSuggestion =
    firstCapacityShortfall !== null ||
    tasks.some((t) => t.reasons.includes("scheduled_after_deadline"));

  return (
    <div className="bg-surface border border-line rounded-2xl shadow-subtle" data-testid="study-outlook-card">
      <div className="px-4 pt-4 pb-3 border-b border-line-soft">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-charcoal">
            <CalendarClock className="w-4 h-4 text-[#A48F82]" />
            学习前瞻
          </h3>
          <div className="flex items-center gap-1 bg-alabaster p-0.5 rounded-lg border border-line-strong">
            {([7, 14] as StudyOutlookHorizon[]).map((h) => (
              <button
                key={h}
                type="button"
                aria-pressed={horizonDays === h}
                onClick={() => onHorizonChange(h)}
                className={cn(
                  "px-2 py-0.5 rounded-md text-[10px] font-bold whitespace-nowrap transition-colors",
                  horizonDays === h ? "bg-white text-charcoal shadow-subtle" : "text-satin-grey hover:text-charcoal"
                )}
              >
                未来 {h} 天
              </button>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-sandrift mt-1.5">
          {summary.counts.totalDue > 0
            ? `${summary.counts.totalDue} 个截止任务${attentionCount > 0 ? ` · ${attentionCount} 个需注意` : ""}`
            : `未来 ${horizonDays} 天暂无截止任务`}
        </p>
        {/* 容量事实：需求 / 可安排 / 缺口（共享容量，非 raw free 相加） */}
        {summary.counts.totalDue > 0 && (
          <p className="text-[11px] mt-1" data-testid="outlook-capacity-line">
            {shortfall > 0 ? (
              <span className="text-[#9B5B57]">
                尚需安排 {fmt(summary.workload.remainingKnownMinutes)} · 可安排{" "}
                {fmt(summary.workload.allocatableMinutes)} · 缺口 {fmt(shortfall)}
              </span>
            ) : (
              <span className="text-[#627566]">未来容量可覆盖当前已知需求</span>
            )}
            {hasMissing && (
              <span className="text-sandrift">
                {" "}
                · 另有 {summary.counts.missingEstimate} 个任务缺少预计耗时，未计入容量判断
              </span>
            )}
          </p>
        )}
      </div>

      {firstCapacityShortfall && shortfall > 0 && (
        <div className="px-4 py-2 bg-[#9B5B57]/5 border-b border-line-soft">
          <p className="text-[10px] text-[#9B5B57] leading-relaxed" data-testid="outlook-shortfall-strip">
            最早容量缺口：{formatDeadline(firstCapacityShortfall.deadline)} 前约缺{" "}
            {fmt(firstCapacityShortfall.shortfallMinutes)}
            {affectedTitles.length > 0 &&
              ` · 涉及 ${affectedTitles.slice(0, 2).join("、")}${
                affectedTitles.length > 2 ? ` 等 ${affectedTitles.length} 个任务` : ""
              }`}
          </p>
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-[11px] text-sandrift">未来 {horizonDays} 天暂无需要安排的任务</p>
        </div>
      ) : (
        <div className="divide-y divide-line-soft">
          {top.map((t) => (
            <OutlookTaskRow key={t.assignmentId} task={t} onEstimate={() => handoffPrompt(ESTIMATE_PROMPT)} />
          ))}
        </div>
      )}

      {bottleneckDays.length > 0 && (
        <div className="px-4 py-2 border-t border-line-soft">
          <p className="text-[10px] text-sandrift">
            较忙的日子：
            {bottleneckDays.slice(0, 3).map((d, i) => {
              const [y, m, day] = d.date.split("-").map(Number);
              return (
                <span key={d.date}>
                  {i > 0 ? "、" : ""}
                  {m}/{day}（{WEEKDAYS[new Date(y, m - 1, day).getDay()]}）
                  {d.plannedStudyMinutes >= 240 ? ` 已计划 ${Math.round(d.plannedStudyMinutes / 60)}h+` : ""}
                  {d.dueTaskCount >= 2 ? ` ${d.dueTaskCount} 个任务截止` : ""}
                </span>
              );
            })}
          </p>
        </div>
      )}

      <div className="px-4 py-3 border-t border-line-soft flex flex-wrap items-center gap-2">
        {rebalanceSuggestion && (
          <button
            type="button"
            data-testid="outlook-rebalance-handoff"
            onClick={() =>
              handoffPrompt(
                "结合当前学习前瞻，检查已有 Kiro 学习计划是否可以通过移动时段改善。请先生成重排建议，不要直接修改。"
              )
            }
            className="ux-press inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-line-strong text-charcoal text-[11px] font-bold rounded-xl hover:bg-alabaster transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#A48F82]" />
            优化已有计划
          </button>
        )}
        <button
          type="button"
          onClick={() => handoffPrompt(PLAN_OUTLOOK_PROMPT)}
          className="ux-press inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-line-strong text-charcoal text-[11px] font-bold rounded-xl hover:bg-alabaster transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5 text-[#A48F82]" />
          让 Kiro 帮我规划
        </button>
        <button
          type="button"
          onClick={() => handoffPrompt("结合未来 14 天学习前瞻，帮我整理最近的学习安排。")}
          className="text-[10px] font-bold text-sandrift bg-transparent border border-line rounded-lg px-2 py-1.5 hover:text-charcoal hover:border-line-strong transition-colors inline-flex items-center gap-0.5"
        >
          深入前瞻
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function OutlookTaskRow({ task, onEstimate }: { task: OutlookTask; onEstimate: () => void }) {
  const health = HEALTH_COPY[task.health];
  const missingEstimate = task.reasons.includes("missing_estimate");
  const scheduledAfterDeadline = task.reasons.includes("scheduled_after_deadline");
  const unscheduled = task.unscheduledMinutes ?? 0;
  return (
    <div className="px-4 py-2.5 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-charcoal truncate">{task.title}</p>
        <span className={cn("shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-md border", health.cls)}>
          {health.label}
        </span>
      </div>
      <p className="text-[10px] text-satin-grey">
        {missingEstimate ? (
          <>
            缺少预计耗时，暂无法判断安排是否充足。
            <button
              type="button"
              onClick={onEstimate}
              className="ml-1.5 text-[10px] font-bold text-sandrift bg-transparent border border-line rounded px-1.5 py-0.5 hover:text-charcoal hover:border-line-strong transition-colors inline-flex items-center gap-0.5"
            >
              <Sparkles className="w-2.5 h-2.5" />
              估算任务
            </button>
          </>
        ) : task.health === "overdue" ? (
          <>{formatDeadline(task.deadline)} · 已逾期，不占用未来容量</>
        ) : task.capacityComplete === null ? (
          <>{formatDeadline(task.deadline)} · 信息不足</>
        ) : task.capacityComplete ? (
          <>
            {formatDeadline(task.deadline)}
            {unscheduled > 0 ? (
              <span className="text-[#627566]"> · 尚需安排 {Math.round(unscheduled)}min · 当前容量可覆盖</span>
            ) : (
              <span className="text-[#627566]"> · 已安排覆盖</span>
            )}
          </>
        ) : (
          <>
            {formatDeadline(task.deadline)} · 尚需安排 {Math.round(unscheduled)}min · 预计仍缺{" "}
            {Math.round(task.capacityShortfallMinutes ?? 0)}min
          </>
        )}
        {scheduledAfterDeadline && (
          <span className="text-sandrift"> · Deadline 后仍有已安排时段</span>
        )}
      </p>
    </div>
  );
}
