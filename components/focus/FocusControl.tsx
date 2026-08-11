"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Timer, X, Square, ChevronDown } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { FocusSession } from "@/types";
import { deriveFocusClock } from "@/lib/focus/focusDomain";
import { cn } from "@/lib/utils";

const PRESETS = [15, 25, 30, 45, 60];

const ERROR_MESSAGES: Record<string, string> = {
  FOCUS_SESSION_ALREADY_ACTIVE: "已有进行中的专注会话",
  NO_ACTIVE_FOCUS_SESSION: "当前没有进行中的专注",
  FOCUS_ALREADY_PAUSED: "专注已处于暂停状态",
  FOCUS_NOT_PAUSED: "专注未处于暂停状态",
  INVALID_FOCUS_DURATION: "专注时长需为 1–240 的整数",
  FOCUS_TARGET_NOT_FOUND: "关联的课程或任务不存在",
  FOCUS_TARGET_MISMATCH: "任务与课程不匹配",
};

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  if (h >= 1) return `${h}:${p(m)}:${p(s)}`;
  return `${p(m)}:${p(s)}`;
}

/**
 * Overview 总览日历 Header 的低侵入 Focus 入口（Task 4，UI-only）。
 * - Idle：[开始专注] → anchored popover（presets + 自定义时长 + 关联对象 + 备注）
 * - Running：[● 24:36 · 专注中]（每秒本地刷新显示，只读 deriveFocusClock，不写 Store）
 * - Paused：[Ⅱ 24:36 · 已暂停]（倒计时冻结）
 * - 提前结束：finishFocusSession() + 轻量 Toast（不播完成音 / 不发系统通知）
 */
export function FocusControl() {
  const focusSessions = useAppStore((s) => s.focusSessions);
  const assignments = useAppStore((s) => s.assignments);
  const courses = useAppStore((s) => s.courses);
  const pushToast = useToastStore((s) => s.pushToast);

  const active = useMemo(
    () => focusSessions.find((s) => s.status === "running" || s.status === "paused") ?? null,
    [focusSessions]
  );

  const [open, setOpen] = useState(false);
  const [planned, setPlanned] = useState("30");
  const [target, setTarget] = useState("none");
  const [note, setNote] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // 每秒本地刷新（仅显示；不写 Store）
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!open && !active) return;
    const t = window.setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open, active]);

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

  const now = Date.now();
  const clock = active ? deriveFocusClock(active, now) : null;
  const remainingText = clock ? formatClock(clock.remainingMs) : "";

  const toastError = (code: string) => {
    pushToast({ type: "warning", message: ERROR_MESSAGES[code] ?? "操作失败，请重试" });
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

  const buttonLabel = active
    ? active.status === "running"
      ? `● ${remainingText} · 专注中`
      : `Ⅱ ${remainingText} · 已暂停`
    : "开始专注";

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        data-testid="focus-control"
        className={cn(
          "flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-lg font-bold transition-colors",
          active
            ? active.status === "running"
              ? "bg-pastel-mint hover:bg-pastel-mint text-charcoal"
              : "bg-alabaster hover:bg-alba text-satin-grey"
            : "bg-alabaster hover:bg-alba text-charcoal"
        )}
      >
        {active ? (
          active.status === "running" ? (
            <Timer className="w-3 h-3" />
          ) : (
            <Pause className="w-3 h-3" />
          )
        ) : (
          <Play className="w-3 h-3" />
        )}
        {buttonLabel}
        <ChevronDown className="w-2.5 h-2.5 opacity-60" />
      </button>

      {open && (
        <div
          data-testid="focus-popover"
          className="absolute right-0 top-full mt-1.5 w-[260px] bg-surface border border-line-strong rounded-2xl shadow-card p-3 space-y-3 text-xs z-40 ux-inline"
        >
          {!active ? (
            <>
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold text-sandrift uppercase tracking-wider">专注时间</p>
                <div className="flex items-center gap-1">
                  {PRESETS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setPlanned(String(p))}
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
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="w-full px-2 py-1.5 bg-[#F7F5F5] border border-line rounded-lg text-[11px] text-charcoal focus:outline-none cursor-pointer"
                >
                  <option value="none">不关联</option>
                  {courses.length > 0 && (
                    <optgroup label="课程">
                      {courses.map((c) => (
                        <option key={c.id} value={`course:${c.id}`}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {assignments.filter((a) => a.status !== "completed").length > 0 && (
                    <optgroup label="任务">
                      {assignments
                        .filter((a) => a.status !== "completed")
                        .map((a) => (
                          <option key={a.id} value={`assignment:${a.id}`}>
                            {a.title}
                          </option>
                        ))}
                    </optgroup>
                  )}
                </select>
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
            </>
          ) : (
            <>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-sandrift uppercase tracking-wider">专注中</p>
                <p className="text-xs font-bold text-charcoal truncate">{snapshotLabel}</p>
                {active.note && <p className="text-[10px] text-satin-grey break-words">{active.note}</p>}
                <p className="text-[10px] text-sandrift">
                  剩余 <span className="font-mono font-bold text-charcoal">{remainingText}</span>
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
            </>
          )}

          <div className="flex items-center justify-end">
            <button
              onClick={() => setOpen(false)}
              aria-label="关闭专注"
              className="p-1 rounded-lg text-sandrift hover:text-charcoal hover:bg-alabaster transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
