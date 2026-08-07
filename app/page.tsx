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
import { CourseDetailDrawer } from "@/components/drawers/CourseDetailDrawer";
import { AssignmentDrawer } from "@/components/drawers/AssignmentDrawer";
import { GlobalSearchModal } from "@/components/layout/GlobalSearchModal";
import { useAppStore } from "@/store/useAppStore";
import { getPriorityMeta, getStatusMeta } from "@/lib/utils";
import { BookOpen, FileText, Download, CheckCircle2, Award, Clock } from "lucide-react";

export default function Home() {
  const {
    activeTab,
    courses,
    assignments,
    userProfile,
    setSelectedCourseId,
    setSelectedAssignmentId,
  } = useAppStore();

  return (
    <div className="flex min-h-screen bg-[#F7F5F5] font-sans antialiased text-charcoal">
      {/* Fixed Left Navigation Sidebar */}
      <Sidebar />

      {/* Main Content Workspace */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <Header />

        {/* Dynamic Page Views based on activeTab */}
        <main className="flex-1 p-8 space-y-6 overflow-y-auto">
          {activeTab === "overview" && (
            <>
              {/* Top 4 Stat Summary Cards */}
              <StatCards />

              {/* Middle Section: Timetable (Left) + Upcoming DDL & Mini Calendar (Right) */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                <div className="lg:col-span-2 h-full">
                  <TimetableGrid />
                </div>
                <div className="space-y-6">
                  <UpcomingDDL />
                  <MiniCalendar />
                </div>
              </div>

              {/* Bottom Section: Study Load Chart (Left) + Assignments Table (Right) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <StudyLoadChart />
                <AssignmentTable />
              </div>
            </>
          )}

          {activeTab === "timetable" && (
            <div className="space-y-6">
              <div className="bg-white border border-[#E7E3DD] rounded-2xl p-6 shadow-subtle">
                <h2 className="text-lg font-bold text-charcoal mb-2">
                  我的学期完整课表
                </h2>
                <p className="text-xs text-[#8C827A]">
                  2025-2026学年第二学期 · 经济与管理学院
                </p>
              </div>
              <TimetableGrid />
            </div>
          )}

          {activeTab === "assignments" && (
            <div className="space-y-6">
              <div className="bg-white border border-[#E7E3DD] rounded-2xl p-6 shadow-subtle flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-charcoal mb-1">
                    作业与 DDL 管理中心
                  </h2>
                  <p className="text-xs text-[#8C827A]">
                    按截止时间自动排序，实时掌控任务紧急度与完成进度
                  </p>
                </div>
              </div>
              <AssignmentTable />
            </div>
          )}

          {activeTab === "courses" && (
            <div className="space-y-6">
              <div className="bg-white border border-[#E7E3DD] rounded-2xl p-6 shadow-subtle">
                <h2 className="text-lg font-bold text-charcoal mb-1">
                  修读课程与课件资料
                </h2>
                <p className="text-xs text-[#8C827A]">
                  点击课程卡片可查看详细大纲、授课教师及课件下载
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {courses.map((course) => (
                  <div
                    key={course.id}
                    onClick={() => setSelectedCourseId(course.id)}
                    className="p-5 rounded-2xl border transition-all duration-200 cursor-pointer shadow-subtle hover:shadow-card hover:-translate-y-1 flex flex-col justify-between"
                    style={{
                      backgroundColor: `${course.bgHex}50`,
                      borderColor: course.borderHex,
                    }}
                  >
                    <div>
                      <div className="flex justify-between items-start">
                        <span className="text-xs font-mono px-2 py-0.5 bg-white/80 rounded border border-[#E0D7C6] text-charcoal font-medium">
                          {course.code}
                        </span>
                        <span className="text-xs font-semibold text-[#8C827A]">
                          {course.credit} 学分
                        </span>
                      </div>
                      <h3 className="text-lg font-bold text-charcoal mt-3">
                        {course.name}
                      </h3>
                      <p className="text-xs text-[#676268] mt-1 font-medium">
                        教师: {course.teacher} · 教室: {course.classroom}
                      </p>
                      <p className="text-xs text-[#8C827A] mt-2 line-clamp-2 leading-relaxed">
                        {course.description}
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-[#E0D7C6]/60 flex items-center justify-between text-xs text-[#676268]">
                      <span className="flex items-center">
                        <BookOpen className="w-3.5 h-3.5 mr-1 text-[#A48F82]" />
                        {course.materials.length} 份课件资料
                      </span>
                      <span className="font-semibold text-charcoal group-hover:underline">
                        查看详情 ↗
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "analytics" && (
            <div className="space-y-6">
              <div className="bg-white border border-[#E7E3DD] rounded-2xl p-6 shadow-subtle">
                <h2 className="text-lg font-bold text-charcoal mb-1">
                  学习统计与负荷分析
                </h2>
                <p className="text-xs text-[#8C827A]">
                  可视化展示本周与本学期的学业分布情况
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <StudyLoadChart />
                <div className="bg-white border border-[#E7E3DD] rounded-2xl p-5 shadow-subtle flex flex-col justify-between">
                  <h3 className="text-base font-bold text-charcoal pb-3 border-b border-[#F0EBE1]">
                    学分完成进度与绩点概览
                  </h3>
                  <div className="space-y-4 py-4">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-[#676268]">累计已修学分</span>
                      <span className="font-bold text-charcoal">
                        64 / 80 学分 (80%)
                      </span>
                    </div>
                    <div className="w-full bg-[#E3E6E0] rounded-full h-3 overflow-hidden">
                      <div
                        className="bg-sandrift h-3 rounded-full"
                        style={{ width: "80%" }}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4 pt-4 border-t border-[#F0EBE1] text-xs">
                      <div className="p-3 bg-[#F7F5F5] rounded-xl border border-[#E7E3DD]">
                        <p className="text-[#8C827A]">平均 GPA</p>
                        <p className="text-xl font-bold text-charcoal mt-1">3.82 / 4.0</p>
                      </div>
                      <div className="p-3 bg-[#F7F5F5] rounded-xl border border-[#E7E3DD]">
                        <p className="text-[#8C827A]">按时完成率</p>
                        <p className="text-xl font-bold text-[#4A7C59] mt-1">96.5%</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "settings" && (
            <div className="space-y-6 max-w-3xl">
              <div className="bg-white border border-[#E7E3DD] rounded-2xl p-6 shadow-subtle">
                <h2 className="text-lg font-bold text-charcoal mb-4">
                  个人设置与偏好
                </h2>
                <div className="space-y-4 text-xs">
                  <div className="flex items-center space-x-4 p-4 bg-[#F7F5F5] rounded-xl border border-[#E7E3DD]">
                    <img
                      src={userProfile.avatarUrl}
                      alt={userProfile.name}
                      className="w-14 h-14 rounded-full object-cover border border-[#CDB9AB]"
                    />
                    <div>
                      <h3 className="text-sm font-bold text-charcoal">
                        {userProfile.name}
                      </h3>
                      <p className="text-[#676268] mt-0.5">
                        {userProfile.college} · {userProfile.grade}
                      </p>
                      <p className="text-[11px] text-[#8C827A] font-mono mt-0.5">
                        学号: {userProfile.studentId}
                      </p>
                    </div>
                  </div>
                  <div className="p-4 bg-white border border-[#E7E3DD] rounded-xl space-y-3">
                    <h4 className="font-semibold text-charcoal">界面与色彩主题</h4>
                    <p className="text-[#8C827A]">
                      当前已应用“低饱和米褐灰炭”极简高级调色盘（Alabaster, Stone Beige, Dark Charcoal, Pastel Mint）。
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Global Drawers & Modals */}
      <CourseDetailDrawer />
      <AssignmentDrawer />
      <GlobalSearchModal />
    </div>
  );
}
