"use client";

import React, { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { useStudyMomentum } from "@/hooks/useStudyMomentum";
import { MOMENTUM_WEEKS, type MomentumDay, type StudyMomentum } from "@/lib/analytics/momentum";
import { cn } from "@/lib/utils";

/** 热力等级 → 底色（charcoal 系阶梯；未知日同底 + 虚线框 + 降透明区分） */
const LEVEL_FILL = ["#F0EBE1", "#D9CFC2", "#CDB9AB", "#A48F82", "#313032"];

function formatHours(minutes: number): string {
  const h = minutes / 60;
  return h >= 10 ? `${Math.round(h)} 小时` : `${Math.round(h * 10) / 10} 小时`;
}

/** 卡片三列统计的紧凑日期（与趋势轴 M/d 一致，避免窄列折出单字） */
function formatMonthDayShort(dateStr: string): string {
  return `${Number(dateStr.slice(5, 7))}/${Number(dateStr.slice(8, 10))}`;
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

function MomentumHeatmap({
  columns,
  shownMonths,
  compact = false,
}: {
  columns: ({ day: MomentumDay | null })[][];
  shownMonths: (string | null)[];
  compact?: boolean;
}) {
  return (
    <div
      data-testid="momentum-heatmap"
      role="img"
      aria-label={`近 ${MOMENTUM_WEEKS} 周学习热力`}
      className={cn("flex overflow-x-auto pb-1", compact ? "gap-0.5" : "gap-1")}
    >
      {columns.map((col, ci) => (
        <div key={ci} className={cn("flex shrink-0 flex-col", compact ? "gap-0.5" : "gap-1")}>
          <span
            className={cn(
              "whitespace-nowrap text-sandrift",
              compact ? "h-3 text-[9px] font-medium" : "h-4 text-[10px] font-semibold"
            )}
            aria-hidden="true"
          >
            {shownMonths[ci] ?? ""}
          </span>
          {col.map(({ day }, ri) =>
            day === null ? (
              <span key={ri} className={compact ? "h-3 w-3" : "h-5 w-5"} aria-hidden="true" />
            ) : (
              <span
                key={day.date}
                aria-hidden="true"
                data-level={day.level}
                data-unknown={day.unknown || undefined}
                className={cn(
                  compact ? "h-3 w-3 rounded-[2px]" : "h-5 w-5 rounded-[5px]",
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
  );
}

function MomentumLegend({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={cn("flex items-center gap-1 text-sandrift", compact ? "text-[9px]" : "text-[10px]")}
      aria-hidden="true"
    >
      少
      {[0, 1, 2, 3, 4].map((l) => (
        <span
          key={l}
          className={cn("inline-block rounded-[2px]", compact ? "h-2 w-2" : "h-2.5 w-2.5")}
          style={{ backgroundColor: LEVEL_FILL[l] }}
        />
      ))}
      多
    </span>
  );
}

function MomentumStats({ data, compact = false }: { data: StudyMomentum; compact?: boolean }) {
  return (
    <div
      className={cn(
        "grid grid-cols-2",
        compact
          ? "shrink-0 gap-x-5 gap-y-2 sm:grid-cols-4"
          : "gap-x-6 gap-y-4 border-t border-line-soft pt-4 sm:grid-cols-4"
      )}
    >
      <div className="min-w-0">
        <p
          className={cn(
            "font-semibold leading-none tracking-[-0.02em] text-charcoal tabular-nums",
            compact ? "text-[15px]" : "text-[20px]"
          )}
        >
          <span data-testid="momentum-streak-value">{data.streakDays} 天</span>
        </p>
        <p className={cn("leading-snug text-sandrift", compact ? "mt-1 text-[10px]" : "mt-1.5 text-[11px]")}>
          连续学习 · {data.activeToday ? "今日已投入" : data.streakDays > 0 ? "今天继续保持" : "今天开始第一天"}
        </p>
      </div>
      <div className="min-w-0">
        <p
          className={cn(
            "font-semibold leading-none tracking-[-0.02em] text-charcoal tabular-nums",
            compact ? "text-[15px]" : "text-[20px]"
          )}
        >
          {formatHours(data.totalMinutes)}
        </p>
        <p className={cn("leading-snug text-sandrift", compact ? "mt-1 text-[10px]" : "mt-1.5 text-[11px]")}>
          近 {MOMENTUM_WEEKS} 周总专注
        </p>
      </div>
      <div className="min-w-0">
        <p
          className={cn(
            "font-semibold leading-none tracking-[-0.02em] text-charcoal tabular-nums",
            compact ? "text-[15px]" : "text-[20px]"
          )}
        >
          {data.activeDays} 天
        </p>
        <p className={cn("leading-snug text-sandrift", compact ? "mt-1 text-[10px]" : "mt-1.5 text-[11px]")}>
          活跃天数
        </p>
      </div>
      <div className="min-w-0">
        <p
          className={cn(
            "font-semibold leading-none tracking-[-0.02em] text-charcoal tabular-nums",
            compact ? "text-[15px]" : "text-[20px]"
          )}
        >
          {data.bestDay ? formatHours(data.bestDay.minutes) : "—"}
        </p>
        <p className={cn("leading-snug text-sandrift", compact ? "mt-1 text-[10px]" : "mt-1.5 text-[11px]")}>
          单日最佳{data.bestDay ? ` · ${formatMonthDayShort(data.bestDay.date)}` : ""}
        </p>
      </div>
    </div>
  );
}

/** 卡片模式：12 周 × 7 天，横向铺满卡片宽度（grid-flow-col 保持周列语义） */
function MomentumCardHeatmap({
  columns,
  shownMonths,
}: {
  columns: ({ day: MomentumDay | null })[][];
  shownMonths: (string | null)[];
}) {
  const cells = columns.flatMap((col) => col);
  return (
    <div className="w-full">
      {/* 月刻度与热力共用 auto-cols-fr 列模型：列数 = 13（首周补齐）时也不会换行/错位 */}
      <div className="grid auto-cols-fr grid-flow-col gap-1 pb-1">
        {shownMonths.map((m, i) => (
          <span key={i} className="whitespace-nowrap text-[9px] font-medium text-sandrift" aria-hidden="true">
            {m ?? ""}
          </span>
        ))}
      </div>
      <div
        data-testid="momentum-heatmap"
        role="img"
        aria-label={`近 ${MOMENTUM_WEEKS} 周学习热力`}
        className="grid auto-cols-fr grid-flow-col grid-rows-7 gap-1"
      >
        {cells.map(({ day }, i) =>
          day === null ? (
            <span key={i} className="h-2.5 w-full" aria-hidden="true" />
          ) : (
            <span
              key={day.date}
              aria-hidden="true"
              data-level={day.level}
              data-unknown={day.unknown || undefined}
              className={cn(
                "h-2.5 w-full rounded-[2px]",
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
    </div>
  );
}

/**
 * Card loading skeleton：几何与最终 card 内容同构（streak / 12 周热力 / 三统计），
 * 避免 momentum 异步晚到时把整行撑高，导致 top grid 二次跳动。
 */
function MomentumCardSkeleton() {
  return (
    <div
      data-testid="analytics-momentum-skeleton"
      aria-label="动量加载中"
      className="ux-skeleton flex min-w-0 flex-1 flex-col"
    >
      <div className="flex flex-1 flex-col gap-4 md:flex-row md:items-stretch lg:flex-col lg:gap-0">
        <div className="flex min-w-0 flex-1 flex-col md:max-w-[520px] lg:max-w-none">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="h-[14px] w-14 rounded bg-alabaster" />
              <div className="mt-1 h-[26px] w-20 rounded bg-alabaster" />
            </div>
            <div className="mb-0.5 h-[14px] w-16 rounded bg-alabaster/80" />
          </div>
          <div className="mt-2.5">
            <div className="grid auto-cols-fr grid-flow-col gap-1 pb-1">
              {Array.from({ length: 13 }).map((_, i) => (
                <span key={i} className="h-[14px] rounded bg-alabaster/70" />
              ))}
            </div>
            <div className="grid auto-cols-fr grid-flow-col grid-rows-7 gap-1">
              {Array.from({ length: 13 * 7 }).map((_, i) => (
                <span key={i} className="h-2.5 w-full rounded-[2px] bg-alabaster" />
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 border-t border-line-soft pt-2.5 md:w-[200px] md:shrink-0 md:grid-cols-1 md:gap-2 md:self-center md:border-t-0 md:border-l md:pl-4 md:pt-0 lg:mt-auto lg:w-auto lg:grid-cols-3 lg:gap-3 lg:self-stretch lg:border-l-0 lg:border-t lg:border-line-soft lg:pl-0 lg:pt-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="min-w-0">
              <div className="h-4 w-12 rounded bg-alabaster" />
              <div className="mt-1 h-[14px] w-16 rounded bg-alabaster/80" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


/**
 * 学习动量（对标 GitHub contributions + Duolingo streak）：
 * 12 周热力 + 12 周专属四统计（连续 / 总专注 / 活跃天数 / 单日最佳）。
 * 统计口径均为 12 周独立查询结果（与本周 Strip 不重复：Strip 是本周，环已删除，
 * 计划达成/按时完成只看 Strip）。数据独立查询（与 range preset 无关），
 * 纯新增表达层，不碰既有标题/testid/口径。
 *
 * embedded：作为「学习趋势」块的下半段使用，去掉独立 section/折叠头，热力与统计并排，
 * 让趋势 + 动量在一屏内完成总览。
 */
export function AnalyticsMomentum({ embedded = false, card = false }: { embedded?: boolean; card?: boolean }) {
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

  // card：独立圆角区块内的动量视图（大连续天数 + 经典 12 周热力 + 三项统计）
  if (card) {
    return (
      <div data-testid="analytics-momentum" className="flex min-w-0 flex-1 flex-col">
        {error || (!loading && !data) ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
            <p className="text-[11px] font-medium text-danger">学习动量加载失败</p>
            <button
              type="button"
              onClick={() => refresh()}
              className="text-[11px] font-semibold text-charcoal underline underline-offset-2 hover:text-black transition-colors"
            >
              重试
            </button>
          </div>
        ) : loading || !data ? (
          <MomentumCardSkeleton />
        ) : (
          <>
            <div className="ux-fade flex flex-1 flex-col gap-4 md:flex-row md:items-stretch lg:flex-col lg:gap-0">
              <div className="flex min-w-0 flex-1 flex-col md:max-w-[520px] lg:max-w-none">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[10.5px] font-medium text-sandrift">连续学习</p>
                    <p className="mt-1 text-[26px] font-semibold leading-none tracking-[-0.03em] text-charcoal tabular-nums">
                      <span data-testid="momentum-streak-value">{data.streakDays} 天</span>
                    </p>
                  </div>
                  <p className="pb-0.5 text-[10.5px] text-sandrift">
                    {data.activeToday ? "今日已投入" : data.streakDays > 0 ? "今天继续保持" : "今天开始第一天"}
                  </p>
                </div>
                <div className="mt-2.5">
                  <MomentumCardHeatmap columns={columns} shownMonths={shownMonths} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 border-t border-line-soft pt-2.5 md:w-[200px] md:shrink-0 md:grid-cols-1 md:gap-2 md:self-center md:border-t-0 md:border-l md:pl-4 md:pt-0 lg:mt-auto lg:w-auto lg:grid-cols-3 lg:gap-3 lg:self-stretch lg:border-l-0 lg:border-t lg:border-line-soft lg:pl-0 lg:pt-2.5">
                <div className="min-w-0">
                  <p className="text-[16px] font-semibold leading-none tracking-[-0.02em] text-charcoal tabular-nums">
                    {formatHours(data.totalMinutes)}
                  </p>
                  <p className="mt-1 text-[10.5px] text-sandrift">近 12 周总专注</p>
                </div>
                <div className="min-w-0">
                  <p className="text-[16px] font-semibold leading-none tracking-[-0.02em] text-charcoal tabular-nums">
                    {data.activeDays} 天
                  </p>
                  <p className="mt-1 text-[10.5px] text-sandrift">活跃天数</p>
                </div>
                <div className="min-w-0">
                  <p className="text-[16px] font-semibold leading-none tracking-[-0.02em] text-charcoal tabular-nums">
                    {data.bestDay ? formatHours(data.bestDay.minutes) : "—"}
                  </p>
                  <p className="mt-1 text-[10.5px] text-sandrift">
                    单日最佳{data.bestDay ? ` · ${formatMonthDayShort(data.bestDay.date)}` : ""}
                  </p>
                </div>
              </div>
            </div>
            {data.activeDays === 0 && data.totalMinutes === 0 && (
              <p className="mt-2 text-center text-[10.5px] text-sandrift">完成 1 个任务或专注 1 次即可点亮。</p>
            )}
          </>
        )}
      </div>
    );
  }

  // embedded：无独立 section 头，错误/加载也保持紧凑
  if (embedded) {
    return (
      <div data-testid="analytics-momentum" className="min-w-0">
        {error || (!loading && !data) ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-danger">学习动量加载失败，请稍后重试。</p>
            <button
              type="button"
              onClick={() => refresh()}
              className="text-[11px] font-semibold text-charcoal underline underline-offset-2 hover:text-black transition-colors"
            >
              重试
            </button>
          </div>
        ) : loading || !data ? (
          <div className="ux-skeleton h-24 w-full rounded-lg bg-alabaster animate-pulse" aria-label="动量加载中" />
        ) : (
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-start gap-x-7 gap-y-3">
              <div className="min-w-[190px] flex-1">
                <div className="flex items-center justify-between gap-2 pb-1.5">
                  <p className="text-[11px] font-medium text-sandrift">学习动量 · 近 {MOMENTUM_WEEKS} 周</p>
                  <MomentumLegend compact />
                </div>
                <MomentumHeatmap columns={columns} shownMonths={shownMonths} compact />
              </div>
              <MomentumStats data={data} compact />
            </div>
            {data.activeDays === 0 && data.totalMinutes === 0 && (
              <p className="text-[10.5px] text-sandrift">完成 1 个任务或专注 1 次即可点亮。</p>
            )}
          </div>
        )}
      </div>
    );
  }

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
              <div>
                <MomentumHeatmap columns={columns} shownMonths={shownMonths} />
                <div className="mt-2 flex items-center justify-end text-[10px] text-sandrift">
                  <MomentumLegend />
                </div>
              </div>
              <MomentumStats data={data} />
              {data.activeDays === 0 && data.totalMinutes === 0 && (
                <p className="text-[11px] text-sandrift">完成 1 个任务或专注 1 次即可点亮。</p>
              )}
            </div>
          )}
        </div>
      </DisclosureRegion>
    </section>
  );
}





