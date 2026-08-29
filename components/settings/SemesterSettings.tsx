"use client";

import React, { useState } from "react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsSaveBar } from "@/components/settings/SettingsSaveBar";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { getModifiedPreferenceKeys } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { getCurrentSemesterWeek, getSemesterEndDate } from "@/lib/semester";

const inputCls =
  "w-full h-9 px-2.5 bg-[#F7F5F5] border border-line rounded-lg text-charcoal font-semibold focus:outline-none";
const inputErrorCls =
  "w-full h-9 px-2.5 bg-[#F7F5F5] border border-danger-border rounded-lg text-charcoal font-semibold focus:outline-none";

export function SemesterSettings({
  highlightedId,
  onDirtyChange,
  discardToken,
}: {
  highlightedId?: string;
  /** 脏状态上报（Modal 关闭确认用） */
  onDirtyChange?: (dirty: boolean) => void;
  /** Modal 确认放弃草稿时递增：丢弃本地草稿 */
  discardToken?: number;
}) {
  const semester = useAppStore((s) => s.semester);
  const setSemester = useAppStore((s) => s.setSemester);
  const preferences = useAppStore((s) => s.preferences);
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const pushToast = useToastStore((s) => s.pushToast);
  const modified = getModifiedPreferenceKeys(preferences).includes("showWeekends");

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(semester.name);
  const [startDate, setStartDate] = useState(semester.startDate);
  const [totalWeeks, setTotalWeeks] = useState(semester.totalWeeks);
  const [touched, setTouched] = useState(false);

  // 外部恢复（如备份恢复）后同步草稿：未编辑时跟随 Store
  React.useEffect(() => {
    if (!editing) {
      setName(semester.name);
      setStartDate(semester.startDate);
      setTotalWeeks(semester.totalWeeks);
    }
  }, [semester.name, semester.startDate, semester.totalWeeks, editing]);

  // ---- 实时概览（由 semester 推导，不保存 endDate） ----
  const currentWeek = getCurrentSemesterWeek(semester);
  const inSemester = currentWeek >= 1 && currentWeek <= semester.totalWeeks;
  const endDate = getSemesterEndDate(semester.startDate, semester.totalWeeks);

  // ---- 编辑 Preview（基于本地 form state，输入不写 Store） ----
  const nameValid = name.trim().length > 0;
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(startDate) && !Number.isNaN(new Date(startDate).getTime());
  const weeksValid = Number.isInteger(totalWeeks) && totalWeeks >= 1 && totalWeeks <= 30;
  const errors = {
    name: !nameValid ? "学期名称不能为空" : null,
    startDate: !dateValid ? "请输入有效日期" : null,
    totalWeeks: !weeksValid ? "教学周数需为 1–30" : null,
  };
  const hasErrors = !nameValid || !dateValid || !weeksValid;
  const previewEnd = dateValid ? getSemesterEndDate(startDate, weeksValid ? totalWeeks : 0) : null;

  const dirty =
    !hasErrors && (name !== semester.name || startDate !== semester.startDate || totalWeeks !== semester.totalWeeks);
  // 编辑期间存在任何未保存改动（含非法输入：关闭确认同样保护草稿不丢失）
  const editingDraft = editing && (name !== semester.name || startDate !== semester.startDate || totalWeeks !== semester.totalWeeks);

  // 脏状态上报（V4.1：Modal 据此决定是否要求显式放弃确认）
  React.useEffect(() => {
    onDirtyChange?.(editingDraft);
  }, [editingDraft, onDirtyChange]);

  // Modal 确认放弃草稿：重置本地草稿
  React.useEffect(() => {
    if (discardToken && discardToken > 0) {
      setName(semester.name);
      setStartDate(semester.startDate);
      setTotalWeeks(semester.totalWeeks);
      setTouched(false);
      setEditing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discardToken]);

  const save = () => {
    if (hasErrors) {
      setTouched(true);
      return;
    }
    setSemester({ ...semester, name: name.trim(), startDate, totalWeeks });
    setEditing(false);
    pushToast({ message: "设置已保存" });
  };

  const discard = () => {
    setName(semester.name);
    setStartDate(semester.startDate);
    setTotalWeeks(semester.totalWeeks);
    setTouched(false);
    setEditing(false);
  };

  const overviewProgress = Math.min(
    Math.max(((inSemester ? currentWeek : 1) / semester.totalWeeks) * 100, 2),
    100
  );

  return (
    <div className="space-y-6" data-testid="settings-semester">
      {/* 当前学期概览：实时推导；默认只显示状态，点击「编辑」才展开表单 */}
      <SettingsSection title="当前学期" description="结束日期由开学日期与教学周数推导，不单独保存。">
        <div
          className="p-4 bg-[#F7F5F5] border border-line rounded-xl space-y-3"
          data-setting-id="semester-overview"
        >
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-bold text-charcoal">{semester.name}</p>
            <span className="text-[10px] font-semibold text-sandrift bg-white border border-line px-2 py-0.5 rounded-lg">
              {inSemester ? `第 ${currentWeek} / ${semester.totalWeeks} 周` : "本周不在教学周内"}
            </span>
          </div>
          <p className="text-[11px] text-satin-grey">
            {format(new Date(semester.startDate), "yyyy年M月d日", { locale: zhCN })} →{" "}
            {format(endDate, "yyyy年M月d日", { locale: zhCN })} · {semester.totalWeeks} 个教学周
          </p>
          {/* 学期进度：简单 progress bar + 首尾周标签 */}
          <div className="space-y-1">
            <div className="w-full bg-alabaster rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-sandrift h-1.5 rounded-full transition-[width] duration-[var(--motion-data)] ease-[var(--ease-emphasized)]"
                style={{ width: `${overviewProgress}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-sandrift font-mono">
              <span>第 1 周</span>
              {inSemester && <span className="font-bold text-charcoal">第 {currentWeek} 周</span>}
              <span>第 {semester.totalWeeks} 周</span>
            </div>
          </div>

          {!editing && (
            <div className="flex justify-end">
              <button
                onClick={() => setEditing(true)}
                className="ux-press px-3 py-1.5 bg-white border border-line text-charcoal text-[11px] font-bold rounded-xl transition-colors hover:bg-alabaster"
              >
                编辑
              </button>
            </div>
          )}
        </div>
      </SettingsSection>

      {editing && (
        <SettingsSection title="编辑学期" description="修改后先预览，确认后再保存。">
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label htmlFor="settings-semester-name" className="font-bold text-sandrift">学期名称</label>
                <input
                  id="settings-semester-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={touched && errors.name ? inputErrorCls : inputCls}
                />
                {touched && errors.name && <p className="text-[10px] text-danger font-bold">{errors.name}</p>}
              </div>
              <div className="space-y-1">
                <label htmlFor="settings-semester-start" className="font-bold text-sandrift">第一周开始日期</label>
                <input
                  id="settings-semester-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={`${touched && errors.startDate ? inputErrorCls : inputCls} font-mono`}
                />
                {touched && errors.startDate && <p className="text-[10px] text-danger font-bold">{errors.startDate}</p>}
                <p className="text-[10px] text-sandrift">周一为学期第 1 周起始日</p>
              </div>
              <div className="space-y-1">
                <label htmlFor="settings-semester-weeks" className="font-bold text-sandrift">总教学周数</label>
                <input
                  id="settings-semester-weeks"
                  type="number"
                  min={1}
                  max={30}
                  value={totalWeeks}
                  onChange={(e) => setTotalWeeks(Number(e.target.value))}
                  className={touched && errors.totalWeeks ? inputErrorCls : inputCls}
                />
                {touched && errors.totalWeeks && (
                  <p className="text-[10px] text-danger font-bold">{errors.totalWeeks}</p>
                )}
              </div>
            </div>

            {/* 修改后即时预览（本地 form state 推导） */}
            {(name !== semester.name || startDate !== semester.startDate || totalWeeks !== semester.totalWeeks) && (
              <div className="p-3 bg-pastel-mint/60 border border-line rounded-xl space-y-0.5 text-[11px]" data-testid="semester-preview">
                <p className="font-bold text-charcoal">修改后：</p>
                <p className="text-satin-grey">
                  {dateValid ? `${format(new Date(startDate), "yyyy年M月d日", { locale: zhCN })}开始` : "日期无效"}
                </p>
                <p className="text-satin-grey">{weeksValid ? `${totalWeeks} 个教学周` : "周数无效"}</p>
                <p className="text-satin-grey">
                  {previewEnd && weeksValid
                    ? `预计于 ${format(previewEnd, "yyyy年M月d日", { locale: zhCN })}结束`
                    : "预计结束日期暂不可用"}
                </p>
              </div>
            )}
          </div>
        </SettingsSection>
      )}

      {editing && <SettingsSaveBar dirty={dirty} onSave={save} onDiscard={discard} />}

      {/* 课表显示偏好：显示周末（属于学期与课表范围） */}
      <SettingsSection title="课表显示" description="课表的时间范围偏好。">
        <SettingsRow
          settingId="show-weekends"
          title="显示周末"
          description="在课表中显示周六与周日"
          modified={modified}
          onReset={() => updatePreferences({ showWeekends: true })}
          resetAriaLabel="将显示周末恢复默认"
          highlighted={highlightedId === "show-weekends"}
        >
          <button
            role="switch"
            aria-checked={preferences.showWeekends}
            aria-label="显示周末"
            onClick={() => updatePreferences({ showWeekends: !preferences.showWeekends })}
            className={cn(
              "relative w-9 h-5 rounded-full transition-colors duration-[var(--motion-fast)]",
              preferences.showWeekends ? "bg-charcoal" : "bg-alba"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-subtle transition-transform duration-[var(--motion-fast)]",
                preferences.showWeekends && "translate-x-4"
              )}
            />
          </button>
        </SettingsRow>
      </SettingsSection>

      {/* 作息方案（BellSchedule） */}
      <SettingsSection title="作息方案" description="管理铃声/节次时间模板，导入的“第3节”按此表解析为具体时间。">
        <BellScheduleSettings highlightedId={highlightedId} />
      </SettingsSection>
    </div>
  );
}

function BellScheduleSettings({ highlightedId }: { highlightedId?: string }) {
  const bellSchedules = useAppStore((s) => s.bellSchedules);
  const activeBellScheduleId = useAppStore((s) => s.activeBellScheduleId);
  const upsertBellSchedule = useAppStore((s) => s.upsertBellSchedule);
  const removeBellSchedule = useAppStore((s) => s.removeBellSchedule);
  const setActiveBellSchedule = useAppStore((s) => s.setActiveBellSchedule);
  const pushToast = useToastStore((s) => s.pushToast);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draftName, setDraftName] = React.useState("");
  const [draftPeriods, setDraftPeriods] = React.useState<{ period: number; startTime: string; endTime: string }[]>([
    { period: 1, startTime: "08:00", endTime: "09:40" },
  ]);

  const startCreate = () => {
    setEditingId("new");
    setDraftName("新作息方案");
    setDraftPeriods([{ period: 1, startTime: "08:00", endTime: "09:40" }]);
  };

  const save = () => {
    if (!draftName.trim()) {
      pushToast({ message: "方案名称不能为空", type: "error" });
      return;
    }
    const id = editingId === "new" ? `bell-${Date.now()}` : editingId!;
    upsertBellSchedule({ id, name: draftName.trim(), periods: draftPeriods });
    pushToast({ message: "作息方案已保存" });
    setEditingId(null);
  };

  return (
    <div className="space-y-3">
      {bellSchedules.length === 0 ? (
        <p className="text-[11px] text-sandrift">暂无作息方案，导入的节次将使用系统默认 08:00-21:00</p>
      ) : (
        <div className="space-y-2">
          {bellSchedules.map((b) => (
            <div key={b.id} className="flex items-center justify-between p-2.5 bg-[#F7F5F5] border border-line rounded-xl">
              <div>
                <p className="text-xs font-bold text-charcoal">{b.name}</p>
                <p className="text-[10px] text-sandrift">{b.periods.length} 节 · {b.periods[0]?.startTime ?? ""}-{b.periods[b.periods.length - 1]?.endTime ?? ""}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setActiveBellSchedule(b.id)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${activeBellScheduleId === b.id ? "bg-charcoal text-white border-charcoal" : "bg-white border-line text-satin-grey"}`}
                >
                  {activeBellScheduleId === b.id ? "已激活" : "设为激活"}
                </button>
                <button onClick={() => { setEditingId(b.id); setDraftName(b.name); setDraftPeriods(b.periods); }} className="px-2 py-1 rounded-lg bg-white border border-line text-[11px] text-satin-grey">编辑</button>
                <button onClick={() => { removeBellSchedule(b.id); pushToast({ message: "已删除" }); }} className="px-2 py-1 rounded-lg bg-white border border-line text-[11px] text-danger">删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editingId ? (
        <div className="p-3 bg-white border border-line rounded-xl space-y-3">
          <input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="方案名称" className="w-full h-9 px-2.5 bg-[#F7F5F5] border border-line rounded-lg text-xs font-semibold" />
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {draftPeriods.map((p, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="text-[11px] font-bold w-12">第{p.period}节</span>
                <input type="time" value={p.startTime} onChange={(e) => setDraftPeriods((arr) => arr.map((x, i) => i === idx ? { ...x, startTime: e.target.value } : x))} className="h-8 px-2 bg-[#F7F5F5] border border-line rounded-lg text-xs" />
                <span className="text-sandrift">-</span>
                <input type="time" value={p.endTime} onChange={(e) => setDraftPeriods((arr) => arr.map((x, i) => i === idx ? { ...x, endTime: e.target.value } : x))} className="h-8 px-2 bg-[#F7F5F5] border border-line rounded-lg text-xs" />
                <button onClick={() => setDraftPeriods((arr) => arr.filter((_, i) => i !== idx))} className="text-[11px] text-danger">移除</button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setDraftPeriods((arr) => [...arr, { period: arr.length + 1, startTime: "10:00", endTime: "11:40" }])} className="px-2.5 py-1.5 bg-alabaster border border-line rounded-lg text-[11px] font-bold">添加节次</button>
            <div className="flex-1" />
            <button onClick={() => setEditingId(null)} className="px-3 py-1.5 bg-white border border-line rounded-lg text-[11px] font-bold">取消</button>
            <button onClick={save} className="px-3 py-1.5 bg-charcoal text-white rounded-lg text-[11px] font-bold">保存</button>
          </div>
        </div>
      ) : (
        <button onClick={startCreate} className="w-full py-2 bg-white border border-dashed border-line rounded-xl text-[11px] font-bold text-satin-grey hover:text-charcoal">+ 新建作息方案</button>
      )}
    </div>
  );
}
