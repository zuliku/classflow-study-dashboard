"use client";

import React from "react";
import { Calendar, ClipboardList, Clock, CheckCircle2, ChevronRight, ArrowUpRight } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";

export function StatCards() {
  const { assignments, setActiveTab } = useAppStore();

  const pendingAssignmentsCount = assignments.filter((a) => a.status !== "completed").length;
  const completedAssignmentsCount = assignments.filter((a) => a.status === "completed").length;
  const nearDDLCount = assignments.filter((a) => a.status !== "completed" && (a.priority === "urgent" || a.priority === "high")).length;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
      {/* Card 1: 今日课程 */}
      <div
        onClick={() => setActiveTab("timetable")}
        className="bg-[#E3E6E0]/60 border border-[#D0D5CC] rounded-2xl p-3.5 flex items-center justify-between cursor-pointer hover:shadow-card hover:bg-[#E3E6E0]/80 transition-all duration-200 group"
      >
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-white border border-[#D0D5CC] flex items-center justify-center text-charcoal shadow-subtle group-hover:scale-105 transition-transform">
            <Calendar className="w-4 h-4 text-charcoal" />
          </div>
          <div>
            <span className="text-[11px] font-medium text-[#676268]">今日课程</span>
            <div className="flex items-baseline space-x-1 mt-0.5">
              <span className="text-xl font-bold text-charcoal tracking-tight">3</span>
              <span className="text-xs font-medium text-[#676268]">节</span>
            </div>
            <p className="text-[10px] text-[#676268] mt-0.5">
              还有 1 节课即将开始
            </p>
          </div>
        </div>
        <ChevronRight className="w-3.5 h-3.5 text-[#8C827A] group-hover:translate-x-0.5 transition-transform" />
      </div>

      {/* Card 2: 本周作业 */}
      <div
        onClick={() => setActiveTab("assignments")}
        className="bg-[#F0EBE1]/70 border border-[#E0D7C6] rounded-2xl p-3.5 flex items-center justify-between cursor-pointer hover:shadow-card hover:bg-[#F0EBE1] transition-all duration-200 group"
      >
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-white border border-[#E0D7C6] flex items-center justify-center text-charcoal shadow-subtle group-hover:scale-105 transition-transform">
            <ClipboardList className="w-4 h-4 text-charcoal" />
          </div>
          <div>
            <span className="text-[11px] font-medium text-[#676268]">本周作业</span>
            <div className="flex items-baseline space-x-1 mt-0.5">
              <span className="text-xl font-bold text-charcoal tracking-tight">6</span>
              <span className="text-xs font-medium text-[#676268]">项</span>
            </div>
            <p className="text-[10px] text-[#4A7C59] font-medium mt-0.5 flex items-center">
              较上周 +2 项 <ArrowUpRight className="w-3 h-3 ml-0.5" />
            </p>
          </div>
        </div>
        <ChevronRight className="w-3.5 h-3.5 text-[#8C827A] group-hover:translate-x-0.5 transition-transform" />
      </div>

      {/* Card 3: 临近 DDL */}
      <div
        onClick={() => setActiveTab("assignments")}
        className="bg-[#FDF0F0]/70 border border-[#F8D7D7] rounded-2xl p-3.5 flex items-center justify-between cursor-pointer hover:shadow-card hover:bg-[#FDF0F0] transition-all duration-200 group"
      >
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-white border border-[#F8D7D7] flex items-center justify-center text-[#D94F4F] shadow-subtle group-hover:scale-105 transition-transform">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[11px] font-medium text-[#8C4A4A]">临近 DDL</span>
            <div className="flex items-baseline space-x-1 mt-0.5">
              <span className="text-xl font-bold text-[#D94F4F] tracking-tight">4</span>
              <span className="text-xs font-medium text-[#8C4A4A]">项</span>
            </div>
            <p className="text-[10px] text-[#D94F4F] font-semibold mt-0.5">
              3 天内截止
            </p>
          </div>
        </div>
        <ChevronRight className="w-3.5 h-3.5 text-[#C48C8C] group-hover:translate-x-0.5 transition-transform" />
      </div>

      {/* Card 4: 已完成任务 */}
      <div
        onClick={() => setActiveTab("assignments")}
        className="bg-[#CCCBC4]/40 border border-[#B8B7B0] rounded-2xl p-3.5 flex items-center justify-between cursor-pointer hover:shadow-card hover:bg-[#CCCBC4]/60 transition-all duration-200 group"
      >
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-white border border-[#B8B7B0] flex items-center justify-center text-charcoal shadow-subtle group-hover:scale-105 transition-transform">
            <CheckCircle2 className="w-4 h-4 text-charcoal" />
          </div>
          <div>
            <span className="text-[11px] font-medium text-[#676268]">已完成任务</span>
            <div className="flex items-baseline space-x-1 mt-0.5">
              <span className="text-xl font-bold text-charcoal tracking-tight">18</span>
              <span className="text-xs font-medium text-[#676268]">项</span>
            </div>
            <p className="text-[10px] text-[#4A7C59] font-medium mt-0.5 flex items-center">
              本周完成 +5 项 <ArrowUpRight className="w-3 h-3 ml-0.5" />
            </p>
          </div>
        </div>
        <ChevronRight className="w-3.5 h-3.5 text-[#8C827A] group-hover:translate-x-0.5 transition-transform" />
      </div>
    </div>
  );
}
