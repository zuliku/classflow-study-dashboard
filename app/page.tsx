"use client";

import React, { useEffect, useRef } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { TimetableGrid } from "@/components/dashboard/TimetableGrid";
import { TimetableQuickGlance } from "@/components/dashboard/TimetableQuickGlance";
import { UpcomingDDL } from "@/components/dashboard/UpcomingDDL";
import { MiniCalendar } from "@/components/dashboard/MiniCalendar";
import { StudyLoadChart } from "@/components/dashboard/StudyLoadChart";
import { AssignmentTable } from "@/components/dashboard/AssignmentTable";
import { GroupCollaborationView } from "@/components/group/GroupCollaborationView";
import { KiroWorkspace } from "@/components/kiro/KiroWorkspace";
import { KiroSessionProvider } from "@/components/kiro/KiroSessionProvider";
import { TimelineWorkspace } from "@/components/timeline/TimelineWorkspace";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { CourseDetailDrawer } from "@/components/drawers/CourseDetailDrawer";
import { AssignmentDrawer } from "@/components/drawers/AssignmentDrawer";
import { CommandCenter } from "@/components/command/CommandCenter";
import { GlobalShortcutController } from "@/components/command/GlobalShortcutController";
import { AddCourseModal } from "@/components/modals/AddCourseModal";
import { ImportScheduleModal } from "@/components/modals/ImportScheduleModal";
import { ConflictResolutionModal } from "@/components/modals/ConflictResolutionModal";
import { FullTimetableModal } from "@/components/modals/FullTimetableModal";
import { AddAssignmentModal } from "@/components/modals/AddAssignmentModal";
import { FilePreviewModal } from "@/components/modals/FilePreviewModal";
import { ToastViewport } from "@/components/ui/ToastViewport";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageTransition } from "@/components/ui/PageTransition";
import { useAppStore } from "@/store/useAppStore";
import { computeWeekCourseLoad } from "@/lib/studyLoad";
import { cardKeyHandler, cn } from "@/lib/utils";
import { openAssignmentEditor } from "@/lib/uiEvents";
import { reconcileOrphanBlobs } from "@/lib/fileStorage";
import { resolveStartupTab } from "@/lib/startup";
import {
  BookOpen,
  Plus,
  FileUp,
  BarChart2,
  ExternalLink,
  CalendarDays,
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
    setSettingsModalOpen,
  } = useAppStore();

  // 本周课程时长：按当前教学周实际生效课表实算（endTime - startTime）
  const weekCourseLoad = computeWeekCourseLoad(schedules, semester);

  // 启动时孤儿 Blob 对账：清理刷新/关闭浏览器后遗留、不再被任何资料引用的 IndexedDB 文件
  useEffect(() => {
    const validKeys = new Set<string>();
    useAppStore.getState().courses.forEach((c) =>
      c.materials.forEach((m) => {
        if (m.storageKey) validKeys.add(m.storageKey);
      })
    );
    reconcileOrphanBlobs(validKeys).catch(() => {});
  }, []);

  // Motion Preference：应用级动效覆盖（system / full / reduced）写入 <html data-motion>
  const motionPreference = useAppStore((s) => s.preferences.motionPreference);
  useEffect(() => {
    document.documentElement.dataset.motion = motionPreference;
  }, [motionPreference]);

  // 启动位置：hydrate 完成后只执行一次 startup resolution。
  // last 使用上次使用的工作区（lastWorkspaceTab，持久化）。
  // 只依赖空数组：修改设置值只影响下次打开 ClassFlow，不会把用户踢走。
  const startupApplied = useRef(false);
  useEffect(() => {
    if (startupApplied.current) return;
    startupApplied.current = true;
    const s = useAppStore.getState();
    const tab = resolveStartupTab(s.preferences.startupView, s.lastWorkspaceTab);
    if (tab !== s.activeTab) s.setActiveTab(tab);
  }, []);

  // 内容密度：课程列表（任务工作区/命令中心各自处理）
  const contentDensity = useAppStore((s) => s.preferences.contentDensity);
  const compactCourses = contentDensity === "compact";

  // Statistics derived dynamically 100% from Zustand store
  const totalTasks = assignments.length;
  const completedTasks = assignments.filter((a) => a.status === "completed").length;
  const doingTasks = assignments.filter((a) => a.status === "doing").length;
  const todoTasks = assignments.filter((a) => a.status === "todo").length;

  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const totalCredits = courses.reduce((sum, c) => sum + c.credit, 0);

  // Status Pie Data derived from real counts
  const statusPieData = [
    { name: "已完成", value: completedTasks, color: "#627566" },
    { name: "进行中", value: doingTasks, color: "#CDB9AB" },
    { name: "待完成", value: todoTasks, color: "#A48F82" },
  ].filter((item) => item.value > 0 || totalTasks === 0);

  // Priority Bar Data derived from real counts
  const priorityPieData = [
    { name: "紧急", value: assignments.filter((a) => a.priority === "urgent").length, color: "#9B5B57" },
    { name: "高优先", value: assignments.filter((a) => a.priority === "high").length, color: "#A87952" },
    { name: "中优先", value: assignments.filter((a) => a.priority === "medium").length, color: "#CDB9AB" },
    { name: "低优先", value: assignments.filter((a) => a.priority === "low").length, color: "#627566" },
  ];

  return (
    <KiroSessionProvider>
      {/* Fixed Left Navigation Sidebar */}
      <Sidebar />

      {/* Main Content Workspace */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <Header />

        {/* Dynamic Page Views */}
        {/* Kiro Tab：full-bleed shell（p-0 且 md+ 无底部 padding），gutter 由 KiroWorkspace 内部提供，
            History Panel 可从 Header 下沿连续延伸到视口底部（border-l 不断线） */}
        <main
          className={cn(
            "flex-1 flex flex-col overflow-y-auto",
            activeTab === "kiro" ? "p-0 pb-24 md:p-0 md:pb-0" : "p-4 md:p-6 pb-24 md:pb-6"
          )}
        >
          <PageTransition
            tab={activeTab}
            className={cn("space-y-5", activeTab === "kiro" && "flex flex-col flex-1 min-h-0")}
          >
          {activeTab === "overview" && (
            <>
              {/* First Run：空工作区时显示 Getting Started（非阻塞，三个动作即可开始） */}
              {courses.length === 0 && schedules.length === 0 && assignments.length === 0 ? (
                <div
                  data-testid="getting-started"
                  className="bg-surface border border-line rounded-2xl p-8 shadow-subtle space-y-4 text-center"
                >
                  <div>
                    <h2 className="text-lg font-bold text-charcoal">欢迎使用 ClassFlow</h2>
                    <p className="text-xs text-sandrift mt-1">建立你的学习工作区</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2.5">
                    <button
                      onClick={() => setImportScheduleModalOpen(true)}
                      className="ux-press flex items-center gap-1.5 px-4 py-2 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-xl transition-colors shadow-subtle"
                    >
                      <FileUp className="w-3.5 h-3.5" />
                      导入课表
                    </button>
                    <button
                      onClick={() => setAddCourseModalOpen(true)}
                      className="ux-press flex items-center gap-1.5 px-4 py-2 bg-pastel-mint hover:bg-pastel-mint text-charcoal text-xs font-bold rounded-xl transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      添加第一门课程
                    </button>
                    <button
                      onClick={() => setSettingsModalOpen(true)}
                      className="ux-press flex items-center gap-1.5 px-4 py-2 bg-white border border-line-strong text-charcoal text-xs font-bold rounded-xl transition-colors hover:bg-alabaster"
                    >
                      <CalendarDays className="w-3.5 h-3.5 text-[#A48F82]" />
                      设置当前学期
                    </button>
                  </div>
                  <p className="text-[10px] text-sandrift">
                    也可以直接新建任务或浏览课表，随时可以从设置中调整
                  </p>
                </div>
              ) : (
                <>
              {/* Row 1: Overview Hero（Desktop ≥1280 = 一屏：课表 2/3 + DDL/月历 1/3，严格同顶同底） */}
              {/* Tablet 768–1023 自然降列 2+1，Desktop 恢复 2/3 + 1/3 */}
              {/* items-stretch：左侧完整时间轴课表是 Row 高度基准；右侧用稳定比例 grid-rows 适配等高 */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch xl:h-[calc(100dvh-7rem)]">
                <div className="lg:col-span-2 flex flex-col min-h-0">
                  <TimetableGrid density="compact" fillAvailableHeight headerActions={<TimetableQuickGlance />} />
                </div>
                {/* 右栏：DDL 吸收剩余高度（flex-1），Calendar 固定稳定高度（不随月份/内容变化）
                    右栏总高恒等于左侧课表 → 三卡同顶同底 */}
                <div className="flex flex-col h-full min-h-0 gap-5">
                  <div className="flex-1 min-h-0">
                    <UpcomingDDL />
                  </div>
                  <div className="h-[380px] lg:h-[390px] xl:h-[410px] 2xl:h-[420px] shrink-0">
                    <MiniCalendar />
                  </div>
                </div>
              </div>

              {/* Row 3: Bottom Study Load Chart (1/2) + Assignments Table (1/2) */}
              {/* 依据主内容可用宽度降列（auto-fit minmax，非 viewport breakpoint）：
                  容器 ≥1060px → 2 列；被 Docked Kiro 压窄 / 移动端 → 自动 1 列。
                  两张卡 min-h-460 + grid stretch：2 列时视觉等高；内容超 460 时自然增长（绝无固定高度内重叠）。 */}
              <div className="grid gap-5 items-stretch grid-cols-[repeat(auto-fit,minmax(520px,1fr))]">
                <div className="md:min-h-[460px]" data-testid="overview-load-wrap">
                  <StudyLoadChart />
                </div>
                <div className="md:min-h-[460px] min-w-0" data-testid="overview-tasks-wrap">
                  <AssignmentTable mode="compact" />
                </div>
              </div>
                </>
              )}
            </>
          )}

          {activeTab === "timetable" && (
            <div className="space-y-4">
              <TimelineWorkspace />
            </div>
          )}

          {activeTab === "assignments" && (
            <div className="space-y-4">
              <div className="bg-surface border border-line rounded-2xl p-4 shadow-subtle flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-charcoal mb-0.5">
                    任务清单
                  </h2>
                  <p className="text-xs text-sandrift">
                    全部任务与截止时间
                  </p>
                </div>
              </div>
              <AssignmentTable mode="workspace" />
            </div>
          )}

          {activeTab === "courses" && (
            <div className="space-y-4">
              <div className="bg-surface border border-line rounded-2xl p-4 shadow-subtle flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-charcoal mb-0.5">
                    本学期课程
                  </h2>
                  <p className="text-xs text-sandrift">
                    点击课程卡片查看资料
                  </p>
                </div>
                <button
                  onClick={() => setAddCourseModalOpen(true)}
                  className="ux-press flex items-center space-x-1.5 px-3 py-1.5 bg-charcoal text-white text-xs font-medium rounded-xl hover:bg-black"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>添加课程</span>
                </button>
              </div>

              {courses.length === 0 ? (
                <div className="bg-surface border border-line rounded-2xl p-10 shadow-subtle flex flex-col items-center justify-center gap-2.5 text-center">
                  <p className="text-xs font-bold text-charcoal">暂无课程</p>
                  <p className="text-[11px] text-sandrift">添加第一门课程或导入课表</p>
                  <button
                    onClick={() => setAddCourseModalOpen(true)}
                    className="ux-press mt-1 px-4 py-2 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-xl transition-colors shadow-subtle"
                  >
                    <Plus className="w-3.5 h-3.5 inline-block mr-1" />
                    添加课程
                  </button>
                </div>
              ) : (
              <div
                data-density={contentDensity}
                className={cn(
                  "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
                  compactCourses ? "gap-3" : "gap-4"
                )}
              >
                {courses.map((course) => (
                  <div
                    key={course.id}
                    onClick={() => setSelectedCourseId(course.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={cardKeyHandler(() => setSelectedCourseId(course.id))}
                    className={cn(
                      "group rounded-2xl border transition-[transform,box-shadow] duration-[var(--motion-base)] ease-[var(--ease-standard)] cursor-pointer shadow-subtle hover:shadow-card hover:-translate-y-px flex flex-col justify-between",
                      compactCourses ? "p-3" : "p-4"
                    )}
                    style={{
                      backgroundColor: `${course.bgHex}50`,
                      borderColor: course.borderHex,
                    }}
                  >
                    <div>
                      <div className="flex justify-between items-start">
                        <span className="text-[11px] font-mono px-2 py-0.5 bg-white/80 rounded border border-line-strong text-charcoal font-medium">
                          {course.code}
                        </span>
                        <span className="text-xs font-semibold text-sandrift">
                          {course.credit} 学分
                        </span>
                      </div>
                      <h3 className="text-base font-bold text-charcoal mt-2.5">
                        {course.name}
                      </h3>
                      <p className="text-xs text-satin-grey mt-1 font-medium">
                        教师：{course.teacher} · 教室：{course.classroom}
                      </p>
                      <p className="text-xs text-sandrift mt-1.5 line-clamp-2 leading-relaxed">
                        {course.description}
                      </p>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-line-strong/60 flex items-center justify-between text-xs text-satin-grey">
                      <span className="flex items-center text-[11px]">
                        <BookOpen className="w-3.5 h-3.5 mr-1 text-[#A48F82]" />
                        {course.materials.length} 份资料
                      </span>
                      <div className="flex items-center space-x-2 shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openAssignmentEditor({ courseId: course.id });
                          }}
                          className="px-2 py-0.5 rounded-lg text-[10px] font-bold text-charcoal bg-white/90 border border-line-strong opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-alabaster transition-[opacity,background-color,border-color]"
                          title="添加任务"
                        >
                          + 任务
                        </button>
                        <span className="font-semibold text-charcoal text-[11px]">
                          查看资料
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              )}
            </div>
          )}

          {activeTab === "kiro" && <KiroWorkspace />}

          {activeTab === "group" && <GroupCollaborationView />}

          {activeTab === "analytics" && (
            <div className="space-y-4">
              {/* Analytics Header Banner */}
              <div className="bg-surface border border-line rounded-2xl p-4 shadow-subtle">
                <h2 className="text-base font-bold text-charcoal mb-0.5 flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-[#A48F82]" />
                  学习统计
                </h2>
                <p className="text-xs text-sandrift">
                  任务完成进度与本周课程负荷
                </p>
              </div>

              {/* 无数据：不生成假图 */}
              {assignments.length === 0 && schedules.length === 0 ? (
                <div className="bg-surface border border-line rounded-2xl p-10 shadow-subtle flex items-center justify-center">
                  <p className="text-xs text-sandrift">暂无可分析的学习数据</p>
                </div>
              ) : (<>
              {/* Metric Summary Cards Derived Dynamically */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-surface border border-line rounded-2xl shadow-subtle space-y-1">
                  <span className="text-xs font-semibold text-sandrift">任务完成率</span>
                  <div className="text-2xl font-extrabold text-success">{completionRate}%</div>
                  <p className="text-[10px] text-success font-medium">
                    已完成 {completedTasks} / {totalTasks} 项任务
                  </p>
                </div>
                <div className="p-4 bg-surface border border-line rounded-2xl shadow-subtle space-y-1">
                  <span className="text-xs font-semibold text-sandrift">在读课程</span>
                  <div className="text-2xl font-extrabold text-charcoal">{courses.length} 门</div>
                  <p className="text-[10px] text-sandrift">共 {totalCredits} 学分</p>
                </div>
                <div className="p-4 bg-surface border border-line rounded-2xl shadow-subtle space-y-1">
                  <span className="text-xs font-semibold text-sandrift">本周课程时长</span>
                  <div className="text-2xl font-extrabold text-charcoal">
                    {weekCourseLoad.totalHours} h
                  </div>
                  <p className="text-[10px] text-success font-medium">
                    {weekCourseLoad.isInSemester
                      ? `第 ${weekCourseLoad.week} 周 · 按实际课表统计`
                      : "本周不在教学周内"}
                  </p>
                </div>
              </div>

              {/* Visual Distribution Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* 1. Assignment Status Distribution Pie */}
                <div className="bg-surface border border-line rounded-2xl p-4 shadow-subtle flex flex-col justify-between">
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
                          animationDuration={450}
                          animationEasing="ease-out"
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
                        <span className="text-satin-grey">{d.name}:</span>
                        <span className="font-bold text-charcoal">{d.value} 项</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 2. Assignment Priority Breakdown */}
                <div className="bg-surface border border-line rounded-2xl p-4 shadow-subtle flex flex-col justify-between">
                  <h3 className="text-sm font-bold text-charcoal pb-2 border-b border-[#F0EBE1]">
                    任务优先级分布
                  </h3>
                  <div className="h-56 w-full flex items-center justify-center my-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={priorityPieData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#A48F82" }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 9, fill: "#A48F82" }} axisLine={false} tickLine={false} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#313032",
                            borderRadius: "10px",
                            color: "#FFF",
                            fontSize: "11px",
                          }}
                        />
                        <Bar dataKey="value" radius={[6, 6, 0, 0]} animationDuration={450} animationEasing="ease-out">
                          {priorityPieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-[11px] text-sandrift text-center pt-2 border-t border-[#F0EBE1]">
                    临近截止的紧急任务
                  </p>
                </div>
              </div>

              {/* 3. Study Load Bar Chart */}
              <div className="w-full">
                <StudyLoadChart />
              </div>
              </>)}
            </div>
          )}
        </PageTransition>
        </main>
      </div>

      {/* Global Drawers & Modals */}
      <CourseDetailDrawer />
      <AssignmentDrawer />
      <CommandCenter />
      <GlobalShortcutController />
      <SettingsModal />
      <AddCourseModal />
      <ImportScheduleModal />
      <ConflictResolutionModal />
      <FullTimetableModal />
      <AddAssignmentModal />
      <FilePreviewModal />
      <ConfirmDialog />
      <ToastViewport />
      {/* 移动端底部导航（<768px） */}
      <BottomNav />
    </KiroSessionProvider>
  );
}
