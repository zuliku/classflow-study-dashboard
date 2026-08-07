"use client";

import React from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { StatCards } from "@/components/dashboard/StatCards";
import { TimetableGrid } from "@/components/dashboard/TimetableGrid";
import { UpcomingDDL } from "@/components/dashboard/UpcomingDDL";
import { MiniCalendar } from "@/components/dashboard/MiniCalendar";
import { StudyLoadChart } from "@/components/dashboard/StudyLoadChart";
import { AssignmentTable } from "@/components/dashboard/AssignmentTable";
import { GroupCollaborationView } from "@/components/group/GroupCollaborationView";
import { SettingsView } from "@/components/settings/SettingsView";
import { CourseDetailDrawer } from "@/components/drawers/CourseDetailDrawer";
import { AssignmentDrawer } from "@/components/drawers/AssignmentDrawer";
import { GlobalSearchModal } from "@/components/layout/GlobalSearchModal";
import { AddCourseModal } from "@/components/modals/AddCourseModal";
import { ImportScheduleModal } from "@/components/modals/ImportScheduleModal";
import { ConflictResolutionModal } from "@/components/modals/ConflictResolutionModal";
import { FullTimetableModal } from "@/components/modals/FullTimetableModal";
import { AddAssignmentModal } from "@/components/modals/AddAssignmentModal";
import { FilePreviewModal } from "@/components/modals/FilePreviewModal";
import { useAppStore } from "@/store/useAppStore";
import { computeWeekCourseLoad } from "@/lib/studyLoad";
import {
  BookOpen,
  Plus,
  FileUp,
  BarChart2,
  CheckCircle2,
  Clock,
  ExternalLink,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
} from "recharts";

export default function Home() {
  const {
    activeTab,
    courses,
    assignments,
    userProfile,
    semester,
    schedules,
    setSelectedCourseId,
    setAddCourseModalOpen,
    setImportScheduleModalOpen,
    setFullTimetableModalOpen,
  } = useAppStore();

  // 本周课程时长：按当前教学周实际生效课表实算（endTime - startTime）
  const weekCourseLoad = computeWeekCourseLoad(schedules, semester);

  // Statistics derived dynamically 100% from Zustand store
  const totalTasks = assignments.length;
  const completedTasks = assignments.filter((a) => a.status === "completed").length;
  const doingTasks = assignments.filter((a) => a.status === "doing").length;
  const todoTasks = assignments.filter((a) => a.status === "todo").length;

  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const totalCredits = courses.reduce((sum, c) => sum + c.credit, 0);

  // Status Pie Data derived from real counts
  const statusPieData = [
    { name: "已完成", value: completedTasks, color: "#4A7C59" },
    { name: "进行中", value: doingTasks, color: "#CDB9AB" },
    { name: "待完成", value: todoTasks, color: "#A48F82" },
  ].filter((item) => item.value > 0 || totalTasks === 0);

  // Priority Bar Data derived from real counts
  const priorityPieData = [
    { name: "紧急", value: assignments.filter((a) => a.priority === "urgent").length, color: "#D94F4F" },
    { name: "高优先", value: assignments.filter((a) => a.priority === "high").length, color: "#E28743" },
    { name: "中优先", value: assignments.filter((a) => a.priority === "medium").length, color: "#D9A05B" },
    { name: "低优先", value: assignments.filter((a) => a.priority === "low").length, color: "#4A7C59" },
  ];

  return (
    <div className="flex min-h-screen bg-[#F7F5F5] font-sans antialiased text-charcoal">
      {/* Fixed Left Navigation Sidebar */}
      <Sidebar />

      {/* Main Content Workspace */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <Header />

        {/* Dynamic Page Views */}
        <main className="flex-1 p-5 space-y-4 overflow-y-auto">
          {activeTab === "overview" && (
            <>
              {/* Row 1: Top 4 Stat Summary Cards */}
              <StatCards />

              {/* Row 2: Middle TimetableGrid (2/3) + Upcoming DDL & Mini Calendar (1/3) */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
                <div className="lg:col-span-2 flex flex-col">
                  <TimetableGrid />
                </div>
                <div className="space-y-4 flex flex-col justify-between">
                  <UpcomingDDL />
                  <MiniCalendar />
                </div>
              </div>

              {/* Row 3: Bottom Study Load Chart (1/2) + Assignments Table (1/2) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
                <StudyLoadChart />
                <AssignmentTable />
              </div>
            </>
          )}

          {activeTab === "timetable" && (
            <div className="space-y-4 flex flex-col h-[calc(100vh-100px)]">
              {/* Top Banner with Edit & Import Actions */}
              <div className="bg-white border border-[#E7E3DD] rounded-2xl p-4 shadow-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
                <div>
                  <h2 className="text-base font-bold text-charcoal mb-0.5">
                    学期课表
                  </h2>
                  <p className="text-xs text-[#8C827A]">
                    {semester.name} · {userProfile.college}
                  </p>
                </div>
                <div className="flex items-center space-x-2 shrink-0">
                  <button
                    onClick={() => setFullTimetableModalOpen(true)}
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-[#F0EBE1] text-charcoal border border-[#E0D7C6] text-xs font-bold rounded-xl transition-colors shadow-subtle"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>全屏课表</span>
                  </button>
                  <button
                    onClick={() => setAddCourseModalOpen(true)}
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#E3E6E0] hover:bg-[#D0D5CC] text-charcoal text-xs font-bold rounded-xl transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>添加课程</span>
                  </button>
                  <button
                    onClick={() => setImportScheduleModalOpen(true)}
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-xl transition-colors"
                  >
                    <FileUp className="w-3.5 h-3.5" />
                    <span>导入课表</span>
                  </button>
                </div>
              </div>

              {/* Full height adaptive Timetable Container */}
              <div className="flex-1 flex flex-col min-h-0">
                <TimetableGrid />
              </div>
            </div>
          )}

          {activeTab === "assignments" && (
            <div className="space-y-4">
              <div className="bg-white border border-[#E7E3DD] rounded-2xl p-4 shadow-subtle flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-charcoal mb-0.5">
                    任务清单
                  </h2>
                  <p className="text-xs text-[#8C827A]">
                    全部任务与截止时间
                  </p>
                </div>
              </div>
              <AssignmentTable />
            </div>
          )}

          {activeTab === "courses" && (
            <div className="space-y-4">
              <div className="bg-white border border-[#E7E3DD] rounded-2xl p-4 shadow-subtle flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-charcoal mb-0.5">
                    本学期课程
                  </h2>
                  <p className="text-xs text-[#8C827A]">
                    点击课程卡片查看资料
                  </p>
                </div>
                <button
                  onClick={() => setAddCourseModalOpen(true)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-charcoal text-white text-xs font-medium rounded-xl hover:bg-black"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>添加课程</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {courses.map((course) => (
                  <div
                    key={course.id}
                    onClick={() => setSelectedCourseId(course.id)}
                    className="p-4 rounded-2xl border transition-all duration-200 cursor-pointer shadow-subtle hover:shadow-card hover:-translate-y-1 flex flex-col justify-between"
                    style={{
                      backgroundColor: `${course.bgHex}50`,
                      borderColor: course.borderHex,
                    }}
                  >
                    <div>
                      <div className="flex justify-between items-start">
                        <span className="text-[11px] font-mono px-2 py-0.5 bg-white/80 rounded border border-[#E0D7C6] text-charcoal font-medium">
                          {course.code}
                        </span>
                        <span className="text-xs font-semibold text-[#8C827A]">
                          {course.credit} 学分
                        </span>
                      </div>
                      <h3 className="text-base font-bold text-charcoal mt-2.5">
                        {course.name}
                      </h3>
                      <p className="text-xs text-[#676268] mt-1 font-medium">
                        教师: {course.teacher} · 教室: {course.classroom}
                      </p>
                      <p className="text-xs text-[#8C827A] mt-1.5 line-clamp-2 leading-relaxed">
                        {course.description}
                      </p>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-[#E0D7C6]/60 flex items-center justify-between text-xs text-[#676268]">
                      <span className="flex items-center text-[11px]">
                        <BookOpen className="w-3.5 h-3.5 mr-1 text-[#A48F82]" />
                        {course.materials.length} 份资料
                      </span>
                      <span className="font-semibold text-charcoal text-[11px]">
                        查看资料
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "group" && <GroupCollaborationView />}

          {activeTab === "analytics" && (
            <div className="space-y-4">
              {/* Analytics Header Banner */}
              <div className="bg-white border border-[#E7E3DD] rounded-2xl p-4 shadow-subtle">
                <h2 className="text-base font-bold text-charcoal mb-0.5 flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-[#A48F82]" />
                  学习统计
                </h2>
                <p className="text-xs text-[#8C827A]">
                  任务完成进度与本周课程负荷
                </p>
              </div>

              {/* Metric Summary Cards Derived Dynamically */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-white border border-[#E7E3DD] rounded-2xl shadow-subtle space-y-1">
                  <span className="text-xs font-semibold text-[#8C827A]">按时完成率</span>
                  <div className="text-2xl font-extrabold text-[#4A7C59]">{completionRate}%</div>
                  <p className="text-[10px] text-[#4A7C59] font-medium">
                    已完成 {completedTasks} / {totalTasks} 项任务
                  </p>
                </div>
                <div className="p-4 bg-white border border-[#E7E3DD] rounded-2xl shadow-subtle space-y-1">
                  <span className="text-xs font-semibold text-[#8C827A]">在读课程</span>
                  <div className="text-2xl font-extrabold text-charcoal">{courses.length} 门</div>
                  <p className="text-[10px] text-[#8C827A]">共 {totalCredits} 学分</p>
                </div>
                <div className="p-4 bg-white border border-[#E7E3DD] rounded-2xl shadow-subtle space-y-1">
                  <span className="text-xs font-semibold text-[#8C827A]">本周课程时长</span>
                  <div className="text-2xl font-extrabold text-charcoal">
                    {weekCourseLoad.totalHours} h
                  </div>
                  <p className="text-[10px] text-[#4A7C59] font-medium">
                    {weekCourseLoad.isInSemester
                      ? `第 ${weekCourseLoad.week} 周 · 按实际课表统计`
                      : "本周不在教学周内"}
                  </p>
                </div>
              </div>

              {/* Visual Distribution Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* 1. Assignment Status Distribution Pie */}
                <div className="bg-white border border-[#E7E3DD] rounded-2xl p-4 shadow-subtle flex flex-col justify-between">
                  <h3 className="text-sm font-bold text-charcoal pb-2 border-b border-[#F0EBE1]">
                    任务状态
                  </h3>
                  <div className="h-56 w-full flex items-center justify-center my-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={statusPieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={85}
                          paddingAngle={4}
                          dataKey="value"
                        >
                          {statusPieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#313032",
                            borderRadius: "10px",
                            color: "#FFF",
                            fontSize: "11px",
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex justify-around text-xs pt-2 border-t border-[#F0EBE1]">
                    {statusPieData.map((d) => (
                      <div key={d.name} className="flex items-center space-x-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: d.color }}
                        />
                        <span className="text-[#676268]">{d.name}:</span>
                        <span className="font-bold text-charcoal">{d.value} 项</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 2. Assignment Priority Breakdown */}
                <div className="bg-white border border-[#E7E3DD] rounded-2xl p-4 shadow-subtle flex flex-col justify-between">
                  <h3 className="text-sm font-bold text-charcoal pb-2 border-b border-[#F0EBE1]">
                    任务优先级分布
                  </h3>
                  <div className="h-56 w-full flex items-center justify-center my-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={priorityPieData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#8C827A" }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 9, fill: "#8C827A" }} axisLine={false} tickLine={false} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#313032",
                            borderRadius: "10px",
                            color: "#FFF",
                            fontSize: "11px",
                          }}
                        />
                        <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                          {priorityPieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-[11px] text-[#8C827A] text-center pt-2 border-t border-[#F0EBE1]">
                    临近截止的紧急任务
                  </p>
                </div>
              </div>

              {/* 3. Study Load Bar Chart */}
              <div className="w-full">
                <StudyLoadChart />
              </div>
            </div>
          )}

          {activeTab === "settings" && <SettingsView />}
        </main>
      </div>

      {/* Global Drawers & Modals */}
      <CourseDetailDrawer />
      <AssignmentDrawer />
      <GlobalSearchModal />
      <AddCourseModal />
      <ImportScheduleModal />
      <ConflictResolutionModal />
      <FullTimetableModal />
      <AddAssignmentModal />
      <FilePreviewModal />
    </div>
  );
}
