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
import { BookOpen } from "lucide-react";

export default function Home() {
  const {
    activeTab,
    courses,
    userProfile,
    setSelectedCourseId,
  } = useAppStore();

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
            <div className="space-y-4">
              <div className="bg-white border border-[#E7E3DD] rounded-2xl p-4 shadow-subtle">
                <h2 className="text-base font-bold text-charcoal mb-0.5">
                  我的学期完整课表
                </h2>
                <p className="text-xs text-[#8C827A]">
                  2024-2025学年第二学期 · 经济与管理学院
                </p>
              </div>
              <TimetableGrid />
            </div>
          )}

          {activeTab === "assignments" && (
            <div className="space-y-4">
              <div className="bg-white border border-[#E7E3DD] rounded-2xl p-4 shadow-subtle flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-charcoal mb-0.5">
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
            <div className="space-y-4">
              <div className="bg-white border border-[#E7E3DD] rounded-2xl p-4 shadow-subtle">
                <h2 className="text-base font-bold text-charcoal mb-0.5">
                  修读课程与课件资料
                </h2>
                <p className="text-xs text-[#8C827A]">
                  点击课程卡片可查看详细大纲、授课教师及课件下载
                </p>
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
                        {course.materials.length} 份课件资料
                      </span>
                      <span className="font-semibold text-charcoal text-[11px]">
                        查看详情 ↗
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "analytics" && (
            <div className="space-y-4">
              <div className="bg-white border border-[#E7E3DD] rounded-2xl p-4 shadow-subtle">
                <h2 className="text-base font-bold text-charcoal mb-0.5">
                  学习统计与负荷分析
                </h2>
                <p className="text-xs text-[#8C827A]">
                  可视化展示本周与本学期的学业分布情况
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <StudyLoadChart />
                <div className="bg-white border border-[#E7E3DD] rounded-2xl p-4 shadow-subtle flex flex-col justify-between">
                  <h3 className="text-sm font-bold text-charcoal pb-2.5 border-b border-[#F0EBE1]">
                    学分完成进度与绩点概览
                  </h3>
                  <div className="space-y-3 py-3">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[#676268]">累计已修学分</span>
                      <span className="font-bold text-charcoal">
                        64 / 80 学分 (80%)
                      </span>
                    </div>
                    <div className="w-full bg-[#E3E6E0] rounded-full h-2.5 overflow-hidden">
                      <div
                        className="bg-sandrift h-2.5 rounded-full"
                        style={{ width: "80%" }}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-3 border-t border-[#F0EBE1] text-xs">
                      <div className="p-3 bg-[#F7F5F5] rounded-xl border border-[#E7E3DD]">
                        <p className="text-[#8C827A] text-[11px]">平均 GPA</p>
                        <p className="text-lg font-bold text-charcoal mt-0.5">3.82 / 4.0</p>
                      </div>
                      <div className="p-3 bg-[#F7F5F5] rounded-xl border border-[#E7E3DD]">
                        <p className="text-[#8C827A] text-[11px]">按时完成率</p>
                        <p className="text-lg font-bold text-[#4A7C59] mt-0.5">96.5%</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "settings" && (
            <div className="space-y-4 max-w-3xl">
              <div className="bg-white border border-[#E7E3DD] rounded-2xl p-5 shadow-subtle">
                <h2 className="text-base font-bold text-charcoal mb-3">
                  个人设置与偏好
                </h2>
                <div className="space-y-3 text-xs">
                  <div className="flex items-center space-x-3.5 p-3.5 bg-[#F7F5F5] rounded-xl border border-[#E7E3DD]">
                    <img
                      src={userProfile.avatarUrl}
                      alt={userProfile.name}
                      className="w-12 h-12 rounded-full object-cover border border-[#CDB9AB]"
                    />
                    <div>
                      <h3 className="text-xs font-bold text-charcoal">
                        {userProfile.name}
                      </h3>
                      <p className="text-[#676268] mt-0.5 text-[11px]">
                        {userProfile.college} · {userProfile.grade}
                      </p>
                      <p className="text-[10px] text-[#8C827A] font-mono mt-0.5">
                        学号: {userProfile.studentId}
                      </p>
                    </div>
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
