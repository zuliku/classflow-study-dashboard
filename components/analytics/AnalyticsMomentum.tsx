"use client";

import React, { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { useStudyMomentum } from "@/hooks/useStudyMomentum";
import { MOMENTUM_WEEKS, type MomentumDay } from "@/lib/analytics/momentum";
import { cn } from "@/lib/utils";

/** 热力等级 → 底色（charcoal 系阶梯；未知日同底 + 虚线框 + 降透明区分） */
const LEVEL_FILL = ["#F0EBE1", "#D9CFC2", "#CDB9AB", "#A48F82", "#313032"];

function formatHours(minutes: number): string {
  const h = minutes / 60;
  return h >= 10 ? `${Math.round(h)} 小时` : `${Math.round(h * 10) / 10} 小时`;
}

function formatMonthDay(dateStr: string): string {
  return `${Number(dateStr.slice(5, 7))}月${Number(dateStr.slice(8, 10))}日`;
}

/** 84 天按周成列（GitHub 式：列 = 周，周一在上；首周前补空格对齐） */
function useHeatColumns(days: MomentumDay[]): ({ day: MomentumDay | null }[][]) {
  return useMemo(() => {
    if (days.length === 0) return [];
    const firstDow = (new Date(`${days[0].date}T00:00:00`).getDay() + 6) % 7; // Mon=0
    const cells: ({ day: MomentumDay | null })[] = Array.from({ length: firstDow }, () => ({ day: null }));
    for (const d of days) cells.push({ day: d });
    while (cells.length % 7 !== 0) cells.push({ day: null });
    const cols: ({ day: MomentumDay | null })[][] = [];
    for (let i = 0; i < cells.length; i += 7) cols.push(cells.slice(i, i + 7));
    return cols;
  }, [days]);
}

function cellTitle(day: MomentumDay): string {
  if (day.unknown) return `${day.date} · 记录起点之前`;
  if (!day.active) return `${day.date} · 无学习记录`;
  const parts = [`${day.date}`, day.minutes > 0 ? `${Math.round(day.minutes)} 分钟专注` : null, day.completed > 0 ? `完成 ${day.completed} 项` : null].filter(
    Boolean
  );
  return parts.join(" · ");
}

/**
 * 学习动量（对标 GitHub contributions + Duolingo streak）：
 * 12 周热力 + 12 周专属四统计（连续 / 总专注 / 活跃天数 / 单日最佳）。
 * 统计口径均为 12 周独立查询结果（与本周 Strip 不重复：Strip 是本周，环已删除，
 * 计划达成/按时完成只看 Strip）。数据独立查询（与 range preset 无关），
 * 纯新增表达层，不碰既有标题/testid/口径。
 */
export function AnalyticsMomentum() {
  const [open, setOpen] = useState(true);
  const { data, loading, error, refresh } = useStudyMomentum();
  const columns = useHeatColumns(data?.days ?? []);
  // 每列月份刻度（与前列同月则省略，保持 GitHub 式稀疏标注）
  const monthLabels = useMemo(
    () =>
      columns.map((col) => {
        const first = col.find(({ day }) => day !== null)?.day;
        return first ? Number(first.date.slice(5, 7)) : null;
      }),
    [columns]
  );
  const shownMonths = useMemo(() => {
    const out: (string | null)[] = [];
    monthLabels.forEach((m, i) => {
      out.push(m === null || (i > 0 && monthLabels[i - 1] === m) ? null : `${m}月`);
    });
    return out;
  }, [monthLabels]);

  // error/空数据不再静默消失（与前瞻/历史 error→文案+重试同语言；refresh 已接线）
  if (error || (!loading && !data)) {
    return (
      <section>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="w-full flex items-center justify-between mb-3 text-left group"
        >
          <h2 className="text-[13px] font-bold text-charcoal">学习动量</h2>
          <ChevronDown
            className={cn(
              "w-3.5 h-3.5 text-sandrift transition-transform duration-[var(--motion-fast)] group-hover:text-charcoal",
              !open && "-rotate-90"
            )}
            aria-hidden="true"
          />
        </button>
        <DisclosureRegion open={open}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-danger/70 pl-4">
            <p className="text-xs font-medium text-danger">学习动量加载失败，请稍后重试。</p>
            <button
              type="button"
              onClick={() => refresh()}
              className="text-[11px] font-semibold text-charcoal underline underline-offset-2 hover:text-black transition-colors"
            >
              重试
            </button>
          </div>
        </DisclosureRegion>
      </section>
    );
  }

  return (
    <section className="border-t border-line-soft pt-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between mb-3 text-left group"
      >
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-charcoal">学习动量</h2>
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 text-sandrift transition-transform duration-[var(--motion-fast)] group-hover:text-charcoal",
            !open && "-rotate-90"
          )}
          aria-hidden="true"
        />
      </button>
      <DisclosureRegion open={open}>
        <div data-testid="analytics-momentum">
          {loading || !data ? (
            <div className="ux-skeleton h-[220px] w-full rounded-lg bg-alabaster animate-pulse" aria-label="动量加载中" />
          ) : (
            <div className="flex flex-col gap-4">
              {/* 热力整块置顶（GitHub 式通栏） */}
              <div>
                <div
                  data-testid="momentum-heatmap"
                  role="img"
                  aria-label={`近 ${MOMENTUM_WEEKS} 周学习热力，连续学习 ${data.streakDays} 天`}
                  className="flex gap-1 overflow-x-auto pb-1"
                >
                  {columns.map((col, ci) => (
                    <div key={ci} className="flex flex-col gap-1 shrink-0">
                      <span className="h-4 text-[10px] font-semibold text-sandrift whitespace-nowrap overflow-visible" aria-hidden="true">
                        {shownMonths[ci] ?? ""}
                      </span>
                      {col.map(({ day }, ri) =>
                        day === null ? (
                          <span key={ri} className="w-5 h-5" aria-hidden="true" />
                        ) : (
                          <span
                            key={day.date}
                            aria-hidden="true"
                            data-level={day.level}
                            data-unknown={day.unknown || undefined}
                            className={cn(
                              "w-5 h-5 rounded-[5px]",
                              day.unknown && "border border-dashed border-line-strong"
                            )}
                            style={{
                              backgroundColor: LEVEL_FILL[day.level],
                              opacity: day.unknown ? 0.45 : 1,
                            }}
                          />
                        )
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-end text-[10px] text-sandrift">
                  <span className="flex items-center gap-1" aria-hidden="true">
                    少
                    {[0, 1, 2, 3, 4].map((l) => (
                      <span
                        key={l}
                        className="w-2.5 h-2.5 rounded-[2px] inline-block"
                        style={{ backgroundColor: LEVEL_FILL[l] }}
                      />
                    ))}
                    多
                  </span>
                </div>
              </div>
              {/* 12 周专属四统计：连续 / 总专注 / 活跃天数 / 单日最佳（与本周 Strip 不重复） */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line-soft pt-4 sm:grid-cols-4">
                <div className="min-w-0">
                  <p className="text-[20px] font-semibold leading-none tracking-[-0.02em] text-charcoal tabular-nums">
                    <span data-testid="momentum-streak-value">{data.streakDays} 天</span>
                  </p>
                  <p className="mt-1.5 text-[11px] leading-snug text-sandrift">
                    连续学习 · {data.activeToday ? "今日已投入" : data.streakDays > 0 ? "今天继续保持" : "今天开始第一天"}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[20px] font-semibold leading-none tracking-[-0.02em] text-charcoal tabular-nums">
                    {formatHours(data.totalMinutes)}
                  </p>
                  <p className="mt-1.5 text-[11px] leading-snug text-sandrift">近 {MOMENTUM_WEEKS} 周总专注</p>
                </div>
                <div className="min-w-0">
                  <p className="text-[20px] font-semibold leading-none tracking-[-0.02em] text-charcoal tabular-nums">
                    {data.activeDays} 天
                  </p>
                  <p className="mt-1.5 text-[11px] leading-snug text-sandrift">活跃天数</p>
                </div>
                <div className="min-w-0">
                  <p className="text-[20px] font-semibold leading-none tracking-[-0.02em] text-charcoal tabular-nums">
                    {data.bestDay ? formatHours(data.bestDay.minutes) : "—"}
                  </p>
                  <p className="mt-1.5 text-[11px] leading-snug text-sandrift">
                    单日最佳{data.bestDay ? ` · ${formatMonthDay(data.bestDay.date)}` : ""}
                  </p>
                </div>
              </div>
              {/* 全零空态弱提示（84 天全 0 时热力空白，给一个开始入口而非沉默数字） */}
              {data.activeDays === 0 && data.totalMinutes === 0 && (
                <p className="text-[11px] text-sandrift">
                  完成 1 个任务或专注 1 次即可点亮。
                </p>
              )}
            </div>
          )}
        </div>
      </DisclosureRegion>
    </section>
  );
}
