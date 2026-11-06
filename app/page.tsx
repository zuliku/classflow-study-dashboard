"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { TypographyRuntime } from "@/components/runtime/TypographyRuntime";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { OverlayBoundary } from "@/components/ui/OverlayBoundary";
import { Button } from "@/components/ui/Button";
import { PageTransition } from "@/components/ui/PageTransition";
import { MotionGallery } from "@/components/motion/MotionGallery";
import { ModelSelectorDemo } from "@/components/motion/ModelSelectorDemo";
import { MotionFpsProbe } from "@/components/motion/MotionFpsProbe";
import { OverviewWorkspace } from "@/components/dashboard/OverviewWorkspace";
import { useAppStore } from "@/store/useAppStore";
import { useInboxChannelBridge } from "@/hooks/useInboxChannelBridge";
import { cn } from "@/lib/utils";
import { reconcilePersistedFileBlobs } from "@/lib/fileReconcile";
import { drainPendingBlobDeletes } from "@/lib/pendingBlobDeletes";
import { didMainStoreHydrationFail } from "@/store/useAppStore";
import { listAllProjectFileStorageKeys } from "@/lib/ai/projects/files/db";
import { resolveStartupTab } from "@/lib/startup";

/**
 * Workspace 级崩溃兜底：单个工作区渲染失败时只替换该页内容，
 * 侧边栏 / 底部导航 / 全局 Overlay 仍可用；「重试」重置错误边界与工作区子树。
 */
function WorkspaceCrashFallback({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-1 min-h-0 flex-col items-center justify-center gap-3 px-6 py-16 text-center"
    >
      <p className="text-sm font-medium text-charcoal">这个页面暂时无法显示</p>
      <p className="max-w-sm text-xs leading-relaxed text-sandrift">
        此页面出错，其他页面仍可正常使用。可切换页面后回来，或重试。
      </p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        重试
      </Button>
    </div>
  );
}

export default function Home() {
  // Task 13B: Main → Renderer inbox bridge (single subscription at stable root)
  useInboxChannelBridge();
  const [inboxOpen, setInboxOpen] = useState(false);
  /** Workspace 错误隔离的重试世代：递增 → 错误边界与页面子树整体重挂载 */
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
  const inboxUnreadCount = useInboxStore((s) => s.items.filter((it) => it.status === "unread").length);
  // 精确 selector：避免整 store 订阅导致 UI Chrome 等无关 state 变化触发 Home 全量 render
  // （Overview 内容已抽至 OverviewWorkspace，其数据订阅由该组件自持）
  const activeTab = useAppStore((s) => s.activeTab);
  const mainRef = useRef<HTMLElement | null>(null);
  // 工作区切换统一回到顶部：main 是常驻滚动容器，PageTransition 只替换内容；
  // 不重置会让长页面继承上一页 scrollTop（实测 700 → 课程页 196）。
  useLayoutEffect(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [activeTab]);

  // 启动时孤儿 Blob 对账（V1.3A.1 fail-closed）：
  // Course + Project 引用 key 必须全部枚举成功才执行 GC；
  // Project key enumeration 失败 → 完全 skip（不删除任何 Blob，避免误删 Project File）。
  // Hydration 失败（localStorage 损坏 → Store 空态）→ 同样完全 skip：
  // 「看不见引用」≠「没有引用」，此时 GC 会清光用户附件且不可逆。
  // 延迟 30s 执行（BUG-067）：避免与启动窗口内 blob-first 上传（恢复/自动流程）
  // 的快照-删除间隙竞态——新落盘的 blob 被误判为 orphan。
  // 待删队列排水（显式删除意图，不依赖引用枚举，无需 fail-closed；撤销窗口期内
  // 刷新/崩溃的 Blob 在此回收）：引用安全（key 随机不复用），可立即执行。
  useEffect(() => {
    if (didMainStoreHydrationFail()) return;
    void drainPendingBlobDeletes().catch(() => {});
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
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
    }, 30_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
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

  // 启动位置：等 persist 水合完成后再 resolution（此前 hydrate 前读到初始 overview 跳一次，空闪+覆盖）。
  const startupApplied = useRef(false);
  useEffect(() => {
    const apply = () => {
      if (startupApplied.current) return;
      startupApplied.current = true;
      const s = useAppStore.getState();
      const tab = resolveStartupTab(s.preferences.startupView, s.lastWorkspaceTab);
      if (tab !== s.activeTab) s.setActiveTab(tab);
    };
    try {
      const persist = (useAppStore as unknown as { persist?: { hasHydrated?: () => boolean; onFinishHydration?: (cb: () => void) => () => void } }).persist;
      if (persist?.hasHydrated?.()) {
        apply();
        return;
      }
      const unsub = persist?.onFinishHydration?.(() => apply());
      // 兜底：persist 不可用/回调丢失时 1.5s 后强制应用，避免永远停在 overview
      const timer = window.setTimeout(() => apply(), 1500);
      return () => {
        try {
          unsub?.();
        } catch {
          /* ignore */
        }
        window.clearTimeout(timer);
      };
    } catch {
      apply();
    }
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
          ref={mainRef}
          className={cn(
            "flex-1 min-h-0 flex flex-col [scrollbar-gutter:stable]",
            activeTab === "kiro" ? "overflow-hidden" : "overflow-y-auto"
          )}
        >
          <PageTransition
            tab={activeTab}
            className="flex flex-col flex-1 min-h-0"
          >
          <OverlayBoundary
            key={`${activeTab}:${workspaceEpoch}`}
            name={`workspace-${activeTab}`}
            errorMessage="这个页面暂时无法显示，已隔离故障。"
            fallback={
              <WorkspaceCrashFallback
                onRetry={() => setWorkspaceEpoch((v) => v + 1)}
              />
            }
          >
          {activeTab === "overview" && <OverviewWorkspace />}

          {activeTab === "timetable" && <TimelineWorkspace />}

          {activeTab === "assignments" && <AssignmentsWorkspace />}

                    {activeTab === "courses" && <CoursesWorkspace />}

{activeTab === "kiro" && (
            // S4-3 Header 归属说明（by design，非分叉）：Kiro 用 overflow-hidden + 自有滚动，
            // Header 须与 KiroWorkspace 同处一个 flex 列且不进入各 Workspace 自持模式；
            // 其余 6 页 Header 由各 Workspace 自持（sticky 语义见各文件）。
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
          </OverlayBoundary>
        </PageTransition>
        </main>
      </div>

      {/* Global Drawers & Modals（各自隔离：单个面板失败不影响应用其它部分） */}
      <OverlayBoundary name="course-detail-drawer">
        <CourseDetailDrawer />
      </OverlayBoundary>
      <OverlayBoundary name="assignment-drawer">
        <AssignmentDrawer />
      </OverlayBoundary>
      <OverlayBoundary name="calendar-mark-drawer">
        <CalendarMarkDetailDrawer />
      </OverlayBoundary>
      <OverlayBoundary name="command-center">
        <CommandCenter />
      </OverlayBoundary>
      <GlobalShortcutController />
      <OverlayBoundary name="settings-modal">
        <SettingsModal />
      </OverlayBoundary>
      <OverlayBoundary name="inbox-panel">
        <InboxPanel open={inboxOpen} onOpenChange={setInboxOpen} />
      </OverlayBoundary>
      <OverlayBoundary name="add-course-modal">
        <AddCourseModal />
      </OverlayBoundary>
      <OverlayBoundary name="import-schedule-modal">
        <ImportScheduleModal />
      </OverlayBoundary>
      <OverlayBoundary name="conflict-resolution-modal">
        <ConflictResolutionModal />
      </OverlayBoundary>
      <OverlayBoundary name="full-timetable-modal">
        <FullTimetableModal />
      </OverlayBoundary>
      <OverlayBoundary name="add-assignment-modal">
        <AddAssignmentModal />
      </OverlayBoundary>
      <OverlayBoundary name="file-preview-modal">
        <FilePreviewModal />
      </OverlayBoundary>
      <ConfirmDialog />
      <ToastViewport />
      {/* Motion V3 收尾 dev 工具：Gallery（?motion-gallery=1）+ fps 探针（?motion-fps=1）；
          组件内部 development 门禁，production 渲染 null，不影响路由/store/测试 */}
      <MotionGallery />
      <ModelSelectorDemo />
      <MotionFpsProbe />
      {/* Reminder Local Runtime + 站内通知（独立于 KiroSession；不依赖 Kiro Provider） */}
      <ReminderRuntime />
      <LearningHistoryRuntime />
      <ReminderViewport />
      <OverlayBoundary name="reminder-center">
        <ReminderCenter />
      </OverlayBoundary>
      <FocusRuntime />
      <TypographyRuntime />
      {/* 移动端底部导航（<768px） */}
      <OverlayBoundary name="bottom-nav">
        <BottomNav />
      </OverlayBoundary>
    </KiroSessionProvider>
  );
}
