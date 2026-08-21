"use client";

import React, { useEffect, useRef, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import { WorkspaceInboxButton } from "@/components/layout/WorkspaceInboxButton";
import { InboxPanel } from "@/components/inbox/InboxPanel";
import { useInboxStore } from "@/store/useInboxStore";
import { Button } from "@/components/ui/Button";
import { BottomNav } from "@/components/layout/BottomNav";
import { TimetableGrid } from "@/components/dashboard/TimetableGrid";
import { buildOverviewStudyBlockLayers, buildOverviewCourseTaskMarkers } from "@/components/dashboard/overviewStudyBlockLayers";
import { TimetableQuickGlance } from "@/components/dashboard/TimetableQuickGlance";
import { UpcomingDDL } from "@/components/dashboard/UpcomingDDL";
import { MiniCalendar } from "@/components/dashboard/MiniCalendar";
import { StudyLoadChart } from "@/components/dashboard/StudyLoadChart";
import { AssignmentTable } from "@/components/dashboard/AssignmentTable";
import { AssignmentsWorkspace } from "@/components/assignment/AssignmentsWorkspace";
import { CoursesWorkspace } from "@/components/course/CoursesWorkspace";
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
import { useInboxChannelBridge } from "@/hooks/useInboxChannelBridge";
import { cardKeyHandler, cn } from "@/lib/utils";
import { openAssignmentEditor } from "@/lib/uiEvents";
import { reconcilePersistedFileBlobs } from "@/lib/fileReconcile";
import { listAllProjectFileStorageKeys } from "@/lib/ai/projects/files/db";
import { resolveStartupTab } from "@/lib/startup";
import { formatWeekDateRange } from "@/lib/semester";
import {
  Plus,
  FileUp,
  ExternalLink,
  CalendarDays,
} from "lucide-react";

export default function Home() {
  // Task 13B: Main → Renderer inbox bridge (single subscription at stable root)
  useInboxChannelBridge();
  const [inboxOpen, setInboxOpen] = useState(false);
  const inboxUnreadCount = useInboxStore((s) => s.items.filter((it) => it.status === "unread").length);
  // 精确 selector：避免整 store 订阅导致 UI Chrome 等无关 state 变化触发 Home 全量 render
  const activeTab = useAppStore((s) => s.activeTab);
  const courses = useAppStore((s) => s.courses);
  const assignments = useAppStore((s) => s.assignments);
  const semester = useAppStore((s) => s.semester);
  const currentSemesterWeek = useAppStore((s) => s.currentSemesterWeek);
  const schedules = useAppStore((s) => s.schedules);
  const studyBlocks = useAppStore((s) => s.studyBlocks);
  const setAddCourseModalOpen = useAppStore((s) => s.setAddCourseModalOpen);
  const setImportScheduleModalOpen = useAppStore((s) => s.setImportScheduleModalOpen);
  const setFullTimetableModalOpen = useAppStore((s) => s.setFullTimetableModalOpen);
  const setSettingsModalOpen = useAppStore((s) => s.setSettingsModalOpen);

  // 当前周 Context（Overview / Timeline / Analytics 共用同一学期模型数据源）
  const currentWeekContext = `第 ${currentSemesterWeek} 周 · ${formatWeekDateRange(
    semester,
    currentSemesterWeek
  )}`;

  // 启动时孤儿 Blob 对账（V1.3A.1 fail-closed）：
  // Course + Project 引用 key 必须全部枚举成功才执行 GC；
  // Project key enumeration 失败 → 完全 skip（不删除任何 Blob，避免误删 Project File）。
  useEffect(() => {
    const courseKeys = new Set<string>();
    useAppStore.getState().courses.forEach((c) =>
      c.materials.forEach((m) => {
        if (m.storageKey) courseKeys.add(m.storageKey);
      })
    );
    void reconcilePersistedFileBlobs({
      courseStorageKeys: courseKeys,
      listProjectStorageKeys: listAllProjectFileStorageKeys,
    }).catch(() => {
      // reconcilePersistedFileBlobs 自身已 fail-closed；此处仅兜底未预期异常
    });
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
              "· 时间表：StudyBlock / 考试 / 活动 / 排课例外\n" +
              "· 课程资料：10 门课材料（pdf/ppt/doc/link）\n" +
              "· 学习洞察：3 周专注历史（趋势/节奏/课程投入）\n" +
              "· 小组协作：3 个项目（成员/任务/进度）\n" +
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

  return (
    <KiroSessionProvider>
      {/* Fixed Left Navigation Sidebar */}
      <Sidebar />

      {/* Main Content Workspace */}
      <div className="flex-1 min-h-0 flex flex-col min-w-0">
        {/* Dynamic Page Views */}
        {/* main：只负责 flex / overflow / workspace geometry，不承担页面 gutter。
            WorkspaceHeader 是 full-width structural layer；page padding 由各页面 body 自己负责。
            Kiro Tab 保持 full-bleed（p-0），gutter 由 KiroWorkspace 内部提供。
            Kiro 拥有自己的滚动（KiroConversation overflow-y-auto），main 不再成为第二个纵向滚动容器；
            其它页面（Overview/Assignments 等）保持 outer main scrolling。 */}
        <main
          className={cn(
            "flex-1 min-h-0 flex flex-col [scrollbar-gutter:stable]",
            activeTab === "kiro" ? "overflow-hidden" : "overflow-y-auto"
          )}
        >
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
              {/* Overview Hero Section — viewport bounded with explicit fold gap */}
              <section className="box-border flex flex-col shrink-0 min-h-0 p-4 pb-24 md:p-5 md:pb-5 xl:h-[calc(100dvh-4rem-24px)] xl:mb-6 xl:pb-0 [@media(max-height:720px)]:!h-[calc(100dvh-4rem-16px)] [@media(max-height:720px)]:!mb-4 [@media(max-height:720px)]:!pt-2 [@media(max-height:720px)]:!pb-0">
                {/* 三卡 Grid：flex-1 eats remaining hero space, three cards same top/bottom */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch flex-1 min-h-0">
                <div className="lg:col-span-2 flex flex-col min-h-0">
                  <TimetableGrid
                    density="compact"
                    fillAvailableHeight
                    headerActions={<TimetableQuickGlance />}
                    extraLayers={buildOverviewStudyBlockLayers({
                      studyBlocks,
                      semester,
                      currentSemesterWeek,
                      schedules,
                    })}
                    courseIndicators={buildOverviewCourseTaskMarkers({
                      studyBlocks,
                      semester,
                      currentSemesterWeek,
                    })}
                  />
                </div>
                {/* 右栏：DDL 吸收剩余高度（flex-1），Calendar 固定稳定高度（不随月份/内容变化）
                    右栏总高恒等于左侧课表 → 三卡同顶同底
                    高度受限（≤800px 视口）：Agenda 隐藏 + Calendar shell 缩短，空间让给 DDL */}
                <div className="flex flex-col h-full min-h-0 gap-4">
                  <div className="flex-1 min-h-0">
                    <UpcomingDDL />
                  </div>
                  <div className="h-[370px] lg:h-[380px] xl:h-[400px] 2xl:h-[410px] shrink-0 [@media(max-height:800px)]:h-[305px]">
                    <MiniCalendar />
                  </div>
                </div>
                </div>
              </section>

              {/* Overview Secondary Section：完全位于首屏 fold 以下，滚动后才可见 */}
              <section className="grid gap-4 items-stretch shrink-0 grid-cols-[repeat(auto-fit,minmax(520px,1fr))] px-4 pb-24 md:px-5 md:pb-5">
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

                    {activeTab === "courses" && <CoursesWorkspace />}

{activeTab === "kiro" && (
            <div className="flex flex-1 min-h-0 flex-col">
              <WorkspaceHeader
                title="Kiro"
                actions={
                  <WorkspaceInboxButton unreadCount={inboxUnreadCount} onClick={() => setInboxOpen(true)} />
                }
              />
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
      <InboxPanel open={inboxOpen} onOpenChange={setInboxOpen} />
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
