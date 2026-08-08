"use client";

import React, { useState, useEffect } from "react";
import { X, FileUp, CheckCircle, Download, FileCode, Server, AlertTriangle, ArrowRight, Info } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { parseICS, parseJSONSchedule, parseCSVSchedule, ParsedImportResult } from "@/lib/parser";
import { findScheduleConflicts } from "@/lib/conflicts";
import { Course, CourseSchedule, ScheduleConflict } from "@/types";
import { usePresence } from "@/lib/usePresence";
import { useRestoreFocus } from "@/lib/useRestoreFocus";
import { cn } from "@/lib/utils";
import { pushOverlay, popOverlay, isTopmostOverlay } from "@/lib/overlayStack";

const OVERLAY_ID = "import-schedule-modal";

const DAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
const dayLabel = (d: number) => `周${DAY_LABELS[d - 1]}`;

// ICS/JSON/CSV 自动生成的代码不可靠，不作为重复判断依据
function isReliableCode(code: string): boolean {
  return !/^(ICS|JSON|CSV)-\d+$/.test(code || "");
}

interface PreviewItem {
  course: Course;
  slots: CourseSchedule[];
  isDuplicate: boolean;
  duplicateReason?: string;
  conflicts: ScheduleConflict[];
}

export function ImportScheduleModal() {
  const {
    isImportScheduleModalOpen,
    setImportScheduleModalOpen,
    importSchedules,
    schedules,
    courses,
  } = useAppStore();
  const pushToast = useToastStore((s) => s.pushToast);

  const [activeSource, setActiveSource] = useState<"ical" | "csv" | "json">("ical");
  const [inputText, setInputText] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [parsedData, setParsedData] = useState<ParsedImportResult | null>(null);
  const [skippedCourseIds, setSkippedCourseIds] = useState<string[]>([]);

  const { mounted, visible } = usePresence(isImportScheduleModalOpen, 220);
  useRestoreFocus(isImportScheduleModalOpen);

  // Esc 关闭（与关闭按钮行为一致：回到第一步并关闭；仅在 Overlay 栈最上层时）
  useEffect(() => {
    if (!mounted) return;
    pushOverlay(OVERLAY_ID, 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopmostOverlay(OVERLAY_ID)) {
        setStep(1);
        setImportScheduleModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      popOverlay(OVERLAY_ID);
      window.removeEventListener("keydown", onKey);
    };
  }, [mounted, setImportScheduleModalOpen]);

  if (!mounted) return null;

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
    setSkippedCourseIds([]);
    setStep(2);
  };

  // 按 courseId 聚合：一门课程可对应多个上课时段
  const previewItems: PreviewItem[] = (parsedData?.courses || []).map((course) => {
    const slots = (parsedData?.schedules || []).filter((s) => s.courseId === course.id);

    // 可能重复：优先依据 code，无可信 code 时按 name + teacher
    let duplicateReason: string | undefined;
    const candidates = [
      ...courses,
      ...(parsedData?.courses || []).filter((c) => c.id !== course.id),
    ];
    if (isReliableCode(course.code)) {
      const dup = candidates.find((c) => c.code === course.code);
      if (dup) duplicateReason = `${dup.name} (${dup.code})`;
    }
    if (!duplicateReason) {
      const dup = candidates.find(
        (c) => c.name === course.name && c.teacher === course.teacher
      );
      if (dup) duplicateReason = `${dup.name} · ${dup.teacher}`;
    }

    // 与现有课表比较：星期相同 + 时间重叠 + 至少一个共同生效周
    const conflicts = findScheduleConflicts([...schedules, ...slots]).filter(
      (conf) => slots.some((s) => conf.scheduleA.id === s.id || conf.scheduleB.id === s.id)
    );

    return { course, slots, isDuplicate: !!duplicateReason, duplicateReason, conflicts };
  });

  const nameById = new Map<string, string>();
  courses.forEach((c) => nameById.set(c.id, c.name));
  (parsedData?.courses || []).forEach((c) => nameById.set(c.id, c.name));

  const skippedCount = previewItems.filter((item) => skippedCourseIds.includes(item.course.id)).length;
  const conflictCount = previewItems.filter((item) => item.conflicts.length > 0).length;
  const duplicateCount = previewItems.filter((item) => item.isDuplicate).length;

  const toggleSkip = (courseId: string) => {
    setSkippedCourseIds((prev) =>
      prev.includes(courseId) ? prev.filter((id) => id !== courseId) : [...prev, courseId]
    );
  };

  const handleConfirmImport = () => {
    if (!parsedData) return;
    const selectedCourses = parsedData.courses.filter((c) => !skippedCourseIds.includes(c.id));
    if (selectedCourses.length === 0) return;
    const selectedCourseIds = new Set(selectedCourses.map((c) => c.id));
    const selectedSchedules = parsedData.schedules.filter((s) => selectedCourseIds.has(s.courseId));

    importSchedules(selectedCourses, selectedSchedules);
    setStep(1);
    setInputText("");
    setParsedData(null);
    setSkippedCourseIds([]);
    setImportScheduleModalOpen(false);
    pushToast({ message: `已导入 ${selectedCourses.length} 门课程` });
  };

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4",
        "ux-overlay",
        visible ? "opacity-100" : "opacity-0"
      )}
    >
      <div
        className={cn(
          "w-full max-w-2xl bg-surface rounded-2xl shadow-drawer border border-line overflow-hidden flex flex-col max-h-[85dvh]",
          "ux-modal-panel",
          visible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-[0.985] translate-y-1"
        )}
      >
        {/* Header */}
        <div className="p-4 px-6 border-b border-[#F0EBE1] bg-[#F7F5F5] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <FileUp className="w-4 h-4 text-[#A48F82]" />
            <h3 className="text-base font-bold text-charcoal">
              {step === 1 ? "导入课表" : "导入预览"}
            </h3>
          </div>
          <button
            onClick={() => {
              setStep(1);
              setImportScheduleModalOpen(false);
            }}
            className="p-1 rounded-lg text-sandrift hover:bg-alba transition-colors"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Wizard Step 1: Input & Upload */}
        {step === 1 && (
          <div className="p-6 space-y-4 text-xs overflow-y-auto">
            {/* Format Tabs */}
            <div className="grid grid-cols-3 gap-2 p-1 bg-alabaster rounded-xl border border-line-strong">
              <button
                onClick={() => setActiveSource("ical")}
                className={`flex items-center justify-center space-x-1 py-2 rounded-lg font-medium transition-colors ${
                  activeSource === "ical"
                    ? "bg-white text-charcoal font-bold shadow-subtle"
                    : "text-satin-grey hover:text-charcoal"
                }`}
              >
                <Download className="w-3.5 h-3.5" />
                <span>iCal (.ics)</span>
              </button>
              <button
                onClick={() => setActiveSource("csv")}
                className={`flex items-center justify-center space-x-1 py-2 rounded-lg font-medium transition-colors ${
                  activeSource === "csv"
                    ? "bg-white text-charcoal font-bold shadow-subtle"
                    : "text-satin-grey hover:text-charcoal"
                }`}
              >
                <Server className="w-3.5 h-3.5" />
                <span>CSV / 文本表格</span>
              </button>
              <button
                onClick={() => setActiveSource("json")}
                className={`flex items-center justify-center space-x-1 py-2 rounded-lg font-medium transition-colors ${
                  activeSource === "json"
                    ? "bg-white text-charcoal font-bold shadow-subtle"
                    : "text-satin-grey hover:text-charcoal"
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
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-line-strong rounded-lg text-xs font-bold text-charcoal cursor-pointer hover:bg-alabaster transition-colors"
              >
                <FileUp className="w-3.5 h-3.5" />
                <span>选择本地文件</span>
              </label>
            </div>

            {/* Or Paste Raw Text */}
            <div className="space-y-1.5">
              <label className="font-bold text-sandrift">
                或粘贴文本内容
              </label>
              <textarea
                rows={5}
                placeholder={
                  activeSource === "ical"
                    ? "BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:计量经济学\nDTSTART;TZID=Asia/Shanghai:20260824T080000\nDTEND:20260824T094000\nRRULE:FREQ=WEEKLY;BYDAY=MO\nEND:VEVENT\nEND:VCALENDAR"
                    : activeSource === "json"
                    ? '[\n  { "name": "计量经济学", "code": "ECON-301", "dayOfWeek": 2, "startTime": "08:00", "endTime": "09:40" }\n]'
                    : '课程名称,代码,教师,教室,学分,星期,开始时间,结束时间,周次\n"国际贸易,专题研究",ECON301,张教授,教二201,3,2,08:00,09:40,1-16周'
                }
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="w-full p-3 bg-[#F7F5F5] border border-line rounded-xl focus:outline-none focus:border-charcoal font-mono text-[11px] leading-relaxed resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-[#F0EBE1]">
              <p className="text-[10px] text-sandrift">
                支持 iCal、CSV 和 JSON 格式
              </p>
              <button
                type="button"
                onClick={handleParsePreview}
                disabled={!inputText.trim()}
                className="px-4 py-2 text-xs font-bold text-white bg-charcoal rounded-xl hover:bg-black disabled:opacity-50 flex items-center space-x-1"
              >
                <span>预览并检查</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Wizard Step 2: Live Preview & Conflict Check */}
        {step === 2 && parsedData && (
          <div className="p-6 space-y-4 text-xs overflow-y-auto">
            {/* Parsing Errors (skipped rows) */}
            {parsedData.errors.length > 0 && (
              <div className="p-3 bg-danger-bg border border-danger-border rounded-xl text-danger space-y-1">
                <div className="flex items-center space-x-1 font-bold">
                  <AlertTriangle className="w-4 h-4" />
                  <span>{parsedData.errors.length} 条内容无法识别，已跳过</span>
                </div>
                {parsedData.errors.map((err, i) => (
                  <p key={i}>· {err}</p>
                ))}
              </div>
            )}

            {/* Parsing Warnings (fallbacks / complex rules) */}
            {parsedData.warnings.length > 0 && (
              <div className="p-3 bg-warning-bg border border-warning-border rounded-xl text-warning space-y-1">
                <div className="flex items-center space-x-1 font-bold">
                  <Info className="w-4 h-4" />
                  <span>以下内容需要确认</span>
                </div>
                {parsedData.warnings.map((w, i) => (
                  <p key={i}>· {w}</p>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <h4 className="font-bold text-charcoal flex flex-wrap items-center justify-between gap-1">
                <span>将导入 {previewItems.length} 门课程</span>
                <span className="text-xs text-success font-semibold">
                  已识别 {parsedData.schedules.length} 个上课时段
                  {skippedCount > 0 ? ` · 已跳过 ${skippedCount} 门` : ""}
                </span>
              </h4>

              {conflictCount > 0 && (
                <p className="text-[10px] text-danger bg-danger-bg border border-danger-border rounded-lg px-2.5 py-1.5">
                  {conflictCount} 门课程与现有课表时间冲突，取消勾选可跳过后再导入
                </p>
              )}

              {/* Preview Cards (aggregated by course) */}
              <div className="space-y-2">
                {previewItems.map((item) => {
                  const skipped = skippedCourseIds.includes(item.course.id);
                  return (
                    <div
                      key={item.course.id}
                      className={`p-3 rounded-xl border text-xs transition-opacity ${
                        skipped ? "opacity-50" : ""
                      } ${
                        item.conflicts.length > 0
                          ? "bg-danger-bg border-danger-border"
                          : item.isDuplicate
                          ? "bg-warning-bg border-warning-border"
                          : "bg-[#F7F5F5] border-line"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start space-x-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={!skipped}
                            onChange={() => toggleSkip(item.course.id)}
                            className="mt-0.5 w-4 h-4 accent-charcoal cursor-pointer shrink-0"
                            title={skipped ? "已跳过，点击恢复导入" : "点击跳过此课程"}
                          />
                          <div className="min-w-0">
                            <div className="font-bold text-charcoal flex flex-wrap items-center gap-1.5">
                              <span className="truncate">{item.course.name}</span>
                              <span className="text-[10px] font-mono text-sandrift font-medium">
                                ({item.course.code})
                              </span>
                              {item.conflicts.length > 0 && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-danger text-white">
                                  存在冲突
                                </span>
                              )}
                              {item.isDuplicate && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-warning text-white">
                                  可能重复
                                </span>
                              )}
                              {!item.isDuplicate && item.conflicts.length === 0 && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-success text-white">
                                  正常
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-sandrift mt-0.5">
                              教师：{item.course.teacher} · 教室：{item.course.classroom} ·{" "}
                              {item.course.credit} 学分
                            </div>
                            <div className="mt-1 space-y-0.5">
                              {item.slots.length === 0 && (
                                <div className="text-[10px] text-danger">该课程没有任何上课时段</div>
                              )}
                              {item.slots.map((s) => (
                                <div key={s.id} className="font-mono text-[10px] font-semibold text-charcoal">
                                  {dayLabel(s.dayOfWeek)} {s.startTime}-{s.endTime} · {s.weeks} ·{" "}
                                  {s.location}
                                </div>
                              ))}
                            </div>
                            {item.isDuplicate && item.duplicateReason && (
                              <p className="text-[10px] text-warning mt-1">
                                与「{item.duplicateReason}」可能重复
                              </p>
                            )}
                            {item.conflicts.map((conf, i) => {
                              const slotIds = new Set(item.slots.map((s) => s.id));
                              const other = slotIds.has(conf.scheduleA.id)
                                ? conf.scheduleB
                                : conf.scheduleA;
                              const isInternal = slotIds.has(other.id);
                              return (
                                <p key={i} className="text-[10px] text-danger mt-1">
                                  {isInternal ? (
                                    <>本课程内部时段冲突：{dayLabel(conf.dayOfWeek)} {conf.timeRange} 且存在共同生效周</>
                                  ) : (
                                    <>与现有课程「{nameById.get(other.courseId) || "未知课程"}」冲突：{dayLabel(conf.dayOfWeek)} {conf.timeRange} 且存在共同生效周</>
                                  )}
                                </p>
                              );
                            })}
                          </div>
                        </div>
                        {skipped && (
                          <span className="text-[10px] font-bold text-sandrift shrink-0">跳过</span>
                        )}
                      </div>
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
                className="px-4 py-2 text-xs font-medium text-satin-grey bg-[#F7F5F5] border border-line rounded-xl hover:bg-alba"
              >
                返回
              </button>
              <div className="flex items-center space-x-2">
                {duplicateCount > 0 && (
                  <span className="text-[10px] text-warning font-semibold">
                    {duplicateCount} 门可能重复
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleConfirmImport}
                  disabled={previewItems.length - skippedCount === 0}
                  className="ux-press px-5 py-2 text-xs font-bold text-white bg-success hover:bg-success/80 rounded-xl flex items-center space-x-1.5 disabled:opacity-50"
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>
                    {skippedCount > 0
                      ? `导入（跳过 ${skippedCount} 门）`
                      : "导入"}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
