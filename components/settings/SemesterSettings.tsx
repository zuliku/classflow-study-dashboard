"use client";

import React, { useState } from "react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsSaveBar } from "@/components/settings/SettingsSaveBar";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsInput, SettingsToggle } from "@/components/settings/SettingsControls";
import { Button } from "@/components/ui/Button";
import { getModifiedPreferenceKeys } from "@/lib/preferences";
import { getCurrentSemesterWeek, getSemesterEndDate } from "@/lib/semester";

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
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                编辑
              </Button>
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
                <SettingsInput
                  id="settings-semester-name"
                  value={name}
                  onChange={setName}
                  error={touched && !!errors.name}
                />
                {touched && errors.name && <p className="text-[10px] text-danger font-bold">{errors.name}</p>}
              </div>
              <div className="space-y-1">
                <label htmlFor="settings-semester-start" className="font-bold text-sandrift">第一周开始日期</label>
                <SettingsInput
                  id="settings-semester-start"
                  type="date"
                  value={startDate}
                  onChange={setStartDate}
                  error={touched && !!errors.startDate}
                  mono
                />
                {touched && errors.startDate && <p className="text-[10px] text-danger font-bold">{errors.startDate}</p>}
                <p className="text-[10px] text-sandrift">周一为学期第 1 周起始日</p>
              </div>
              <div className="space-y-1">
                <label htmlFor="settings-semester-weeks" className="font-bold text-sandrift">总教学周数</label>
                <SettingsInput
                  id="settings-semester-weeks"
                  type="number"
                  min={1}
                  value={totalWeeks}
                  onChange={(v) => setTotalWeeks(Number(v))}
                  error={touched && !!errors.totalWeeks}
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
      <SettingsSection title="课表显示" description="课表显示哪些天。">
        <SettingsRow
          settingId="show-weekends"
          title="显示周末"
          description="在课表中显示周六与周日"
          modified={modified}
          onReset={() => updatePreferences({ showWeekends: true })}
          resetAriaLabel="将显示周末恢复默认"
          highlighted={highlightedId === "show-weekends"}
        >
          <SettingsToggle
            checked={preferences.showWeekends}
            onChange={(v) => updatePreferences({ showWeekends: v })}
            label="显示周末"
          />
        </SettingsRow>
      </SettingsSection>

      {/* 作息方案（BellSchedule） */}
      <div
        data-setting-id="bell-schedule"
        className={highlightedId === "bell-schedule" ? "bg-pastel-mint/60 rounded-xl" : ""}
      >
          <SettingsSection title="作息方案" description="管理节次时间模板；导入的“第3节”按此表解析。">
          <BellScheduleSettings highlightedId={highlightedId} />
        </SettingsSection>
      </div>
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
                <Button
                  variant={activeBellScheduleId === b.id ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => setActiveBellSchedule(b.id)}
                  className="h-7 px-2 text-[11px]"
                >
                  {activeBellScheduleId === b.id ? "已激活" : "设为激活"}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => { setEditingId(b.id); setDraftName(b.name); setDraftPeriods(b.periods); }} className="h-7 px-2 text-[11px]">编辑</Button>
                <Button variant="danger" size="sm" onClick={() => { removeBellSchedule(b.id); pushToast({ message: "已删除" }); }} className="h-7 px-2 text-[11px]">删除</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editingId ? (
        <div className="p-3 bg-white border border-line rounded-xl space-y-3">
          <SettingsInput value={draftName} onChange={setDraftName} placeholder="方案名称" ariaLabel="作息方案名称" />
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {draftPeriods.map((p, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="text-[11px] font-bold w-12 shrink-0">第{p.period}节</span>
                <span className="w-[104px] shrink-0">
                  <SettingsInput type="time" value={p.startTime} onChange={(v) => setDraftPeriods((arr) => arr.map((x, i) => i === idx ? { ...x, startTime: v } : x))} ariaLabel={`第${p.period}节开始时间`} mono />
                </span>
                <span className="text-sandrift" aria-hidden="true">-</span>
                <span className="w-[104px] shrink-0">
                  <SettingsInput type="time" value={p.endTime} onChange={(v) => setDraftPeriods((arr) => arr.map((x, i) => i === idx ? { ...x, endTime: v } : x))} ariaLabel={`第${p.period}节结束时间`} mono />
                </span>
                <Button variant="ghost" size="sm" onClick={() => setDraftPeriods((arr) => arr.filter((_, i) => i !== idx))} className="h-7 px-2 text-[11px] text-danger">移除</Button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setDraftPeriods((arr) => [...arr, { period: arr.length + 1, startTime: "10:00", endTime: "11:40" }])} className="h-7 text-[11px]">添加节次</Button>
            <div className="flex-1" />
            <Button variant="secondary" size="sm" onClick={() => setEditingId(null)}>取消</Button>
            <Button variant="primary" size="sm" onClick={save}>保存</Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={startCreate} className="w-full border-dashed">+ 新建作息方案</Button>
      )}
    </div>
  );
}
