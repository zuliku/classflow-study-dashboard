// @vitest-environment jsdom
/**
 * 全软件硬切深筛回归（12 项）：
 * - 行为级：TimelineActiveFocusChip 进退场 presence
 * - 源码契约：其余 11 处分支切换/展开统一走 Contract 动画工具
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup, waitForElementToBeRemoved } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";
import { TimelineActiveFocusChip } from "@/components/timeline/TimelineActiveFocusChip";
import { useAppStore } from "@/store/useAppStore";
import type { FocusSession } from "@/types";

if (typeof window !== "undefined" && !window.matchMedia) {
  (window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

const SESSION: FocusSession = {
  id: "f1",
  plannedMinutes: 25,
  startedAt: Date.now() - 60_000,
  activeStartedAt: Date.now() - 60_000,
  accumulatedActiveMs: 0,
  status: "running",
  assignmentTitleSnapshot: "数学作业",
  source: "manual",
  createdAt: Date.now() - 60_000,
  updatedAt: Date.now() - 60_000,
};

beforeEach(() => {
  useAppStore.setState({ focusSessions: [] });
});

afterEach(() => {
  cleanup();
  useAppStore.setState({ focusSessions: [] });
});

describe("TimelineActiveFocusChip 进退场 presence", () => {
  it("出现淡入 + 消失延迟卸载（非硬切硬卸）", async () => {
    act(() => {
      useAppStore.setState({ focusSessions: [SESSION] });
    });
    render(<TimelineActiveFocusChip />);
    // 初挂载先隐藏（进入过渡起点），双 rAF 后 visible
    await act(async () => {
      await new Promise((r) => setTimeout(r, 64));
    });
    const chip = await screen.findByTestId("timeline-active-focus-chip");
    expect(chip.className).toMatch(/opacity-100/);

    act(() => {
      useAppStore.setState({ focusSessions: [] });
    });
    // 退出窗口内仍在 DOM（淡出中），而非同步消失
    const exiting = screen.getByTestId("timeline-active-focus-chip");
    expect(exiting.className).toMatch(/opacity-0/);
    // 退出动画播完后卸载（exit 110ms，容差等待）
    await waitForElementToBeRemoved(() => screen.queryByTestId("timeline-active-focus-chip"), {
      timeout: 2000,
    });
  });
});

describe("硬切深筛源码契约", () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

  it("Group 空态↔列表：key + settle", () => {
    const src = read("components/group/GroupCollaborationView.tsx");
    expect(src).toMatch(/key="empty"[\s\S]*?ux-settle/);
    expect(src).toMatch(/key="list"[\s\S]*?ux-settle/);
  });

  it("Inbox 空态：同舞台 key + page 淡入", () => {
    const src = read("components/inbox/InboxPanel.tsx");
    expect(src).toMatch(/key=\{filter\}[\s\S]*?ux-page/);
  });

  it("UpcomingDDL 空态：淡入", () => {
    const src = read("components/dashboard/UpcomingDDL.tsx");
    expect(src).toContain("ux-fade flex-1 flex flex-col items-center justify-center");
  });

  it("StudyOutlook horizon 切换：任务区 key + settle，缺口条 key + fade", () => {
    const src = read("components/analytics/StudyOutlookCard.tsx");
    expect(src).toMatch(/key=\{`list-\$\{horizonDays\}`\}[\s\S]*?ux-settle/);
    expect(src).toMatch(/key=\{`empty-\$\{horizonDays\}`\}[\s\S]*?ux-settle/);
    expect(src).toMatch(/key=\{`shortfall-\$\{horizonDays\}`\}[\s\S]*?ux-fade/);
  });

  it("UnscheduledShelf：presence 淡出 + 展开走实测高度 FLIP（无 key 重挂）", () => {
    const src = read("components/timeline/TimelineUnscheduledShelf.tsx");
    expect(src).toContain("usePresence(assignments.length > 0, MOTION_EXIT_MS.panel)");
    // auto 高度不可插值 + key 重挂会杀死过渡：实测 offsetHeight 后 WAAPI 补间
    expect(src).toContain("toggleExpanded");
    expect(src).toContain(".animate(");
    expect(src).not.toMatch(/key=\{expanded/);
  });

  it("MiniCalendar Agenda：DisclosureRegion 折叠（非整块卸载）", () => {
    const src = read("components/dashboard/MiniCalendar.tsx");
    expect(src).toMatch(/<DisclosureRegion open=\{agendaVisible\}/);
    expect(src).not.toMatch(/\{agendaVisible && \(\s*<div\s*\n?\s*ref=\{agendaRef\}/);
  });

  it("AssignmentDrawer：follow-up 进入 + focus 三态淡入 + picker Disclosure", () => {
    const src = read("components/drawers/AssignmentDrawer.tsx");
    expect(src).toMatch(/data-testid="focus-follow-up"[\s\S]*?ux-fade/);
    expect(src).toMatch(/key=\{focusView\.active \? focusView\.relation/);
    expect(src).toMatch(/<DisclosureRegion open=\{materialPickerOpen\}>/);
  });

  it("FocusControl：popover 对称进退 + Idle/Running keyed 淡入", () => {
    const src = read("components/focus/FocusControl.tsx");
    expect(src).toContain("usePresence(open, MOTION_EXIT_MS.fast)");
    expect(src).toMatch(/key="idle"[\s\S]*?ux-fade/);
    expect(src).toMatch(/key="active"[\s\S]*?ux-fade/);
  });

  it("ViewBar：archive/views 淡入 + 风险钮挂载淡入", () => {
    const src = read("components/assignment/AssignmentWorkspaceViewBar.tsx");
    expect(src).toContain("ux-fade flex items-center gap-1 bg-alabaster");
    expect(src).toContain("ux-fade flex items-stretch gap-1.5");
    expect(src).toContain("ux-fade flex items-center gap-1 px-2.5 py-1 rounded-xl border");
  });

  it("ReminderSection picker：DisclosureRegion + pickerMode keyed 淡入", () => {
    const src = read("components/reminders/AssignmentReminderSection.tsx");
    expect(src).toMatch(/<DisclosureRegion open=\{pickerOpen\}>/);
    expect(src).toMatch(/key=\{pickerMode\}[\s\S]*?ux-fade/);
  });

  it("卡片交互：course / inbox hover elevation；行与按钮有 press/transition 反馈", () => {
    const course = read("components/course/CourseLibraryCard.tsx");
    expect(course).toContain("hover:shadow-subtle");
    expect(course).toContain("transition-[border-color,box-shadow]");
    expect(course).toMatch(/group\/task[\s\S]*?transition-colors/);
    expect(course).toMatch(/group\/mat[\s\S]*?transition-colors/);

    const inbox = read("components/inbox/InboxPanel.tsx");
    expect(inbox).toContain("hover:border-line-strong hover:shadow-subtle");
    expect(inbox).toContain("ux-press h-7 px-3 bg-white border border-line");

    const sidebar = read("components/layout/Sidebar.tsx");
    expect(sidebar).toContain("sidebar-logo relative h-10 w-full overflow-hidden cursor-pointer");
    expect(sidebar).toContain("transition-opacity duration-[var(--motion-fast)]");
    expect(sidebar).toContain("active:opacity-80");

    const settingsNav = read("components/settings/SettingsNav.tsx");
    expect(settingsNav).toContain("transition-[background-color,color,box-shadow]");

    const extensions = read("components/settings/ExtensionsSettings.tsx");
    expect(extensions).toContain("rounded-xl p-4 flex flex-col gap-3 animate-enter");
    expect(extensions).toContain("mcp-card-${conn.config.id}");
    expect(extensions).toContain("hover:border-line-strong hover:shadow-subtle animate-enter");

    const memory = read("components/kiro/KiroMemoryManager.tsx");
    expect(memory).toContain("rounded-xl bg-[#F7F5F5] border border-line p-3 animate-enter");
  });

  it("模型选择器：进场只过渡 opacity，不逐帧动画 blur/scale（防文字抖动）", () => {
    const src = read("components/kiro/composer/KiroModelSelector.tsx");
    expect(src).not.toContain("backdropFilter:");
    expect(src).not.toContain("WebkitBackdropFilter:");
    expect(src).not.toMatch(/scale:\s*0\.9/);
    expect(src).not.toContain("active:scale-[0.99]");
    expect(src).toContain("initial={reducedMotion ? false : { opacity: 0 }}");
  });

  it("Settings 搜索态：静态 key + 进入淡入（不随 query 逐字重播）", () => {
    const src = read("components/settings/SettingsView.tsx");
    expect(src).toMatch(/key="search-results"[\s\S]*?ux-fade/);
  });

  it("Composer 菜单/拖拽/附件架：presence 对称进退（非条件硬切）", () => {
    const src = read("components/kiro/KiroComposer.tsx");
    expect(src).toContain("usePresence(slashOpen, MOTION_EXIT_MS.fast)");
    expect(src).toContain("usePresence(mentionOpen, MOTION_EXIT_MS.fast)");
    expect(src).toContain("usePresence(dragOver, MOTION_EXIT_MS.fast)");
    expect(src).not.toMatch(/\{slashOpen && \(\s*<div/);
    expect(src).not.toMatch(/\{mentionOpen && \(\s*<div/);
    expect(src).not.toMatch(/\{dragOver && \(\s*<div/);
    expect(src).not.toMatch(/\{attachments\.length > 0 && \(\s*<div/);
  });

  // ＋菜单常挂载 + 建议条 presence/折叠（motionContract 同锁，此处不重复）：见 motionContract.test.tsx P2/P3 段

  it("深度 Batch1：Kiro 消息/会话/导航/历史/检查器对称进退", () => {
    const message = read("components/kiro/KiroMessage.tsx");
    expect(message).toContain("showCursor={showStreamingCursor === true}");
    const run = read("components/kiro/run/KiroAgentRunResult.tsx");
    expect(run).toContain("animate-enter");
    const plan = read("components/kiro/run/KiroExecutionPlanCard.tsx");
    expect(plan).toContain("animate-enter");
    const surface = read("components/kiro/computer/session/KiroComputerSessionSurface.tsx");
    expect(surface).toContain("animate-enter");
    const thread = read("components/kiro/KiroThreadRow.tsx");
    expect(thread).toContain("KiroMenuPanel");
    const history = read("components/kiro/KiroHistoryPanel.tsx");
    expect(history).toContain("useExitPresenceList");
    const home = read("components/kiro/navigation/KiroNavigatorHome.tsx");
    expect(home).toContain("DisclosureRegion open={showAllThreads}");
    const outputs = read("components/kiro/inspector/KiroInspectorOutputs.tsx");
    expect(outputs).toContain("DisclosureRegion open={showRecent}");
    const terminal = read("components/kiro/computer/KiroTerminalBlock.tsx");
    expect(terminal).toContain("transition-[max-height]");
    const mini = read("components/kiro/mini/MiniChatApp.tsx");
    const miniComposer = read("components/kiro/mini/MiniChatComposer.tsx");
    expect(mini).toContain("noticePresence.mounted");
    expect(mini).toContain("busyPresence.mounted");
    expect(miniComposer).toContain("fileTrayPresence.mounted");
    expect(miniComposer).toContain("ExitCollapse");
    expect(miniComposer).toContain("animate-enter");
    // Batch4 唯一增量（其余与 Batch1/motionContract 重复，已并入此处，Batch4 整 it 已删）
    const artifacts = read("components/kiro/computer/KiroRecentArtifactsPopover.tsx");
    expect(artifacts).toContain("panelPresence.mounted");
    const lightbox = read("components/kiro/KiroMarkdown.tsx");
    expect(lightbox).toContain("lightboxPresence.mounted");
    const importDialog = read("components/kiro/TimetableImportPreviewDialog.tsx");
    expect(importDialog).toContain("dialogPresence.mounted");
  });

  it("深度 Batch2：工作区横幅/反馈/提醒行/抽屉对称进退", () => {
    const grid = read("components/dashboard/TimetableGrid.tsx");
    expect(grid).toContain("DisclosureRegion open={conflicts.length > 0}");
    expect(grid).not.toContain("transition-[top,height,transform,box-shadow]");
    const mini = read("components/dashboard/MiniCalendar.tsx");
    expect(mini).toContain("DisclosureRegion open={feedback != null}");
    expect(mini).toContain("timeEditPresence.mounted");
    const section = read("components/reminders/AssignmentReminderSection.tsx");
    expect(section).toContain("useExitPresenceList");
    expect(section).toContain("DisclosureRegion open={scheduled.length > 0}");
    const drawer = read("components/drawers/CalendarMarkDetailDrawer.tsx");
    expect(drawer).toContain("useExitPresenceList");
    const table = read("components/dashboard/AssignmentTable.tsx");
    expect(table).toContain("bulkBarPresence.mounted");
    expect(table).toContain("bulkDdlPresence.mounted");
    const adrawer = read("components/drawers/AssignmentDrawer.tsx");
    expect(adrawer).toContain("DisclosureRegion open={followUpSession != null}");
    expect(adrawer).not.toMatch(/\{\s*materialPickerOpen && \(\s*<DisclosureRegion/);
    const entity = read("components/history/EntityActivitySection.tsx");
    expect(entity).toContain('key={loading ? "loading"');
    const modal = read("components/modals/ImportScheduleModal.tsx");
    expect(modal).toContain('key="step-1"');
    expect(modal).toContain('key="step-2"');
  });

  it("深度 Batch3：空态淡入/计时收敛/退出加速", () => {
    const courses = read("components/course/CoursesWorkspace.tsx");
    expect(courses).toContain("ux-fade");
    const group = read("components/group/GroupCollaborationView.tsx");
    expect(group).toContain("ux-fade");
    const center = read("components/reminders/ReminderCenter.tsx");
    expect(center).toContain("usePresence(editor !== null, MOTION_EXIT_MS.base)");
    const viewport = read("components/reminders/ReminderViewport.tsx");
    expect(viewport).toContain("MOTION_EXIT_MS.fast");
    const lane = read("components/timeline/TimelineKeyLane.tsx");
    expect(lane).toContain("transition-[height]");
    const outlook = read("components/analytics/StudyOutlookCard.tsx");
    expect(outlook).toContain("ux-fade");
    const cdrawer = read("components/drawers/CourseDetailDrawer.tsx");
    expect(cdrawer).toContain('key="edit"');
    const select = read("components/ui/Select.tsx");
    expect(select).toContain("!ease-[var(--ease-exit)]");
    const agent = read("components/settings/KiroAgentSettings.tsx");
    expect(agent).toContain("DisclosureRegion open={desktopActionAvailable && desktopActionEnabled}");
    const audit = read("components/settings/KiroComputerAuditPanel.tsx");
    expect(audit).toContain('key={!loaded ? "loading"');
    const toast = read("components/ui/ToastViewport.tsx");
    expect(toast).toContain("useEffectiveReducedMotion");
    const sidebar = read("components/layout/Sidebar.tsx");
    expect(sidebar).toContain('key={String(effectiveCollapsed)}');
  });

  // 深度 Batch4 已并入 Batch1（仅 3 行增量，见上；其余与 Batch1/motionContract 重复，不双留）

  it("深度 Batch5：工作区横幅/反馈/提醒/表格/抽屉/历史/课表/弹层", () => {
    const grid = read("components/dashboard/TimetableGrid.tsx");
    expect(grid).toContain("DisclosureRegion open={conflicts.length > 0}");
    expect(grid).not.toContain("transition-[top,height,transform,box-shadow]");
    const mini = read("components/dashboard/MiniCalendar.tsx");
    expect(mini).toContain("timeEditPresence.mounted");
    const section = read("components/reminders/AssignmentReminderSection.tsx");
    expect(section).toContain("DisclosureRegion open={scheduled.length > 0}");
    const table = read("components/dashboard/AssignmentTable.tsx");
    expect(table).toContain("bulkBarPresence.mounted");
    const entity = read("components/history/EntityActivitySection.tsx");
    expect(entity).toContain('key={loading ? "loading"');
    const modal = read("components/modals/ImportScheduleModal.tsx");
    expect(modal).toContain('key="step-1"');
    const lane = read("components/timeline/TimelineKeyLane.tsx");
    expect(lane).toContain("transition-[height]");
    const outlook = read("components/analytics/StudyOutlookCard.tsx");
    expect(outlook).toContain("outlook-capacity-line");
    const command = read("components/command/CommandCenter.tsx");
    expect(command).toContain("ux-scrim");
    expect(command).not.toContain("visible && \"backdrop-blur-sm\"");
    const glance = read("components/dashboard/TimetableQuickGlance.tsx");
    expect(glance).toContain("transition-[opacity,transform,visibility]");
    const agent = read("components/settings/KiroAgentSettings.tsx");
    expect(agent).toContain("DisclosureRegion open={desktopActionAvailable && desktopActionEnabled}");
    const toast = read("components/ui/ToastViewport.tsx");
    expect(toast).toContain("useEffectiveReducedMotion");
    const sidebar = read("components/layout/Sidebar.tsx");
    expect(sidebar).toContain("ux-fade");
  });

  it("退出保留的数据守卫：stale 快照 + 内层再守卫（JSX children eager 求值，wrapper 返回 null 拦不住空解引用）", () => {
    const grid = read("components/dashboard/TimetableGrid.tsx");
    expect(grid).toContain("lastConflictsRef");
    expect(grid).toContain("shownConflicts.length > 0 && shownFirstConflict");
    const suggestions = read("components/kiro/KiroContextSuggestions.tsx");
    expect(suggestions).toContain("lastKindRef");
    expect(suggestions).toContain("shownKind");
  });

  it("深度 Batch6：退出保留 stale 快照（数据先清空、UI 后卸载不崩）", () => {
    const peek = read("components/assignment/AssignmentPeekPanel.tsx");
    expect(peek).toContain("renderedAssignment");
    const coverage = read("components/analytics/AnalyticsCoverageNotice.tsx");
    // V3.1：coverage 改为从 facts 同步派生 summary（不再是 shownSummary 快照）；
    // 保留“summary 缺失时安全返回 null”的退出契约。
    expect(coverage).toContain("buildCoverageSummary(facts)");
    expect(coverage).toContain("if (!summary) return null");
    const grid = read("components/dashboard/TimetableGrid.tsx");
    expect(grid).toContain("shownFirstConflict");
  });

  it("深度 Batch7：表单/抽屉/弹窗行级进退", () => {
    const detail = read("components/assignment/detail/AssignmentDetailExecution.tsx");
    expect(detail).toContain("DisclosureRegion");
    const schedule = read("components/course/detail/CourseScheduleSection.tsx");
    expect(schedule).toContain("DisclosureRegion open={isCustom}");
    const addModal = read("components/modals/AddAssignmentModal.tsx");
    expect(addModal).toContain("DisclosureRegion open={ddlEnabled}");
    const menu = read("components/assignment/AssignmentContextMenu.tsx");
    expect(menu).toContain("if (!mounted) return null");
    const floating = read("components/timeline/FloatingTimelineDetail.tsx");
    expect(floating).toContain("transition-[opacity,transform]");
    const lane = read("components/timeline/TimelineKeyLane.tsx");
    expect(lane).toContain("HOVER_BRIDGE_GRACE_MS");
  });

  it("深度 Batch8：渲染管线占位与 settle（流式/终端/预览/引用）", () => {
    const tail = read("components/kiro/KiroStreamingTail.tsx");
    expect(tail).toContain("firstMarkerLang");
    const image = read("components/kiro/KiroMarkdown.tsx");
    expect(image).toContain("setImgReady");
    const terminal = read("components/kiro/computer/KiroTerminalBlock.tsx");
    expect(terminal).toContain("TerminalElapsed");
    expect(terminal).toContain("outputRef");
    const preview = read("components/kiro/computer/session/KiroComputerSessionPreview.tsx");
    expect(preview).toContain("ux-skeleton");
    const mermaid = read("components/kiro/KiroMermaid.tsx");
    expect(mermaid).toContain('key={error ? "error"');
    const conversation = read("components/kiro/KiroConversation.tsx");
    expect(conversation).toContain("SCROLL_STICK_DISTANCE_PX");
    expect(conversation).toContain("DisclosureRegion");
    const streaming = read("components/kiro/KiroStreamingMarkdown.tsx");
    expect(streaming).toContain("kiro-content-settle");
    expect(streaming).toContain("data-kiro-stream-cursor");
  });

  it("深度 Batch9：退出期 inert 安全网（pointer-events 拦不住键盘）", () => {
    const popover = read("components/ui/Popover.tsx");
    expect(popover).toContain("useInertOnHidden");
    const composer = read("components/kiro/KiroComposer.tsx");
    expect(composer).toContain("slashInertRef");
    expect(composer).toContain("mentionInertRef");
    expect(composer).toContain("warningInertRef");
    const table = read("components/dashboard/AssignmentTable.tsx");
    expect(table).toContain("bulkBarInertRef");
    expect(table).toContain("bulkDdlInertRef");
    const viewport = read("components/reminders/ReminderViewport.tsx");
    expect(viewport).toContain("cardInertRef");
    const conversation = read("components/kiro/KiroConversation.tsx");
    expect(conversation).toContain("scrollBtnInertRef");
    const navigator = read("components/kiro/navigation/KiroNavigator.tsx");
    expect(navigator).toContain("collapsedInertRef");
  });

  it("深度 Batch10：渲染管线占位（流式/终端/预览/引用/编辑）", () => {
    const tail = read("components/kiro/KiroStreamingTail.tsx");
    expect(tail).toContain("firstMarkerLang");
    expect(tail).toContain("min-h-[3rem]");
    const image = read("components/kiro/KiroMarkdown.tsx");
    expect(image).toContain("setImgReady");
    const terminal = read("components/kiro/computer/KiroTerminalBlock.tsx");
    expect(terminal).toContain("TerminalElapsed");
    expect(terminal).toContain("outputRef");
    const preview = read("components/kiro/computer/session/KiroComputerSessionPreview.tsx");
    expect(preview).toContain("min-h-[120px]");
    const usage = read("components/kiro/composer/KiroComposerContextUsage.tsx");
    expect(usage).toContain("transition-[stroke-dasharray]");
    expect(usage).toContain("tabular-nums");
    const mermaid = read("components/kiro/KiroMermaid.tsx");
    expect(mermaid).toContain("MERMAID_RENDER_DEBOUNCE_MS");
    const message = read("components/kiro/KiroMessage.tsx");
    expect(message).toContain("liveTrayPresence.mounted");
    expect(message).toContain('key="edit"');
  });

  it("Composer/Context chip：leaving 态 + 横向 collapse（非直接卸载）", () => {
    const composer = read("components/kiro/KiroComposer.tsx");
    expect(composer).toContain("leavingAttachmentIds");
    expect(composer).toContain("MOTION_EXIT_MS.panel");
    expect(composer).toContain('axis="horizontal"');
    expect(composer).toContain("onRemove={handleRemoveAttachment}");
    const bar = read("components/kiro/KiroContextBar.tsx");
    expect(bar).toContain("leavingKeys");
    expect(bar).toContain("MOTION_EXIT_MS.panel");
    expect(bar).toContain('axis="horizontal"');
  });
});
