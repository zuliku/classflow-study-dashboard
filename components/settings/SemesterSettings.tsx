"use client";

import React, { useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsSaveBar } from "@/components/settings/SettingsSaveBar";

const inputCls =
  "w-full p-2.5 bg-[#F7F5F5] border border-line rounded-xl text-charcoal font-semibold focus:outline-none";

export function SemesterSettings() {
  const semester = useAppStore((s) => s.semester);
  const setSemester = useAppStore((s) => s.setSemester);
  const pushToast = useToastStore((s) => s.pushToast);

  const [name, setName] = useState(semester.name);
  const [startDate, setStartDate] = useState(semester.startDate);
  const [totalWeeks, setTotalWeeks] = useState(semester.totalWeeks);

  const dirty =
    name !== semester.name ||
    startDate !== semester.startDate ||
    totalWeeks !== semester.totalWeeks;

  const save = () => {
    setSemester({ ...semester, name, startDate, totalWeeks: Number(totalWeeks) || 16 });
    pushToast({ message: "设置已保存" });
  };

  const discard = () => {
    setName(semester.name);
    setStartDate(semester.startDate);
    setTotalWeeks(semester.totalWeeks);
  };

  return (
    <div className="space-y-6" data-testid="settings-semester">
      <SettingsSection
        title="学期与课表"
        description="当前教学周由开学日期与今天实时推导，周次切换按钮可手动浏览其他周。"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="space-y-1">
            <label className="font-bold text-sandrift">学期名称</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} required />
          </div>
          <div className="space-y-1">
            <label className="font-bold text-sandrift">开学日期</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={`${inputCls} font-mono`} required />
            <p className="text-[10px] text-sandrift">周一为学期第 1 周起始日</p>
          </div>
          <div className="space-y-1">
            <label className="font-bold text-sandrift">总教学周数</label>
            <select
              value={totalWeeks}
              onChange={(e) => setTotalWeeks(Number(e.target.value))}
              className={`${inputCls} font-bold`}
            >
              <option value={16}>16 周 (标准学期)</option>
              <option value={18}>18 周</option>
              <option value={20}>20 周</option>
              <option value={12}>12 周 (短学期)</option>
            </select>
          </div>
        </div>
      </SettingsSection>

      <SettingsSaveBar dirty={dirty} onSave={save} onDiscard={discard} />
    </div>
  );
}
