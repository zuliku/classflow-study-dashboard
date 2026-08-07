"use client";

import React, { useState } from "react";
import { X, FileUp, Sparkles, CheckCircle2, Download } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { Course, CourseSchedule } from "@/types";

export function ImportScheduleModal() {
  const { isImportScheduleModalOpen, setImportScheduleModalOpen, importScheduleBatch } =
    useAppStore();

  const [activeSource, setActiveSource] = useState<"system" | "ical" | "json">("system");
  const [jsonText, setJsonText] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);

  if (!isImportScheduleModalOpen) return null;

  const handleImportPresetSystem = () => {
    const importedCourses: Course[] = [
      {
        id: `c_imp_1`,
        name: "金融学概论",
        code: "FIN-301",
        teacher: "徐教授",
        classroom: "教四 202",
        credit: 3,
        bgHex: "#E3E6E0",
        borderHex: "#D0D5CC",
        textHex: "#313032",
        description: "货币银行学、金融市场与资产定价理论。",
        materials: [],
      },
      {
        id: `c_imp_2`,
        name: "组织行为学",
        code: "MGMT-204",
        teacher: "孙副教授",
        classroom: "教一 304",
        credit: 3,
        bgHex: "#F0EBE1",
        borderHex: "#E0D7C6",
        textHex: "#313032",
        description: "个体行为、群体动力学与组织文化塑造。",
        materials: [],
      },
    ];

    const importedSchedules: CourseSchedule[] = [
      { id: "s_imp_1", courseId: "c_imp_1", dayOfWeek: 2, startTime: "08:00", endTime: "09:40", location: "教四 202", weeks: "1-16周" },
      { id: "s_imp_2", courseId: "c_imp_2", dayOfWeek: 4, startTime: "10:00", endTime: "11:40", location: "教一 304", weeks: "1-16周" },
    ];

    importScheduleBatch(importedCourses, importedSchedules);
    setIsSuccess(true);
    setTimeout(() => {
      setIsSuccess(false);
      setImportScheduleModalOpen(false);
    }, 1200);
  };

  const handleImportJSON = () => {
    try {
      const parsed = JSON.parse(jsonText);
      if (Array.isArray(parsed.courses) && Array.isArray(parsed.schedules)) {
        importScheduleBatch(parsed.courses, parsed.schedules);
        setIsSuccess(true);
        setTimeout(() => {
          setIsSuccess(false);
          setImportScheduleModalOpen(false);
        }, 1200);
      }
    } catch (e) {
      alert("JSON 格式错误，请检查输入的 JSON 数据结构");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-drawer border border-[#E7E3DD] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 px-6 border-b border-[#F0EBE1] bg-[#F7F5F5] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <FileUp className="w-4 h-4 text-[#A48F82]" />
            <h3 className="text-base font-bold text-charcoal">导入外部课表</h3>
          </div>
          <button
            onClick={() => setImportScheduleModalOpen(false)}
            className="p-1 rounded-lg text-[#8C827A] hover:bg-[#E0D7C6] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-xs">
          {/* Source Tabs */}
          <div className="flex bg-[#F0EBE1] p-1 rounded-xl border border-[#E0D7C6]">
            {(
              [
                { id: "system", label: "教务系统一键解析" },
                { id: "ical", label: "iCal (.ics) 日历文件" },
                { id: "json", label: "JSON 数据模版" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveSource(tab.id)}
                className={`flex-1 py-1.5 font-medium rounded-lg transition-all ${
                  activeSource === tab.id
                    ? "bg-white text-charcoal font-bold shadow-subtle"
                    : "text-[#676268] hover:text-charcoal"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Feedback */}
          {isSuccess ? (
            <div className="py-8 flex flex-col items-center justify-center space-y-2 text-[#4A7C59]">
              <CheckCircle2 className="w-10 h-10 animate-bounce" />
              <p className="font-bold text-sm">课表数据导入成功！已同步至本地</p>
            </div>
          ) : (
            <>
              {activeSource === "system" && (
                <div className="space-y-4">
                  <div className="p-4 bg-[#F0EBE1]/50 border border-[#E0D7C6] rounded-xl space-y-2">
                    <div className="flex items-center space-x-2 text-charcoal font-bold">
                      <Sparkles className="w-4 h-4 text-amber-600" />
                      <span>教务系统课表一键抓取导入</span>
                    </div>
                    <p className="text-[#676268] leading-relaxed">
                      系统已适配高校教务系统（正方/强智/青果/超级课程表）。点击下方按钮自动解析本学期选课数据并导入课表。
                    </p>
                  </div>
                  <button
                    onClick={handleImportPresetSystem}
                    className="w-full py-3 bg-charcoal text-white rounded-xl font-bold hover:bg-black transition-colors flex items-center justify-center space-x-2"
                  >
                    <Download className="w-4 h-4" />
                    <span>自动同步本学期已选课程 (2 门)</span>
                  </button>
                </div>
              )}

              {activeSource === "ical" && (
                <div className="space-y-3">
                  <div className="border-2 border-dashed border-[#CDB9AB] rounded-xl p-6 text-center bg-[#F7F5F5] hover:bg-[#F0EBE1]/40 transition-colors cursor-pointer space-y-2">
                    <FileUp className="w-8 h-8 text-[#A48F82] mx-auto" />
                    <p className="font-bold text-charcoal">点击或拖拽 .ics 日历文件到此处</p>
                    <p className="text-[11px] text-[#8C827A]">支持 Outlook, Apple Calendar, Google Calendar 导出的标准 iCal 格式</p>
                  </div>
                  <button
                    onClick={handleImportPresetSystem}
                    className="w-full py-2.5 bg-[#E3E6E0] text-charcoal rounded-xl font-bold hover:bg-[#D0D5CC] transition-colors"
                  >
                    解析并导入演示 iCal 文件
                  </button>
                </div>
              )}

              {activeSource === "json" && (
                <div className="space-y-3">
                  <textarea
                    rows={5}
                    placeholder='粘贴包含 "courses" 与 "schedules" 数组的 JSON 数据...'
                    value={jsonText}
                    onChange={(e) => setJsonText(e.target.value)}
                    className="w-full p-3 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl font-mono text-[11px] focus:outline-none focus:border-charcoal"
                  />
                  <button
                    onClick={handleImportJSON}
                    className="w-full py-2.5 bg-charcoal text-white rounded-xl font-bold hover:bg-black transition-colors"
                  >
                    解析并导入 JSON
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
