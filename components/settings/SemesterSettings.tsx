"use client";

import React, { useState } from "react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsSaveBar } from "@/components/settings/SettingsSaveBar";
import { getCurrentSemesterWeek, getSemesterEndDate } from "@/lib/semester";

const inputCls =
  "w-full p-2.5 bg-[#F7F5F5] border border-line rounded-xl text-charcoal font-semibold focus:outline-none";
const inputErrorCls =
  "w-full p-2.5 bg-[#F7F5F5] border border-danger-border rounded-xl text-charcoal font-semibold focus:outline-none";

export function SemesterSettings() {
  const semester = useAppStore((s) => s.semester);
  const setSemester = useAppStore((s) => s.setSemester);
  const pushToast = useToastStore((s) => s.pushToast);

  const [name, setName] = useState(semester.name);
  const [startDate, setStartDate] = useState(semester.startDate);
  const [totalWeeks, setTotalWeeks] = useState(semester.totalWeeks);
  const [touched, setTouched] = useState(false);

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

  const save = () => {
    if (hasErrors) {
      setTouched(true);
      return;
    }
    setSemester({ ...semester, name: name.trim(), startDate, totalWeeks });
    pushToast({ message: "设置已保存" });
  };

  const discard = () => {
    setName(semester.name);
    setStartDate(semester.startDate);
    setTotalWeeks(semester.totalWeeks);
    setTouched(false);
  };

  const overviewProgress = Math.min(
    Math.max(((inSemester ? currentWeek : 1) / semester.totalWeeks) * 100, 2),
    100
  );

  return (
    <div className="space-y-6" data-testid="settings-semester">
      {/* 当前学期概览：实时推导 */}
      <SettingsSection title="当前学期概览" description="结束日期由开学日期与教学周数推导，不单独保存。">
        <div className="p-4 bg-[#F7F5F5] border border-line rounded-xl space-y-3">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-bold text-charcoal">{semester.name}</p>
            <span className="text-[10px] font-semibold text-sandrift bg-white border border-line px-2 py-0.5 rounded-lg">
              {inSemester ? `当前第 ${currentWeek} 周` : "本周不在教学周内"}
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
            <div className="flex justify-between text-[9px] text-sandrift font-mono">
              <span>第 1 周</span>
              {inSemester && <span className="font-bold text-charcoal">第 {currentWeek} 周</span>}
              <span>第 {semester.totalWeeks} 周</span>
            </div>
          </div>
        </div>
      </SettingsSection>

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

      <SettingsSaveBar dirty={dirty} onSave={save} onDiscard={discard} />
    </div>
  );
}
