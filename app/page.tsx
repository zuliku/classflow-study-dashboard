"use client";

import React, { useEffect, useRef } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import { Button } from "@/components/ui/Button";
import { BottomNav } from "@/components/layout/BottomNav";
import { TimetableGrid } from "@/components/dashboard/TimetableGrid";
import { TimetableQuickGlance } from "@/components/dashboard/TimetableQuickGlance";
import { UpcomingDDL } from "@/components/dashboard/UpcomingDDL";
import { MiniCalendar } from "@/components/dashboard/MiniCalendar";
import { StudyLoadChart } from "@/components/dashboard/StudyLoadChart";
import { AssignmentTable } from "@/components/dashboard/AssignmentTable";
import { AssignmentsWorkspace } from "@/components/assignment/AssignmentsWorkspace";
import { GroupCollaborationView } from "@/components/group/GroupCollaborationView";
import { KiroWorkspace } from "@/components/kiro/KiroWorkspace";
import { KiroSessionProvider } from "@/components/kiro/KiroSessionProvider";
import { TimelineWorkspace } from "@/components/timeline/TimelineWorkspace";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { LearningAnalyticsView } from "@/components/analytics/LearningAnalyticsView";
import { CourseDetailDrawer } from "@/components/drawers/CourseDetailDrawer";
import { AssignmentDrawer } from "@/components/drawers/AssignmentDrawer";
import { DDLDetailDrawer } from "@/components/drawers/DDLDetailDrawer";
import { CommandCenter } from "@/components/command/CommandCenter";
import { GlobalShortcutController } from "@/components/command/GlobalShortcutController";
import { AddCourseModal } from "@/components/modals/AddCourseModal";
import { ImportScheduleModal } from "@/components/modals/ImportScheduleModal";
import { ConflictResolutionModal } from "@/components/modals/ConflictResolutionModal";
import { FullTimetableModal } from "@/components/modals/FullTimetableModal";
import { AddAssignmentModal } from "@/components/modals/AddAssignmentModal";
import { FilePreviewModal } from "@/components/modals/FilePreviewModal";
import { ToastViewport } from "@/components/ui/ToastViewport";
import { ReminderRuntime } from "@/components/reminders/ReminderRuntime";
import { LearningHistoryRuntime } from "@/components/history/LearningHistoryRuntime";
import { ReminderViewport } from "@/components/reminders/ReminderViewport";
import { ReminderCenter } from "@/components/reminders/ReminderCenter";
import { FocusRuntime } from "@/components/focus/FocusRuntime";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageTransition } from "@/components/ui/PageTransition";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { cardKeyHandler, cn } from "@/lib/utils";
import { openAssignmentEditor } from "@/lib/uiEvents";
import { reconcileOrphanBlobs } from "@/lib/fileStorage";
import { resolveStartupTab } from "@/lib/startup";
import { formatWeekDateRange, getSemesterWeek } from "@/lib/semester";
import { deriveNextCourseSession } from "@/lib/courses/nextSession";
import {
  Plus,
  FileUp,
  ExternalLink,
  CalendarDays,
} from "lucide-react";

/** 周一至周日标签（Course Workspace 下一节展示用） */
const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/** 课程教师/教室：存在才显示，空字段不产生孤立 separator（不显示「待定」类伪值） */
function courseMetaText(course: { teacher: string; classroom: string }): string {
  return [course.teacher, course.classroom].filter(Boolean).join(" · ");
}

export default function Home() {
  const {
    activeTab,
    courses,
    assignments,
    semester,
    currentSemesterWeek,
    schedules,
    setSelectedCourseId,
    setAddCourseModalOpen,
    setImportScheduleModalOpen,
    setFullTimetableModalOpen,
    setSettingsModalOpen,
  } = useAppStore();

  // 当前周 Context（Overview / Timeline / Analytics 共用同一学期模型数据源）
  const currentWeekContext = `第 ${currentSemesterWeek} 周 · ${formatWeekDateRange(
    semester,
    currentSemesterWeek
  )}`;

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

  // Dev 自动注入：开发构建 + 首次启动（无持久化数据）→ 自动载入全模块演示数据，
  // 无需 ?preview= URL 即可查看所有模块。用户主动清空数据后不再注入（marker 保留）。
  // 自动化测试环境（navigator.webdriver / __CLASSFLOW_E2E__）与生产构建完全禁用。
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (navigator.webdriver) return;
    if ((window as unknown as { __CLASSFLOW_E2E__?: boolean }).__CLASSFLOW_E2E__) return;
    try {
      const KEY = "classflow-storage-v2";
      const stored = localStorage.getItem(KEY);
      if (stored) {
        // persist 可能在注入前写入 first-run 空状态；只有「真正有业务数据」才跳过
        try {
          const parsed = JSON.parse(stored) as {
            state?: Record<string, unknown>;
          };
          const s = (parsed.state ?? parsed) as Record<string, unknown>;
          const arr = (k: string) => (Array.isArray(s[k]) ? (s[k] as unknown[]).length : 0);
          const hasData = arr("assignments") > 0 || arr("courses") > 0 || arr("studyBlocks") > 0;
          if (hasData) return;
        } catch {
          return; // 损坏数据不覆盖
        }
      }
      if (localStorage.getItem("classflow-demo-injected") === "1") return;
      import("@/lib/dev/fullDemoData").then(({ buildFullDemoData }) => {
        useAppStore.getState().restoreAppData(buildFullDemoData());
        localStorage.setItem("classflow-demo-injected", "1");
        useToastStore.getState().pushToast({
          message: "已载入完整演示数据（开发模式），可在设置 → 数据中清空",
          type: "info",
        });
      });
    } catch {
      /* 注入失败不影响启动 */
    }
  }, []);

  // Dev Preview 覆盖注入：?preview=task-v2 → confirm 后强制覆盖（仅开发构建）
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("preview") !== "task-v2") return;
    if (sessionStorage.getItem("classflow-task-v2-preview") === "1") {
      params.delete("preview");
      const qs = params.toString();
      window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
      return;
    }
    const doInject = () => {
      import("@/lib/dev/fullDemoData").then(({ buildFullDemoData }) => {
        const store = useAppStore.getState();
        if (
          !confirm(
            "Preview: 覆盖注入全模块演示数据？\n\n" +
              "覆盖范围（验证点）：\n" +
              "· 总览：课程/排课/任务/DDL 逾期/日历\n" +
              "· 任务工作区 V2：六视图 + 无 DDL + 预计耗时 + 多段计划\n" +
              "· 时间表：StudyBlock / 考试 / 活动\n" +
              "· 课程资料：5 门课材料（pdf/ppt/doc/link）\n" +
              "· 小组协作：2 个项目（成员/任务/进度）\n" +
              "· Kiro：全业务数据可查询\n\n" +
              "将覆盖当前全部任务/课程/学习计划数据（个人资料与偏好保留）。"
          )
        ) {
          return;
        }
        store.restoreAppData(buildFullDemoData());
        sessionStorage.setItem("classflow-task-v2-preview", "1");
        params.delete("preview");
        const qs = params.toString();
        window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
        store.setActiveTab("assignments");
      });
    };
    if (document.readyState === "loading") {
      const onReady = () => {
        window.removeEventListener("load", onReady);
        requestIdleCallback(() => doInject());
      };
      window.addEventListener("load", onReady);
    } else {
      requestIdleCallback(() => doInject());
    }
  }, []);

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

  // Statistics derived dynamically 100% from Zustand store
  const totalCredits = courses.reduce((sum, c) => sum + c.credit, 0);

  // Courses Workspace「本周下一节」：基于真实当前教学周（semester + 今天），
  // 不跟随用户在 Timeline 浏览过的任意周；不在教学周时显示「当前不在教学周」
  const realSemesterWeek = getSemesterWeek(new Date(), semester);
  const inTeachingWeek =
    realSemesterWeek >= 1 && realSemesterWeek <= semester.totalWeeks;

  return (
    <KiroSessionProvider>
      {/* Fixed Left Navigation Sidebar */}
      <Sidebar />

      {/* Main Content Workspace */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Dynamic Page Views */}
        {/* main：只负责 flex / overflow / workspace geometry，不承担页面 gutter。
            WorkspaceHeader 是 full-width structural layer；page padding 由各页面 body 自己负责。
            Kiro Tab 保持 full-bleed（p-0），gutter 由 KiroWorkspace 内部提供。 */}
        <main className="flex-1 flex flex-col overflow-y-auto [scrollbar-gutter:stable]">
          <PageTransition
            tab={activeTab}
            className="flex flex-col flex-1 min-h-0"
          >
          {activeTab === "overview" && (
            <div className="flex flex-1 min-h-0 flex-col">
              <WorkspaceHeader title="总览" context={currentWeekContext} sticky />
              {/* First Run：空工作区时显示 Getting Started（非阻塞，三个动作即可开始） */}
              {courses.length === 0 && schedules.length === 0 && assignments.length === 0 ? (
                <div className="flex flex-1 min-h-0 flex-col p-4 pb-24 md:p-6 md:pb-6">
                <div
                  data-testid="getting-started"
                  className="bg-surface border border-line rounded-xl p-6 shadow-subtle space-y-4 text-center"
                >
                  <div>
                    <h2 className="text-lg font-bold text-charcoal">欢迎使用 ClassFlow</h2>
                    <p className="text-xs text-sandrift mt-1">建立你的学习工作区</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2.5">
                    <button
                      onClick={() => setImportScheduleModalOpen(true)}
                      className="ux-press flex items-center gap-1.5 h-9 px-4 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-lg transition-colors shadow-subtle"
                    >
                      <FileUp className="w-3.5 h-3.5" />
                      导入课表
                    </button>
                    <button
                      onClick={() => setAddCourseModalOpen(true)}
                      className="ux-press flex items-center gap-1.5 h-9 px-4 bg-pastel-mint hover:bg-pastel-mint text-charcoal text-xs font-bold rounded-lg transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      添加第一门课程
                    </button>
                    <button
                      onClick={() => setSettingsModalOpen(true)}
                      className="ux-press flex items-center gap-1.5 h-9 px-4 bg-transparent border border-line text-satin-grey text-xs font-bold rounded-lg transition-colors hover:bg-alabaster hover:text-charcoal"
                    >
                      <CalendarDays className="w-3.5 h-3.5 text-sandrift" />
                      设置当前学期
                    </button>
                  </div>
                  <p className="text-[11px] text-sandrift">
                    也可以直接新建任务或浏览课表，随时可以从设置中调整
                  </p>
                </div>
              </div>
              ) : (
                <>
              {/* Overview Hero Section（xl+ 严格占满 Header 以下首屏，padding 计入 section box；
                  < xl 自然流式堆叠，不强制视口高度） */}
              <section className="min-h-0 shrink-0 p-4 pb-24 md:p-6 md:pb-6 xl:h-[calc(100dvh-4.0625rem)] [@media(max-height:720px)]:!pt-2 [@media(max-height:720px)]:!pb-4">
                {/* 三卡 Grid：xl 时 h-full 填满 Hero Section；三卡同顶同底（items-stretch） */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch h-full min-h-0">
                <div className="lg:col-span-2 flex flex-col min-h-0">
                  <TimetableGrid density="compact" fillAvailableHeight headerActions={<TimetableQuickGlance />} />
                </div>
                {/* 右栏：DDL 吸收剩余高度（flex-1），Calendar 固定稳定高度（不随月份/内容变化）
                    右栏总高恒等于左侧课表 → 三卡同顶同底
                    高度受限（≤800px 视口）：Agenda 隐藏 + Calendar shell 缩短，空间让给 DDL */}
                <div className="flex flex-col h-full min-h-0 gap-4">
                  <div className="flex-1 min-h-0">
                    <UpcomingDDL />
                  </div>
                  <div className="h-[380px] lg:h-[390px] xl:h-[410px] 2xl:h-[420px] shrink-0 [@media(max-height:800px)]:h-[315px]">
                    <MiniCalendar />
                  </div>
                </div>
                </div>
              </section>

              {/* Overview Secondary Section：完全位于首屏 fold 以下，滚动后才可见 */}
              <section className="grid gap-4 items-stretch shrink-0 grid-cols-[repeat(auto-fit,minmax(520px,1fr))] px-4 pb-24 md:px-6 md:pb-6">
                <div className="md:min-h-[460px]" data-testid="overview-load-wrap">
                  <StudyLoadChart />
                </div>
                <div className="md:min-h-[460px] min-w-0" data-testid="overview-tasks-wrap">
                  <AssignmentTable mode="compact" />
                </div>
              </section>
                </>
              )}
            </div>
          )}

          {activeTab === "timetable" && <TimelineWorkspace />}

          {activeTab === "assignments" && <AssignmentsWorkspace />}

          {activeTab === "courses" && (
            <div className="flex flex-1 min-h-0 flex-col">
              <WorkspaceHeader
                title="课程资料"
                context={`${courses.length} 门课程 · ${totalCredits} 学分`}
                primaryAction={
                  <Button variant="primary" size="sm" onClick={() => setAddCourseModalOpen(true)}>
                    <Plus className="h-3.5 w-3.5" />
                    <span>添加课程</span>
                  </Button>
                }
                sticky
              />
              <div className="flex flex-1 min-h-0 flex-col space-y-4 p-4 pb-24 md:p-6 md:pb-6">
              {courses.length === 0 ? (
                <div className="bg-surface border border-line rounded-xl p-10 shadow-subtle flex flex-col items-center justify-center gap-2.5 text-center">
                  <p className="text-xs font-bold text-charcoal">暂无课程</p>
                  <p className="text-[11px] text-sandrift">添加第一门课程或导入课表</p>
                  <button
                    onClick={() => setAddCourseModalOpen(true)}
                    className="ux-press mt-1 h-8 px-3 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-lg transition-colors shadow-subtle"
                  >
                    <Plus className="w-3.5 h-3.5 inline-block mr-1" />
                    添加课程
                  </button>
                </div>
              ) : (
                <div className="bg-surface border border-line rounded-xl shadow-subtle flex flex-col min-h-0">
                  {/* Desktop 表头（< lg 隐藏；mobile 用 stacked row） */}
                  <div className="hidden lg:grid grid-cols-12 gap-3 px-4 pt-3 pb-2 border-b border-line-soft text-[11px] font-bold text-sandrift shrink-0">
                    <span className="col-span-5">课程</span>
                    <span className="col-span-3">本周下一节</span>
                    <span className="col-span-2 text-right">未完成任务</span>
                    <span className="col-span-2 text-right">资料</span>
                  </div>
                  <div className="divide-y divide-line-soft">
                    {courses.map((course) => {
                      // 「本周下一节」基于真实当前教学周（semester + 今天），
                      // 不跟随用户在 Timeline 浏览过的任意周
                      const next = inTeachingWeek
                        ? deriveNextCourseSession(
                            course.id,
                            schedules,
                            realSemesterWeek,
                            semester.totalWeeks
                          )
                        : null;
                      const nextCellText = !inTeachingWeek
                        ? "当前不在教学周"
                        : next
                          ? null
                          : "本周无后续课程";
                      const incompleteCount = assignments.filter(
                        (a) => a.courseId === course.id && a.status !== "completed"
                      ).length;
                      return (
                        <div
                          key={course.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedCourseId(course.id)}
                          onKeyDown={cardKeyHandler(() => setSelectedCourseId(course.id))}
                          className="group cursor-pointer"
                        >
                          {/* Desktop Row：颜色仅作身份（dot），主背景 neutral；hover 无 elevation */}
                          <div className="hidden lg:grid grid-cols-12 gap-3 items-center relative px-4 py-3 hover:bg-alabaster/50 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]">
                            <div className="col-span-5 flex items-center gap-2.5 min-w-0">
                              <span
                                aria-hidden="true"
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: course.borderHex }}
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 min-w-0">
                                  <h3 className="text-[13px] font-bold text-charcoal truncate group-hover:text-black transition-colors duration-[var(--motion-fast)]">
                                    {course.name}
                                  </h3>
                                  {course.code ? (
                                    <span className="text-[11px] font-mono text-sandrift shrink-0">
                                      {course.code}
                                    </span>
                                  ) : null}
                                </div>
                                <p className="text-[11px] text-satin-grey truncate mt-0.5">
                                  {courseMetaText(course)}
                                </p>
                              </div>
                            </div>
                            <div className="col-span-3 min-w-0">
                              {next ? (
                                <>
                                  <p className="text-xs font-semibold text-charcoal">
                                    {WEEKDAY_LABELS[next.dayOfWeek - 1]} {next.startTime}
                                  </p>
                                  {next.location || course.classroom ? (
                                    <p className="text-[11px] text-satin-grey truncate mt-0.5">
                                      {next.location || course.classroom}
                                    </p>
                                  ) : null}
                                </>
                              ) : (
                                <p className="text-[11px] text-sandrift">{nextCellText}</p>
                              )}
                            </div>
                            <div className="col-span-2 text-right">
                              <span
                                className={cn(
                                  "text-xs tabular-nums",
                                  incompleteCount > 0
                                    ? "font-bold text-charcoal"
                                    : "font-semibold text-sandrift"
                                )}
                              >
                                {incompleteCount}
                              </span>
                            </div>
                            <div className="col-span-2 text-right pr-14">
                              <span className="text-xs font-semibold text-satin-grey tabular-nums">
                                {course.materials.length}
                              </span>
                            </div>
                            {/* Desktop hover：仅「+ 任务」一个动作；其余进 Drawer */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openAssignmentEditor({ courseId: course.id });
                              }}
                              className="absolute right-4 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-lg text-[10px] font-bold text-charcoal bg-white/90 border border-line-strong opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-alabaster transition-[opacity,background-color,border-color]"
                              title="添加任务"
                            >
                              + 任务
                            </button>
                          </div>
                          {/* Mobile Stacked Row（紧凑，非大彩卡） */}
                          <div className="lg:hidden px-4 py-3 hover:bg-alabaster/50 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]">
                            <div className="flex items-start gap-2.5">
                              <span
                                aria-hidden="true"
                                className="w-2 h-2 rounded-full shrink-0 mt-1.5"
                                style={{ backgroundColor: course.borderHex }}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 min-w-0">
                                  <h3 className="text-[13px] font-bold text-charcoal truncate">
                                    {course.name}
                                  </h3>
                                  {course.code ? (
                                    <span className="text-[11px] font-mono text-sandrift shrink-0">
                                      {course.code}
                                    </span>
                                  ) : null}
                                </div>
                                <p className="text-[11px] text-satin-grey truncate mt-0.5">
                                  {courseMetaText(course)}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 pl-[18px] mt-1.5 text-[11px]">
                              <span
                                className={
                                  next ? "font-semibold text-charcoal" : "text-sandrift"
                                }
                              >
                                {next
                                  ? `下一节 ${WEEKDAY_LABELS[next.dayOfWeek - 1]} ${next.startTime}`
                                  : nextCellText}
                              </span>
                              <span className="text-sandrift">·</span>
                              <span className="text-sandrift">
                                {incompleteCount} 个任务 · {course.materials.length} 份资料
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              </div>
            </div>
          )}

          {activeTab === "kiro" && (
            <div className="flex flex-1 min-h-0 flex-col">
              <WorkspaceHeader title="Kiro" />
              <KiroWorkspace />
            </div>
          )}

          {activeTab === "group" && <GroupCollaborationView />}

          {activeTab === "analytics" && <LearningAnalyticsView />}
        </PageTransition>
        </main>
      </div>

      {/* Global Drawers & Modals */}
      <CourseDetailDrawer />
      <AssignmentDrawer />
      <DDLDetailDrawer />
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
      {/* Reminder Local Runtime + 站内通知（独立于 KiroSession；不依赖 Kiro Provider） */}
      <ReminderRuntime />
<LearningHistoryRuntime />
      <ReminderViewport />
      <ReminderCenter />
      <FocusRuntime />
      {/* 移动端底部导航（<768px） */}
      <BottomNav />
    </KiroSessionProvider>
  );
}
