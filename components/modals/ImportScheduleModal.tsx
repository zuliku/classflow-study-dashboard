"use client";

import React, { useState } from "react";
import { X, FileUp, CheckCircle, Download, FileCode, Server } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { Course, CourseSchedule } from "@/types";

export function ImportScheduleModal() {
  const { isImportScheduleModalOpen, setImportScheduleModalOpen, importSchedules } =
    useAppStore();

  const [activeSource, setActiveSource] = useState<"system" | "ical" | "json">("system");
  const [inputText, setInputText] = useState("");
  const [successCount, setSuccessCount] = useState<number | null>(null);

  if (!isImportScheduleModalOpen) return null;

  const handleImport = () => {
    // Generate 2 sample imported courses & schedules
    const newId1 = `c_imp_${Date.now()}_1`;
    const newId2 = `c_imp_${Date.now()}_2`;

    const importedCourses: Course[] = [
      {
        id: newId1,
        name: "证券投资学",
        code: "FIN-302",
        teacher: "张教授",
        classroom: "教二 501",
        credit: 3,
        bgHex: "#E3E6E0",
        borderHex: "#D0D5CC",
        textHex: "#313032",
        description: "投资组合理论、CAPM 模型与股票技术分析实战。",
        materials: [],
      },
      {
        id: newId2,
        name: "行为金融学",
        code: "FIN-401",
        teacher: "刘教授",
        classroom: "教三 102",
        credit: 2,
        bgHex: "#CCCBC4",
        borderHex: "#B8B7B0",
        textHex: "#313032",
        description: "心理学与金融决策、过度自信与羊群效应实验。",
        materials: [],
      },
    ];

    const importedSchedules: CourseSchedule[] = [
      {
        id: `s_imp_${Date.now()}_1`,
        courseId: newId1,
        dayOfWeek: 2,
        startTime: "08:00",
        endTime: "09:40",
        location: "教二 501",
        weeks: "1-16周",
      },
      {
        id: `s_imp_${Date.now()}_2`,
        courseId: newId2,
        dayOfWeek: 4,
        startTime: "16:00",
        endTime: "17:40",
        location: "教三 102",
        weeks: "1-16周",
      },
    ];

    importSchedules(importedCourses, importedSchedules);
    setSuccessCount(2);

    setTimeout(() => {
      setSuccessCount(null);
      setInputText("");
      setImportScheduleModalOpen(false);
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-drawer border border-[#E7E3DD] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 px-6 border-b border-[#F0EBE1] bg-[#F7F5F5] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <FileUp className="w-4 h-4 text-[#A48F82]" />
            <h3 className="text-base font-bold text-charcoal">导入课表</h3>
          </div>
          <button
            onClick={() => setImportScheduleModalOpen(false)}
            className="p-1 rounded-lg text-[#8C827A] hover:bg-[#E0D7C6] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4 text-xs">
          {/* Source Tabs */}
          <div className="grid grid-cols-3 gap-2 p-1 bg-[#F0EBE1] rounded-xl border border-[#E0D7C6]">
            <button
              onClick={() => setActiveSource("system")}
              className={`flex items-center justify-center space-x-1.5 py-2 rounded-lg font-medium transition-all ${
                activeSource === "system"
                  ? "bg-white text-charcoal font-bold shadow-subtle"
                  : "text-[#676268] hover:text-charcoal"
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              <span>教务系统导出</span>
            </button>
            <button
              onClick={() => setActiveSource("ical")}
              className={`flex items-center justify-center space-x-1.5 py-2 rounded-lg font-medium transition-all ${
                activeSource === "ical"
                  ? "bg-white text-charcoal font-bold shadow-subtle"
                  : "text-[#676268] hover:text-charcoal"
              }`}
            >
              <Download className="w-3.5 h-3.5" />
              <span>iCal (.ics)</span>
            </button>
            <button
              onClick={() => setActiveSource("json")}
              className={`flex items-center justify-center space-x-1.5 py-2 rounded-lg font-medium transition-all ${
                activeSource === "json"
                  ? "bg-white text-charcoal font-bold shadow-subtle"
                  : "text-[#676268] hover:text-charcoal"
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>JSON 模版</span>
            </button>
          </div>

          {/* Text Area / Import Box */}
          <div className="space-y-1.5">
            <label className="font-bold text-[#8C827A]">
              {activeSource === "system" && "粘贴教务系统课表文本或HTML片段:"}
              {activeSource === "ical" && "粘贴 .ics 日历文件内容:"}
              {activeSource === "json" && "粘贴标准的课表 JSON 数组:"}
            </label>
            <textarea
              rows={5}
              placeholder={
                activeSource === "system"
                  ? "请在教务系统课表页面全选(Ctrl+A)并复制粘贴至此处..."
                  : activeSource === "ical"
                  ? "BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT..."
                  : '[\n  { "name": "证券投资学", "dayOfWeek": 2, "startTime": "08:00", "endTime": "09:40" }\n]'
              }
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="w-full p-3 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl focus:outline-none focus:border-charcoal font-mono text-[11px] leading-relaxed resize-none"
            />
          </div>

          {/* Success Banner */}
          {successCount !== null && (
            <div className="p-3 bg-[#E3E6E0] border border-[#D0D5CC] rounded-xl flex items-center space-x-2 text-[#4A7C59] font-bold">
              <CheckCircle className="w-4 h-4" />
              <span>成功解析并同步导入 {successCount} 门新课程排课！</span>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-[#F0EBE1]">
            <p className="text-[10px] text-[#8C827A]">
              支持教务系统文本、iCal 日历文件或 JSON 模版
            </p>
            <div className="flex space-x-2">
              <button
                type="button"
                onClick={() => setImportScheduleModalOpen(false)}
                className="px-4 py-2 text-xs font-medium text-[#676268] bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl hover:bg-[#E0D7C6]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleImport}
                className="px-4 py-2 text-xs font-medium text-white bg-charcoal rounded-xl hover:bg-black font-bold"
              >
                开始解析导入
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
