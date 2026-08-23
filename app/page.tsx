"use client";

import React, { useEffect, useRef, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import { WorkspaceInboxButton } from "@/components/layout/WorkspaceInboxButton";
import { InboxPanel } from "@/components/inbox/InboxPanel";
import { useInboxStore } from "@/store/useInboxStore";
import { BottomNav } from "@/components/layout/BottomNav";
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
import { CalendarMarkDetailDrawer } from "@/components/drawers/CalendarMarkDetailDrawer";
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
import { OverviewWorkspace } from "@/components/dashboard/OverviewWorkspace";
import { useAppStore } from "@/store/useAppStore";
import { useInboxChannelBridge } from "@/hooks/useInboxChannelBridge";
import { cn } from "@/lib/utils";
import { reconcilePersistedFileBlobs } from "@/lib/fileReconcile";
import { listAllProjectFileStorageKeys } from "@/lib/ai/projects/files/db";
import { resolveStartupTab } from "@/lib/startup";

export default function Home() {
  // Task 13B: Main → Renderer inbox bridge (single subscription at stable root)
  useInboxChannelBridge();
  const [inboxOpen, setInboxOpen] = useState(false);
  const inboxUnreadCount = useInboxStore((s) => s.items.filter((it) => it.status === "unread").length);
  // 精确 selector：避免整 store 订阅导致 UI Chrome 等无关 state 变化触发 Home 全量 render
  // （Overview 内容已抽至 OverviewWorkspace，其数据订阅由该组件自持）
  const activeTab = useAppStore((s) => s.activeTab);

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

  // Dev Preview 覆盖注入：?preview=task-v2 → confirm 后强制覆盖（仅开发构建）
  // 显式开发行为，需用户确认才会覆盖数据
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
          {activeTab === "overview" && <OverviewWorkspace />}

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
      <CalendarMarkDetailDrawer />
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
