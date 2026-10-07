"use client";

import React, { useMemo, useState } from "react";
import { Flame, ChevronDown } from "lucide-react";
import { AnalyticsCardHeader } from "@/components/analytics/AnalyticsCardHeader";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { useStudyMomentum } from "@/hooks/useStudyMomentum";
import { MOMENTUM_WEEKS, type MomentumDay } from "@/lib/analytics/momentum";
import { cn } from "@/lib/utils";

/** 热力等级 → 底色（charcoal 系阶梯；未知日同底 + 虚线框 + 降透明区分） */
const LEVEL_FILL = ["#F0EBE1", "#D9CFC2", "#CDB9AB", "#A48F82", "#313032"];

function Ring({
  fraction,
  label,
  display,
  toneClass,
  trackClass = "text-alabaster",
  size = 60,
  bare = false,
}: {
  /** 0..1，null = 无数据（空环） */
  fraction: number | null;
  label: string;
  display: string;
  toneClass: string;
  trackClass?: string;
  size?: number;
  /** 紧凑横 tile 内使用：只画环，文字由外部排版 */
  bare?: boolean;
}) {
  const r = size * 0.4;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const f = fraction === null ? 0 : Math.min(1, Math.max(0, fraction));
  const strokeWidth = Math.max(5, size * 0.115);
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}${display}`}>
        <circle cx={c} cy={c} r={r} fill="none" strokeWidth={strokeWidth} className={trackClass} stroke="currentColor" />
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className={toneClass}
          stroke="currentColor"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - f)}
          transform={`rotate(-90 ${c} ${c})`}
        />
      </svg>
      {!bare && (
        <>
          <p className="text-[11px] font-bold text-charcoal tabular-nums">{display}</p>
          <p className="text-[10px] text-sandrift -mt-0.5">{label}</p>
        </>
      )}
    </div>
  );
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
 * 12 周热力 + 连续学习天数 + 计划/按时双环。数据独立查询（与 range preset 无关），
 * 纯新增表达层，不碰既有标题/testid/口径。
 */
export function AnalyticsMomentum({
  planRatio,
  onTimeRate,
}: {
  /** 计划达成比（百分比，如 125；null = 不可算） */
  planRatio: number | null;
  /** 按时率（百分比 0..100；null = 不可算） */
  onTimeRate: number | null;
}) {
  const [open, setOpen] = useState(true);
  const { data, loading, error } = useStudyMomentum();
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

  if (error || (!loading && !data)) return null;

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
        <div
          data-testid="analytics-momentum"
          className="bg-surface border border-line rounded-2xl p-4 shadow-subtle"
        >
          <AnalyticsCardHeader eyebrow="坚持与热度" title="12 周投入热力" />
          {loading || !data ? (
            <div className="ux-skeleton h-[220px] mt-3 w-full rounded-xl bg-alabaster animate-pulse" aria-label="动量加载中" />
          ) : (
            <div className="pt-3 flex flex-col gap-3">
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
                            title={cellTitle(day)}
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
                <div className="mt-2 flex items-center justify-between text-[10px] text-sandrift">
                  <span>
                    近 {MOMENTUM_WEEKS} 周共专注 {Math.round(data.totalMinutes / 60)} 小时
                  </span>
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
              {/* 三统计压缩横 tile：连续 / 计划达成 / 按时完成 */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-alabaster/50 border border-line-soft px-3 py-2.5 flex items-center gap-2.5 min-w-0">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger/10 text-warning">
                    <Flame className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-lg font-extrabold text-charcoal tabular-nums leading-none">
                      <span data-testid="momentum-streak-value">{data.streakDays} 天</span>
                    </span>
                    <span className="mt-1 block text-[10px] text-sandrift">
                      连续学习 · {data.activeToday ? "今日已投入" : data.streakDays > 0 ? "今天继续保持" : "今天开始第一天"}
                    </span>
                  </span>
                </div>
                <div className="rounded-xl bg-alabaster/50 border border-line-soft px-3 py-2.5 flex items-center gap-2.5 min-w-0">
                  <Ring
                    fraction={planRatio === null ? null : planRatio / 100}
                    label="计划达成"
                    display={planRatio === null ? "—" : `${Math.round(planRatio)}%`}
                    toneClass="text-sandrift"
                    size={44}
                    bare
                  />
                  <span className="min-w-0">
                    <span className="block text-lg font-extrabold text-charcoal tabular-nums leading-none">
                      {planRatio === null ? "—" : `${Math.round(planRatio)}%`}
                    </span>
                    <span className="mt-1 block text-[10px] text-sandrift">计划达成</span>
                  </span>
                </div>
                <div className="rounded-xl bg-alabaster/50 border border-line-soft px-3 py-2.5 flex items-center gap-2.5 min-w-0">
                  <Ring
                    fraction={onTimeRate === null ? null : onTimeRate / 100}
                    label="按时完成"
                    display={onTimeRate === null ? "—" : `${Math.round(onTimeRate)}%`}
                    toneClass="text-success"
                    size={44}
                    bare
                  />
                  <span className="min-w-0">
                    <span className="block text-lg font-extrabold text-charcoal tabular-nums leading-none">
                      {onTimeRate === null ? "—" : `${Math.round(onTimeRate)}%`}
                    </span>
                    <span className="mt-1 block text-[10px] text-sandrift">按时完成</span>
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </DisclosureRegion>
    </section>
  );
}
