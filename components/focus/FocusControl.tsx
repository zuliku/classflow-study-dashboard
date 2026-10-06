"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Timer, X, Square, ChevronDown } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { FocusSession } from "@/types";
import { deriveFocusClock } from "@/lib/focus/focusDomain";
import { FOCUS_ERROR_MESSAGES, FOCUS_PRESETS, formatFocusClock } from "@/lib/focus/focusView";
import { cn } from "@/lib/utils";
import { UISelect } from "@/components/ui/Select";
import { usePresence } from "@/lib/usePresence";
import { MOTION_EXIT_MS } from "@/lib/motion";

/**
 * Overview 总览日历 Header 的低侵入 Focus 入口（Task 4，UI-only）。
 * - Idle：[开始专注] → anchored popover（presets + 自定义时长 + 关联对象 + 备注）
 * - Running：[24:36 · 专注中]（每秒本地刷新显示，只读 deriveFocusClock，不写 Store）
 * - Paused：[24:36 · 已暂停]（倒计时冻结）
 * - 提前结束：finishFocusSession() + 轻量 Toast（不播完成音 / 不发系统通知）
 *
 * compact（Desktop MiniCalendar Header 窄空间）：只保留主状态图标
 * （Play / Timer / Pause），隐藏文字与 chevron；点击行为不变（打开 Popover）。
 */
/** P0 流畅度：每秒 tick 下沉到叶子，避免整颗 FocusControl（含课程/任务 options 全量 map）每秒重渲染 */
function useNowTick(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    // 对齐秒边界，减少漂移导致的额外帧
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [enabled]);
  return now;
}

function FocusButtonLabel({ active }: { active: FocusSession | null }) {
  const now = useNowTick(!!active);
  const clock = active ? deriveFocusClock(active, now) : null;
  const remainingText = clock ? formatFocusClock(clock.remainingMs) : "";
  if (!active) return <>开始专注</>;
  return <>{active.status === "running" ? `${remainingText} · 专注中` : `${remainingText} · 已暂停`}</>;
}

function FocusRemainingInline({ active }: { active: FocusSession }) {
  const now = useNowTick(true);
  const clock = deriveFocusClock(active, now);
  return <span className="font-mono font-bold text-charcoal tabular-nums">{formatFocusClock(clock.remainingMs)}</span>;
}

export function FocusControl({ compact = false }: { compact?: boolean }) {
  const focusSessions = useAppStore((s) => s.focusSessions);
  const assignments = useAppStore((s) => s.assignments);
  const courses = useAppStore((s) => s.courses);
  const pushToast = useToastStore((s) => s.pushToast);

  const active = useMemo(
    () => focusSessions.find((s) => s.status === "running" || s.status === "paused") ?? null,
    [focusSessions]
  );

  const [open, setOpen] = useState(false);
  // popover 对称进退（fast 档；此前关闭直接卸载无退出，Idle/Running 整块换体硬切）
  const { mounted, visible } = usePresence(open, MOTION_EXIT_MS.fast);
  const getDefaultPlanned = () => String(useAppStore.getState().preferences.focusDefaultMinutes);
  const [planned, setPlanned] = useState(getDefaultPlanned);
  const [target, setTarget] = useState("none");
  const [note, setNote] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setPlanned(getDefaultPlanned());
    }
  }, [open]);

  // 关联对象选项：memo 化，避免父级任何重渲染都 O(n) 重建（之前每秒 tick 重建一次）
  const targetOptions = useMemo(
    () => [
      { value: "none", label: "不关联" },
      ...courses.map((c) => ({ value: `course:${c.id}`, label: `课程 · ${c.name}` })),
      ...assignments
        .filter((a) => a.status !== "completed")
        .map((a) => ({ value: `assignment:${a.id}`, label: `任务 · ${a.title}` })),
    ],
    [courses, assignments]
  );

  // Escape / 点击组件外关闭（不引入全局 overlay stack）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const toastError = (code: string) => {
    pushToast({ type: "warning", message: FOCUS_ERROR_MESSAGES[code] ?? "操作失败，请重试" });
  };

  const start = () => {
    const minutes = Number(planned);
    if (!Number.isInteger(minutes)) {
      toastError("INVALID_FOCUS_DURATION");
      return;
    }
    const [kind, id] = target.split(":");
    const result = useAppStore.getState().startFocusSession({
      plannedMinutes: minutes,
      assignmentId: kind === "assignment" ? id : undefined,
      courseId: kind === "course" ? id : undefined,
      note: note.trim() || undefined,
      source: "manual",
    });
    if (!result.ok) {
      toastError(result.code);
      return;
    }
    setOpen(false);
    setNote("");
    pushToast({ message: `开始专注 · ${minutes} 分钟` });
  };

  const pause = () => {
    const r = useAppStore.getState().pauseFocusSession();
    if (!r.ok) toastError(r.code);
  };

  const resume = () => {
    const r = useAppStore.getState().resumeFocusSession();
    if (!r.ok) toastError(r.code);
  };

  const finish = () => {
    const r = useAppStore.getState().finishFocusSession();
    if (!r.ok) {
      toastError(r.code);
      return;
    }
    const minutes = Math.max(1, Math.round((r.session.actualActiveMs ?? 0) / 60_000));
    pushToast({ message: `已结束专注 · 本次 ${minutes} 分钟` });
    setOpen(false);
  };

  const activeAssignment = active?.assignmentId
    ? assignments.find((a) => a.id === active.assignmentId)
    : undefined;
  const snapshotLabel =
    active?.assignmentTitleSnapshot ?? active?.courseNameSnapshot ?? activeAssignment?.title ?? "未关联";

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        data-testid="focus-control"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={active ? `专注 ${active.status === "running" ? "进行中" : "已暂停"}` : "开始专注"}
        className={cn(
          "flex items-center gap-1 text-[11px] h-8 rounded-lg font-bold transition-colors",
          compact ? "w-8 justify-center px-0" : "px-2",
          active
            ? active.status === "running"
              ? "bg-pastel-mint hover:bg-pastel-mint text-charcoal"
              : "bg-alabaster hover:bg-alba text-satin-grey"
            : "bg-alabaster hover:bg-alba text-charcoal"
        )}
      >
        {active ? (
          active.status === "running" ? (
            <Timer className={compact ? "w-3.5 h-3.5" : "w-3 h-3"} />
          ) : (
            <Pause className={compact ? "w-3.5 h-3.5" : "w-3 h-3"} />
          )
        ) : (
          <Play className={compact ? "w-3.5 h-3.5" : "w-3 h-3"} />
        )}
        {!compact && <FocusButtonLabel active={active} />}
        {!compact && <ChevronDown className="w-2.5 h-2.5 opacity-60" />}
      </button>

      {mounted && (
        <div
          data-testid="focus-popover"
          role="dialog"
          aria-label="专注设置"
          className={cn(
            "absolute right-0 top-full mt-1.5 w-[260px] bg-surface border border-line-strong rounded-2xl shadow-card p-3 space-y-3 text-xs z-40 ux-inline",
            visible
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-1 pointer-events-none !duration-[var(--motion-exit-fast)] !ease-[var(--ease-exit)]"
          )}
        >
          {/* Workflow UX M4.1：单一关闭入口——右上角绝对定位，Idle/Running/Paused 共享 */}
          <button
            onClick={() => setOpen(false)}
            aria-label="关闭专注"
            className="absolute right-2.5 top-2.5 z-10 p-1 rounded-lg text-sandrift hover:text-charcoal hover:bg-alabaster transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          {/* Idle / Running 整块切换：keyed + 淡入（此前整 Popover 换体硬切） */}
          {!active ? (
            <div key="idle" className="ux-fade space-y-3">
              <div className="space-y-1.5 pr-8">
                <p className="text-[10px] font-bold text-sandrift uppercase tracking-wider">专注时间</p>
                  <div className="flex items-center gap-1">
                    {FOCUS_PRESETS.map((p) => (
                      <button
                        key={p}
                        onClick={() => setPlanned(String(p))}
                        aria-pressed={planned === String(p)}
                        className={cn(
                        "px-2 py-1 rounded-lg text-[11px] font-bold transition-colors",
                        planned === String(p)
                          ? "bg-charcoal text-white"
                          : "bg-[#F7F5F5] text-satin-grey hover:text-charcoal"
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    max={240}
                    value={planned}
                    onChange={(e) => setPlanned(e.target.value)}
                    aria-label="自定义专注时长（分钟）"
                    className="w-full px-2 py-1.5 bg-[#F7F5F5] border border-line rounded-lg text-[11px] font-mono text-charcoal focus:outline-none"
                  />
                  <span className="text-[10px] text-sandrift shrink-0">分钟</span>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-[10px] font-bold text-sandrift uppercase tracking-wider">关联对象</p>
                <UISelect value={target} onChange={setTarget} ariaLabel="关联对象" options={targetOptions} />
              </div>

              <div className="space-y-1">
                <p className="text-[10px] font-bold text-sandrift uppercase tracking-wider">专注说明</p>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 200))}
                  maxLength={200}
                  placeholder="可选"
                  aria-label="专注说明"
                  className="w-full px-2 py-1.5 bg-[#F7F5F5] border border-line rounded-lg text-[11px] text-charcoal placeholder:text-sandrift focus:outline-none resize-none h-14"
                />
              </div>

              <button
                onClick={start}
                className="ux-press w-full flex items-center justify-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black transition-colors"
              >
                <Play className="w-3 h-3" />
                开始专注
              </button>
            </div>
          ) : (
            <div key="active" className="ux-fade space-y-3">
              <div className="space-y-1 pr-8">
                <p className="text-[10px] font-bold text-sandrift uppercase tracking-wider">专注中</p>
                <p className="text-xs font-bold text-charcoal truncate">{snapshotLabel}</p>
                {active.note && <p className="text-[10px] text-satin-grey break-words">{active.note}</p>}
                <p className="text-[10px] text-sandrift">
                  剩余 <FocusRemainingInline active={active} />
                  {active.status === "paused" && " · 已暂停"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {active.status === "running" ? (
                  <button
                    onClick={pause}
                    className="flex-1 flex items-center justify-center gap-1 px-3 h-8 rounded-lg text-[11px] font-bold text-charcoal bg-alabaster hover:bg-alba transition-colors"
                  >
                    <Pause className="w-3 h-3" />
                    暂停
                  </button>
                ) : (
                  <button
                    onClick={resume}
                    className="flex-1 flex items-center justify-center gap-1 px-3 h-8 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black transition-colors"
                  >
                    <Play className="w-3 h-3" />
                    继续
                  </button>
                )}
                <button
                  onClick={finish}
                  className="flex-1 flex items-center justify-center gap-1 px-3 h-8 rounded-lg text-[11px] font-bold text-danger bg-danger-bg hover:bg-danger-bg transition-colors"
                >
                  <Square className="w-3 h-3" />
                  提前结束
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
