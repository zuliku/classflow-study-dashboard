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

  it("UnscheduledShelf：presence 淡出 + 展开 key 淡入", () => {
    const src = read("components/timeline/TimelineUnscheduledShelf.tsx");
    expect(src).toContain("usePresence(assignments.length > 0, MOTION_EXIT_MS.panel)");
    expect(src).toMatch(/key=\{expanded \? "wrap" : "row"\}[\s\S]*?ux-fade/);
  });

  it("MiniCalendar Agenda：DisclosureRegion 折叠（非整块卸载）", () => {
    const src = read("components/dashboard/MiniCalendar.tsx");
    expect(src).toMatch(/<DisclosureRegion open=\{agendaVisible\}/);
    expect(src).not.toMatch(/\{agendaVisible && \(\s*<div\s*\n?\s*ref=\{agendaRef\}/);
  });

  it("AssignmentDrawer：follow-up 进入 + focus 三态淡入 + picker Disclosure", () => {
    const src = read("components/drawers/AssignmentDrawer.tsx");
    expect(src).toMatch(/data-testid="focus-follow-up"[\s\S]*?animate-enter/);
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
    expect(src).toContain("animate-enter flex items-center gap-1 px-2.5 py-1 rounded-xl border");
  });

  it("ReminderSection picker：DisclosureRegion + pickerMode keyed 淡入", () => {
    const src = read("components/reminders/AssignmentReminderSection.tsx");
    expect(src).toMatch(/<DisclosureRegion open=\{pickerOpen\}>/);
    expect(src).toMatch(/key=\{pickerMode\}[\s\S]*?ux-fade/);
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

  it("Composer ＋菜单：常挂载受控 presence（关闭播退出，不硬卸）", () => {
    const src = read("components/kiro/KiroComposer.tsx");
    expect(src).toContain('open={openMenu === "add"}');
    expect(src).not.toMatch(/\{\s*openMenu === "add" && \(\s*<PopoverPanel/);
  });

  it("建议条：presence + 折叠退场 + 进入淡入（发送消费不硬切顶布局）", () => {
    const src = read("components/kiro/KiroContextSuggestions.tsx");
    expect(src).toContain("usePresence(open, MOTION_EXIT_MS.panel)");
    expect(src).toContain("ExitCollapse");
    expect(src).toContain("animate-enter");
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
