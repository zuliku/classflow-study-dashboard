"use client";

import React, { useEffect, useState } from "react";
import { AlarmClockCheck, Bell, CalendarDays, Check, Clock, Trash2, X } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { CalendarMark, Reminder } from "@/types";
import { parseLocalDDL } from "@/lib/ddl";
import { resolveDDLCalendarMarkAnchor } from "@/lib/reminders/autoDeadlineReminder";
import { resolveReminderTriggerAt } from "@/lib/reminders/reminderDomain";
import { ASSIGNMENT_REMINDER_PRESETS, formatAssignmentReminderLabel } from "@/lib/reminders/assignmentReminderView";
import {
  formatDeadlineView,
  formatReminderSummaryText,
  summarizeReminders,
} from "@/lib/tasks/assignmentDetailView";
import { Drawer } from "@/components/ui/Drawer";
import { IconButton } from "@/components/ui/IconButton";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import { DetailDisclosure } from "@/components/assignment/detail/DetailDisclosure";
import { openTimelineAtDate, canOpenTimelineAtDate } from "@/lib/timeline/openTimelineAtDate";
import { useConfirmStore } from "@/store/useConfirmStore";

const OVERLAY_ID = "ddl-detail-drawer";

/**
 * CalendarMark 统一 Full Detail（Workflow UX V2）：
 * selectedCalendarMarkId 的唯一 Drawer lifecycle owner，覆盖三类实体：
 * - A. Independent DDL：截止 / 剩余 / 提醒逻辑原样保留（linked mark 排除，走 AssignmentDrawer）
 * - B. exam / activity：轻量 Detail branch——只展示真实字段（title/type/date/起止时间或全天）
 *
 * 不为 CalendarMark 发明 progress / estimatedMinutes / course / location 等不存在的字段。
 * Motion/presence lifecycle（staleMark snapshot + entity swap + reduced motion）原样保留：
 * ddl → exam → activity 切换时 outer shell 不 remount；close 后 exit presence 保持最后 payload；
 * 删除实体后经 staleMark 正常播完退场。
 */
export function CalendarMarkDetailDrawer() {
  const {
    calendarMarks,
    assignments,
    semester,
    reminders,
    preferences,
    selectedCalendarMarkId,
    setSelectedCalendarMarkId,
    setActiveTab,
    setCurrentSemesterWeek,
    deleteCalendarMark,
    addReminder,
    deleteReminderByUser,
    enableAutomaticReminderForTarget,
  } = useAppStore();
  const confirmRequest = useConfirmStore((s) => s.confirm);
  const [reminderOpen, setReminderOpen] = useState(false);

  const currentMark = calendarMarks.find((m) => m.id === selectedCalendarMarkId);
  // 关闭 presence：保留最后一次内容
  const [staleMark, setStaleMark] = useState<CalendarMark | null>(null);
  useEffect(() => {
    if (currentMark) setStaleMark(currentMark);
  }, [currentMark?.id]);

  // ---- Detail entity swap lifecycle（与 AssignmentDrawer 同一 state machine）----
  // closed → open：第一帧即当前 mark（不 flash 旧 mark）；open A → open B：shell 保持 + 轻量 swap
  const currentId = currentMark?.id ?? null;
  const [prevSelectedId, setPrevSelectedId] = useState(currentId);
  const [displayedMarkId, setDisplayedMarkId] = useState<string | null>(null);
  const [swapPhase, setSwapPhase] = useState<"in" | "out">("in");

  if (currentId !== prevSelectedId) {
    setPrevSelectedId(currentId);
    const wasOpen = prevSelectedId !== null;
    if (currentId === null) {
      // closing：保留 displayed 内容供 exit presence
    } else if (!wasOpen) {
      setDisplayedMarkId(currentId);
      setSwapPhase("in");
    } else if (displayedMarkId !== currentId) {
      setSwapPhase("out");
    }
  }

  const reducedMotion = useEffectiveReducedMotion();
  useEffect(() => {
    if (currentId === null || swapPhase !== "out") return;
    if (displayedMarkId === currentId) {
      setSwapPhase("in");
      return;
    }
    if (reducedMotion) {
      setDisplayedMarkId(currentId);
      setSwapPhase("in");
      return;
    }
    const t = window.setTimeout(() => {
      setDisplayedMarkId(currentId);
      setSwapPhase("in");
    }, 60);
    return () => window.clearTimeout(t);
  }, [currentId, swapPhase, displayedMarkId, reducedMotion]);

  // 实体切换/关闭/重开：reminder 展开状态回到默认
  useEffect(() => {
    setReminderOpen(false);
  }, [currentId]);

  const mark = calendarMarks.find((m) => m.id === displayedMarkId) ?? currentMark ?? staleMark;

  // 排除规则（Domain 一致）：
  // - type="ddl" 且 sourceId 精确匹配 assignment → linked（走 AssignmentDrawer，不在此出现）
  // - type="course" 由 Course Detail 负责
  const isLinkedDdl =
    !!mark &&
    mark.type === "ddl" &&
    !!(mark.sourceId && assignments.some((a) => a.id === mark.sourceId));

  if (!mark || isLinkedDdl) return null;
  const isExamActivity = mark.type === "exam" || mark.type === "activity";

  // Temporal deep link：先释放 Drawer semantic state，再精确跳到 mark.date 所在教学周。
  // 学期范围外日期 → openTimelineAtDate 返回 false（不 clamp、不导航）。
  const timelineReachable = canOpenTimelineAtDate(mark.date, semester);
  const handleViewInTimeline = () => {
    setSelectedCalendarMarkId(null);
    openTimelineAtDate({
      date: mark.date,
      semester,
      setCurrentSemesterWeek,
      setActiveTab: (tab) => setActiveTab(tab),
    });
  };

  // Delete lifecycle：Confirm → deleteCalendarMark。Store 在 selected id 命中时自动清
  // selectedCalendarMarkId → semantic close；staleMark snapshot 保证 exit presence 内容不消失。
  const confirmDelete = () => {
    const target = mark;
    confirmRequest({
      title: target.type === "exam" ? "删除这场考试？" : target.type === "activity" ? "删除这个活动？" : "删除这个截止？",
      description: `「${target.title}」将从时间表中移除，相关提醒一并清理。`,
      confirmLabel: "删除",
      danger: true,
      onConfirm: () => {
        deleteCalendarMark(target.id);
      },
    });
  };

  const anchor = resolveDDLCalendarMarkAnchor(mark, preferences.defaultDDLTime);
  const deadline = formatDeadlineView(anchor ?? undefined, new Date());
  const reminderSummary = summarizeReminders(
    reminders,
    "calendarMark",
    mark.id,
    mark.autoReminderDisabled === true
  );
  const scheduled = reminders
    .filter(
      (r) => r.targetType === "calendarMark" && r.targetId === mark.id && r.status === "scheduled"
    )
    .sort((a, b) => (parseLocalDDL(a.triggerAt)?.getTime() ?? 0) - (parseLocalDDL(b.triggerAt)?.getTime() ?? 0));

  const handleAddPreset = (offsetMinutes: number) => {
    if (!anchor) return;
    const resolved = resolveReminderTriggerAt({
      timingMode: "relative",
      triggerAt: anchor,
      offsetMinutes,
    });
    if (!resolved) return;
    const target = parseLocalDDL(resolved);
    if (!target) return;
    const duplicate = scheduled.some((r) => {
      const t = parseLocalDDL(r.triggerAt);
      return !!t && t.getTime() === target.getTime();
    });
    if (duplicate) return;
    // mark 无 startTime 时 store 的 relative anchor 无法解析 → 落库为 absolute（最终时刻固定）
    addReminder({
      title: mark.title,
      targetType: "calendarMark",
      targetId: mark.id,
      timingMode: "absolute",
      triggerAt: resolved,
      source: "manual",
    });
  };

  const handleDeleteReminder = (id: string) => {
    deleteReminderByUser(id);
  };

  const swapContentClasses = cn(
    swapPhase === "out"
      ? "-translate-y-[3px] opacity-0 transition-[opacity,transform] duration-[60ms] ease-[var(--ease-standard)]"
      : "ux-detail-swap-in"
  );

  // exam/activity Detail 展示字段（Domain 只有 title/type/date/起止时间，不发明其它信息）
  const markTypeLabel = mark.type === "exam" ? "考试" : mark.type === "activity" ? "活动" : "截止";
  const drawerAriaLabel =
    mark.type === "exam" ? "考试详情" : mark.type === "activity" ? "活动详情" : "截止详情";
  const dateObj = new Date(`${mark.date}T00:00:00`);
  const weekdayLabel = Number.isNaN(dateObj.getTime())
    ? ""
    : ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][dateObj.getDay()];
  const datePrimary = `${Number(mark.date.slice(5, 7))}月${Number(mark.date.slice(8, 10))}日`;
  const hasTimeRange = !!mark.startTime && !!mark.endTime;
  const timeRangeText = hasTimeRange
    ? `${mark.startTime}–${mark.endTime}`
    : "全天";

  return (
    <Drawer
      presentation="floating"
      open={!!currentMark}
      onOpenChange={(next) => {
        if (!next) setSelectedCalendarMarkId(null);
      }}
      overlayId={OVERLAY_ID}
      aria-label={drawerAriaLabel}
      data-testid="calendar-mark-detail-panel"
      focusRestoreKey={currentId}
    >
      {/* HEADER：类型 breadcrumb（随 entity swap）+ 标题 + 静态关闭 */}
      <header className="shrink-0 border-b border-line bg-background px-5 pb-3.5 pt-4">
        <div className="flex items-start justify-between gap-2">
          <div
            key={displayedMarkId ?? "none"}
            className={cn("min-w-0 flex-1 space-y-2", swapContentClasses)}
          >
            <span className="flex min-w-0 items-center gap-1 text-xs font-semibold text-sandrift">
              <CalendarDays className="h-3.5 w-3.5 shrink-0 text-sandrift" />
              {markTypeLabel}
            </span>
            <h2 className="break-words text-[19px] font-bold leading-snug text-charcoal">
              {mark.title}
            </h2>
          </div>
          <IconButton
            variant="secondary"
            size="sm"
            onClick={() => setSelectedCalendarMarkId(null)}
            aria-label="关闭"
            className="shrink-0"
          >
            <X className="h-4 w-4" />
          </IconButton>
        </div>
      </header>

      {/* BODY：与 Header entity 内容同层替换（outer shell 保持 mounted；type 分支只换 content） */}
      <div
        key={displayedMarkId ?? "none"}
        className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", swapContentClasses)}
      >
        {isExamActivity ? (
          /* ---- B. exam / activity 轻量 branch：只展示真实字段 ---- */
          <div className="space-y-5 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {/* HERO：日期 + 时间 / 全天 */}
            <div className="rounded-2xl border border-line bg-background p-4 space-y-2">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-sandrift">
                <CalendarDays className="h-3 w-3 text-sandrift" />
                日期
              </p>
              <p className="text-[17px] font-bold leading-snug text-charcoal">
                {datePrimary}
                {weekdayLabel ? <span className="ml-1.5 text-[12px] font-semibold text-satin-grey">{weekdayLabel}</span> : null}
              </p>
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-satin-grey">
                <Clock className="h-3 w-3 text-sandrift" />
                {timeRangeText}
              </p>
            </div>

            {/* PRIMARY ACTIONS */}
            <div data-testid="detail-primary-actions" className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleViewInTimeline}
                disabled={!timelineReachable}
                title={!timelineReachable ? "不在当前学期范围内" : undefined}
                className="h-8 px-3"
              >
                <CalendarDays className="h-3.5 w-3.5" />
                在时间表查看
              </Button>
              <Button variant="danger" size="sm" onClick={confirmDelete} className="h-8 px-3">
                <Trash2 className="h-3.5 w-3.5" />
                删除{markTypeLabel}
              </Button>
            </div>
          </div>
        ) : (
          /* ---- A. Independent DDL：现有内容原样保留（截止 / 剩余 / 提醒） ---- */
          <div className="space-y-5 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {/* HERO：截止 + 剩余/逾期 + 提醒摘要 */}
          <div className="rounded-2xl border border-line bg-background p-4 space-y-3">
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-sandrift">
                <Clock className="h-3 w-3 text-sandrift" />
                截止时间
              </p>
              <p className="text-[17px] font-bold leading-snug text-charcoal">{deadline.primary}</p>
              {deadline.relative && (
                <p
                  className={cn(
                    "text-[12px] font-semibold",
                    deadline.overdue ? "text-danger" : "text-satin-grey"
                  )}
                >
                  {deadline.relative}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-soft pt-2.5 text-[11px] font-semibold text-satin-grey">
              <span className="flex items-center gap-1">
                <Bell className="h-3 w-3 text-sandrift" />
                {formatReminderSummaryText(reminderSummary)}
              </span>
            </div>
          </div>

          {/* PRIMARY ACTIONS */}
          <div data-testid="detail-primary-actions" className="flex flex-wrap items-center gap-1.5">
            <Button variant="secondary" size="sm" onClick={() => setReminderOpen(true)} className="h-8 px-3">
              <Bell className="h-3.5 w-3.5" />
              提醒
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleViewInTimeline}
              disabled={!timelineReachable}
              title={!timelineReachable ? "不在当前学期范围内" : undefined}
              className="h-8 px-3"
            >
              <CalendarDays className="h-3.5 w-3.5" />
              在时间表查看
            </Button>
            <Button variant="danger" size="sm" onClick={confirmDelete} className="h-8 px-3">
              <Trash2 className="h-3.5 w-3.5" />
              删除截止
            </Button>
          </div>

          {/* REMINDER：auto 状态 + 轻量 preset 添加（复用现有 reminder 纯函数与 store actions） */}
          <DetailDisclosure
            title="提醒"
            summary={formatReminderSummaryText(reminderSummary)}
            open={reminderOpen}
            onOpenChange={setReminderOpen}
            testid="ddl-reminder-disclosure-trigger"
          >
            <div className="space-y-2 pt-0.5">
              {mark.autoReminderDisabled === true ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-background px-2.5 py-2">
                  <span className="text-[10px] text-sandrift">默认提醒：已关闭</span>
                  <button
                    type="button"
                    onClick={() => enableAutomaticReminderForTarget("calendarMark", mark.id)}
                    aria-label="重新开启默认提醒"
                    className="rounded-lg border border-line bg-white px-2 py-1 text-[10px] font-bold text-charcoal transition-colors hover:border-line-strong"
                  >
                    重新开启
                  </button>
                </div>
              ) : reminderSummary.hasAuto ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-background px-2.5 py-2">
                  <span className="text-[10px] text-sandrift">
                    默认提醒：已开启 · {reminderSummary.autoLabel}
                  </span>
                </div>
              ) : null}

              {scheduled.length > 0 && (
                <div className="space-y-0.5">
                  {scheduled.map((r: Reminder) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium text-charcoal">
                        {formatAssignmentReminderLabel(r)}
                        {r.source === "auto" && (
                          <span className="ml-1.5 rounded border border-line bg-white px-1 py-px text-[9px] font-semibold text-sandrift">
                            自动
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-sandrift">
                        {r.triggerAt.slice(5, 10).replace("-", "月")}日 {r.triggerAt.slice(11, 16)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteReminder(r.id)}
                        aria-label={`删除提醒 ${formatAssignmentReminderLabel(r)}`}
                        className="rounded-lg p-1 text-sandrift transition-colors hover:bg-danger-bg hover:text-danger"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* preset 添加（无自定义时间第二套编辑器；anchor = date + startTime 或 defaultDDLTime） */}
              {!reminderSummary.disabled && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <AlarmClockCheck className="h-3 w-3 text-sandrift" />
                  {ASSIGNMENT_REMINDER_PRESETS.map((p) => {
                    const resolved = anchor
                      ? resolveReminderTriggerAt({
                          timingMode: "relative",
                          triggerAt: anchor,
                          offsetMinutes: p.offsetMinutes,
                        })
                      : null;
                    const already =
                      resolved !== null &&
                      scheduled.some((r) => {
                        const t = parseLocalDDL(r.triggerAt);
                        const rt = parseLocalDDL(resolved);
                        return !!t && !!rt && t.getTime() === rt.getTime();
                      });
                    const past =
                      resolved !== null &&
                      (parseLocalDDL(resolved)?.getTime() ?? 0) <= new Date().getTime();
                    return (
                      <button
                        key={p.offsetMinutes}
                        type="button"
                        disabled={!resolved || already || past}
                        onClick={() => handleAddPreset(p.offsetMinutes)}
                        className={cn(
                          "flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[10px] font-semibold transition-colors",
                          already || past || !resolved
                            ? "cursor-not-allowed text-sandrift/60"
                            : "text-satin-grey hover:border-line-strong hover:text-charcoal"
                        )}
                      >
                         {already ? <Check className="h-3 w-3" /> : null}
                         {p.label}
                       </button>
                     );
                   })}
                 </div>
               )}
             </div>
           </DetailDisclosure>
          </div>
        )}
      </div>
    </Drawer>
  );
}
