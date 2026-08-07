"use client";

import React, { useState } from "react";
import { X, FileUp, CheckCircle, Download, FileCode, Server, AlertTriangle, ArrowRight } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { parseICS, parseJSONSchedule, parseCSVSchedule, ParsedImportResult } from "@/lib/parser";

export function ImportScheduleModal() {
  const { isImportScheduleModalOpen, setImportScheduleModalOpen, importSchedules, schedules } =
    useAppStore();

  const [activeSource, setActiveSource] = useState<"ical" | "csv" | "json">("ical");
  const [inputText, setInputText] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [parsedData, setParsedData] = useState<ParsedImportResult | null>(null);

  if (!isImportScheduleModalOpen) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setInputText(content);
    };
    reader.readAsText(file);
  };

  const handleParsePreview = () => {
    if (!inputText.trim()) return;

    let res: ParsedImportResult;
    if (activeSource === "ical") {
      res = parseICS(inputText);
    } else if (activeSource === "json") {
      res = parseJSONSchedule(inputText);
    } else {
      res = parseCSVSchedule(inputText);
    }

    setParsedData(res);
    setStep(2);
  };

  const handleConfirmImport = () => {
    if (!parsedData || parsedData.courses.length === 0) return;

    importSchedules(parsedData.courses, parsedData.schedules);
    setStep(1);
    setInputText("");
    setParsedData(null);
    setImportScheduleModalOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-drawer border border-[#E7E3DD] overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 px-6 border-b border-[#F0EBE1] bg-[#F7F5F5] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <FileUp className="w-4 h-4 text-[#A48F82]" />
            <h3 className="text-base font-bold text-charcoal">
              {step === 1 ? "导入外部课表 (ICS / CSV / JSON)" : "课表预览与冲突校验"}
            </h3>
          </div>
          <button
            onClick={() => {
              setStep(1);
              setImportScheduleModalOpen(false);
            }}
            className="p-1 rounded-lg text-[#8C827A] hover:bg-[#E0D7C6] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Wizard Step 1: Input & Upload */}
        {step === 1 && (
          <div className="p-6 space-y-4 text-xs overflow-y-auto">
            {/* Format Tabs */}
            <div className="grid grid-cols-3 gap-2 p-1 bg-[#F0EBE1] rounded-xl border border-[#E0D7C6]">
              <button
                onClick={() => setActiveSource("ical")}
                className={`flex items-center justify-center space-x-1 py-2 rounded-lg font-medium transition-all ${
                  activeSource === "ical"
                    ? "bg-white text-charcoal font-bold shadow-subtle"
                    : "text-[#676268] hover:text-charcoal"
                }`}
              >
                <Download className="w-3.5 h-3.5" />
                <span>iCal (.ics)</span>
              </button>
              <button
                onClick={() => setActiveSource("csv")}
                className={`flex items-center justify-center space-x-1 py-2 rounded-lg font-medium transition-all ${
                  activeSource === "csv"
                    ? "bg-white text-charcoal font-bold shadow-subtle"
                    : "text-[#676268] hover:text-charcoal"
                }`}
              >
                <Server className="w-3.5 h-3.5" />
                <span>CSV / 文本表格</span>
              </button>
              <button
                onClick={() => setActiveSource("json")}
                className={`flex items-center justify-center space-x-1 py-2 rounded-lg font-medium transition-all ${
                  activeSource === "json"
                    ? "bg-white text-charcoal font-bold shadow-subtle"
                    : "text-[#676268] hover:text-charcoal"
                }`}
              >
                <FileCode className="w-3.5 h-3.5" />
                <span>JSON 模版</span>
              </button>
            </div>

            {/* Local File Upload Button */}
            <div className="p-3 border border-dashed border-[#CDB9AB] bg-[#F7F5F5] rounded-xl text-center space-y-1.5">
              <p className="text-xs text-charcoal font-bold">
                上传本地 .{activeSource} 文件
              </p>
              <input
                type="file"
                accept={
                  activeSource === "ical"
                    ? ".ics"
                    : activeSource === "json"
                    ? ".json"
                    : ".csv,.txt"
                }
                onChange={handleFileUpload}
                className="hidden"
                id="file-upload-input"
              />
              <label
                htmlFor="file-upload-input"
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-[#E0D7C6] rounded-lg text-xs font-bold text-charcoal cursor-pointer hover:bg-[#F0EBE1] transition-colors"
              >
                <FileUp className="w-3.5 h-3.5" />
                <span>选择本地文件</span>
              </label>
            </div>

            {/* Or Paste Raw Text */}
            <div className="space-y-1.5">
              <label className="font-bold text-[#8C827A]">
                或直接粘贴文本内容:
              </label>
              <textarea
                rows={5}
                placeholder={
                  activeSource === "ical"
                    ? "BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:计量经济学..."
                    : activeSource === "json"
                    ? '[\n  { "name": "计量经济学", "code": "ECON-301", "dayOfWeek": 2, "startTime": "08:00", "endTime": "09:40" }\n]'
                    : "课程名称,代码,教师,教室,学分,星期,开始时间,结束时间,周次\n计量经济学,ECON-301,张教授,教二201,3,2,08:00,09:40,1-16周"
                }
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="w-full p-3 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl focus:outline-none focus:border-charcoal font-mono text-[11px] leading-relaxed resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-[#F0EBE1]">
              <p className="text-[10px] text-[#8C827A]">
                支持原生 iCal、CSV 规范或自定义 JSON 格式
              </p>
              <button
                type="button"
                onClick={handleParsePreview}
                disabled={!inputText.trim()}
                className="px-4 py-2 text-xs font-bold text-white bg-charcoal rounded-xl hover:bg-black disabled:opacity-50 flex items-center space-x-1"
              >
                <span>下一步：校验预览</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Wizard Step 2: Live Preview & Confirmation */}
        {step === 2 && parsedData && (
          <div className="p-6 space-y-4 text-xs overflow-y-auto">
            {parsedData.errors.length > 0 && (
              <div className="p-3 bg-[#FDF0F0] border border-[#F8D7D7] rounded-xl text-[#D94F4F] space-y-1">
                <div className="flex items-center space-x-1 font-bold">
                  <AlertTriangle className="w-4 h-4" />
                  <span>解析警告</span>
                </div>
                {parsedData.errors.map((err, i) => (
                  <p key={i}>{err}</p>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <h4 className="font-bold text-charcoal flex items-center justify-between">
                <span>即将导入的课程 ({parsedData.courses.length} 门)</span>
                <span className="text-xs text-[#4A7C59] font-semibold">
                  已成功解析 {parsedData.schedules.length} 个上课时段
                </span>
              </h4>

              {/* Preview Table */}
              <div className="border border-[#E7E3DD] rounded-xl overflow-hidden divide-y divide-[#F5F2EE]">
                {parsedData.courses.map((c, i) => {
                  const sched = parsedData.schedules[i];
                  return (
                    <div key={c.id} className="p-3 bg-[#F7F5F5] flex items-center justify-between text-xs">
                      <div>
                        <div className="font-bold text-charcoal">{c.name} ({c.code})</div>
                        <div className="text-[10px] text-[#8C827A] mt-0.5">
                          教师: {c.teacher} · 教室: {c.classroom} · {c.credit} 学分
                        </div>
                      </div>
                      {sched && (
                        <div className="text-right">
                          <span className="font-mono text-xs font-semibold text-charcoal">
                            周{["一","二","三","四","五","六","日"][sched.dayOfWeek - 1]} {sched.startTime}-{sched.endTime}
                          </span>
                          <div className="text-[10px] text-[#8C827A]">{sched.weeks}</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Confirmation Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-[#F0EBE1]">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-4 py-2 text-xs font-medium text-[#676268] bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl hover:bg-[#E0D7C6]"
              >
                返回修改
              </button>
              <button
                type="button"
                onClick={handleConfirmImport}
                className="px-5 py-2 text-xs font-bold text-white bg-[#4A7C59] hover:bg-[#3D6649] rounded-xl flex items-center space-x-1.5"
              >
                <CheckCircle className="w-4 h-4" />
                <span>确认导入到课表</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
