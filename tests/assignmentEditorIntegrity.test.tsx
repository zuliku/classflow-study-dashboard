// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, act, waitFor, within } from "@testing-library/react";

// Polyfills
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as Record<string, unknown>).ResizeObserver = RO as unknown as typeof ResizeObserver;
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
if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
}

import { AddAssignmentModal } from "@/components/modals/AddAssignmentModal";
import { QuickAddCard } from "@/components/assignment/QuickAddCard";
import { openAssignmentEditor } from "@/lib/uiEvents";
import { useAppStore } from "@/store/useAppStore";
import type { Assignment, Course } from "@/types";

/**
 * Workflow UX V5 —— Assignment Editor Integrity & Capture Continuity：
 * P0：Full Editor 编辑已有任务只写自己拥有的字段（field-level patch），
 *     materialIds / autoReminderDisabled / recurrenceSeriesId / recurrenceParentId 不丢。
 * P1：Quick Add → 更多详情 → Full Editor：草稿无损移交 + ownership transfer（不双写）。
 */

const course = (id: string, name: string): Course =>
  ({
    id,
    name,
    code: id.toUpperCase(),
    teacher: "",
    classroom: "",
    credit: 2,
    description: "",
    bgHex: "#E3E6E0",
    borderHex: "#CCCBC4",
    textHex: "#313032",
    materials: [],
  }) as unknown as Course;

function makeAssignment(over: Partial<Assignment> = {}): Assignment {
  return {
    id: "a-target",
    courseId: "c-jl",
    title: "原标题",
    description: "",
    ddl: "2026-10-01T23:59:00",
    priority: "medium",
    status: "todo",
    progress: 0,
    tags: [],
    materialIds: ["mat-1", "mat-2"],
    autoReminderDisabled: true,
    recurrence: "weekly",
    recurrenceSeriesId: "rs-original",
    recurrenceParentId: "a-parent",
    ...over,
  } as Assignment;
}

const COURSES = [course("c-jl", "计量经济学"), course("c-wl", "物理")];

beforeEach(() => {
  cleanup();
  const prefs = useAppStore.getState().preferences;
  useAppStore.setState({
    courses: COURSES,
    assignments: [],
    calendarMarks: [],
    reminders: [],
    preferences: { ...prefs, defaultDDLTime: "23:59", defaultTaskPriority: "medium", defaultTaskStatus: "todo" },
    isAddCourseModalOpen: false,
    isImportScheduleModalOpen: false,
  });
});
afterEach(() => {
  cleanup();
});

function getAssignment(id = "a-target"): Assignment {
  return useAppStore.getState().assignments.find((a) => a.id === id)!;
}

// ============================================================
// P0：编辑保存不丢失隐藏 metadata
// ============================================================
describe("P0：Full Editor metadata integrity", () => {
  it("只修改 title：materialIds / autoReminderDisabled / recurrence / seriesId / parentId 全保留", async () => {
    const original = makeAssignment();
    useAppStore.setState({ assignments: [original] });
    render(<AddAssignmentModal />);

    act(() => {
      openAssignmentEditor({ assignmentId: "a-target" });
    });
    const input = document.getElementById("assignment-title") as HTMLInputElement;
    expect(input.value).toBe("原标题");

    fireEvent.change(input, { target: { value: "新标题（只改这个）" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    const saved = getAssignment();
    expect(saved.title).toBe("新标题（只改这个）");
    // ---- 隐藏字段完整性 ----
    expect(saved.materialIds).toEqual(["mat-1", "mat-2"]);
    expect(saved.autoReminderDisabled).toBe(true);
    expect(saved.recurrence).toBe("weekly");
    expect(saved.recurrenceSeriesId).toBe("rs-original");
    expect(saved.recurrenceParentId).toBe("a-parent");
  });

  it("显式取消 recurrence：recurrence 与 seriesId 清除（normalize 原语义）；lineage/materials/reminder flag 保留", async () => {
    useAppStore.setState({ assignments: [makeAssignment()] });
    render(<AddAssignmentModal />);

    act(() => {
      openAssignmentEditor({ assignmentId: "a-target" });
    });
    // DDL checkbox off → recurrence 同步 none（表单既有行为）
    fireEvent.click(screen.getByLabelText("设置截止时间"));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    const saved = getAssignment();
    expect(saved.recurrence).toBeUndefined();
    expect(saved.recurrenceSeriesId).toBeUndefined();
    // Domain 原语义：parent lineage 与其它隐藏字段不由 UI 清理
    expect(saved.recurrenceParentId).toBe("a-parent");
    expect(saved.materialIds).toEqual(["mat-1", "mat-2"]);
    expect(saved.autoReminderDisabled).toBe(true);
  });
});

// ============================================================
// P1：Quick Add → Full Editor 草稿移交
// ============================================================
describe("P1：Quick Add draft promotion", () => {
  interface Harness {
    onCloseSpy: ReturnType<typeof vi.fn>;
    rerender: () => void;
  }
  function renderCaptureSurface(): Harness {
    const onCloseSpy = vi.fn();
    render(
      <>
        <QuickAddCard defaultCourseId="c-jl" onClose={onCloseSpy} />
        <AddAssignmentModal />
      </>
    );
    return { onCloseSpy, rerender: () => {} };
  }

  function fillQuickAdd(withDdl: boolean) {
    fireEvent.change(screen.getByPlaceholderText("要完成什么？"), {
      target: { value: "计量经济学实证报告" },
    });
    // 预计耗时 / 描述位于「更多」DisclosureRegion 内，需先展开
    fireEvent.click(screen.getByRole("button", { name: /更多$/ }));
    // 优先级：QuickAdd UISelect（选项 紧急/高/中/低）
    fireEvent.click(screen.getAllByRole("combobox", { name: "优先级" })[0]);
    fireEvent.click(screen.getByRole("option", { name: /^高$/ }));
    if (withDdl) {
      fireEvent.click(screen.getByRole("button", { name: /添加截止时间/ }));
      fireEvent.change(screen.getByLabelText("截止日期"), { target: { value: "2026-09-18" } });
      fireEvent.change(screen.getByLabelText("截止时间"), { target: { value: "23:00" } });
    }
    fireEvent.change(screen.getByLabelText("预计耗时（分钟）"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("描述"), { target: { value: "完成基准回归" } });
  }

  function openFullEditorViaMoreDetails() {
    fireEvent.click(screen.getByRole("button", { name: /更多详情/ }));
  }

  it("草稿字段完整进入 Full Editor；Quick Add 关闭；未提前创建", () => {
    const h = renderCaptureSurface();
    fillQuickAdd(true);
    openFullEditorViaMoreDetails();

    // Ownership transfer：Quick Add 立即关闭
    expect(h.onCloseSpy).toHaveBeenCalled();
    // 不提前创建（promotion ≠ create）
    expect(useAppStore.getState().assignments.length).toBe(0);

    // Full Editor seed：Modal 域内断言（QuickAdd 仍挂载，同名控件需 within 隔离）
    const modal = screen.getByRole("dialog", { name: "添加任务" });
    expect((document.getElementById("assignment-title") as HTMLInputElement).value).toBe(
      "计量经济学实证报告"
    );
    const ddlDateInput = modal.querySelector('input[type="date"]') as HTMLInputElement;
    const ddlTimeInput = modal.querySelector('input[type="time"]') as HTMLInputElement;
    expect(ddlDateInput.value).toBe("2026-09-18");
    expect(ddlTimeInput.value).toBe("23:00");
    const est = within(modal).getByLabelText("预计耗时") as HTMLInputElement;
    expect(est.value).toBe("120");
    expect((within(modal).getByPlaceholderText("补充任务要求、提交格式等") as HTMLTextAreaElement).value).toBe(
      "完成基准回归"
    );
    // priority select 显示「高优先级」
    const prioTrigger = within(modal).getAllByRole("combobox", { name: "优先级" })[0];
    expect(prioTrigger.textContent).toContain("高优先级");
  });

  it("promotion 后提交：恰好新增 1 个任务且字段与草稿一致（无双写）", async () => {
    renderCaptureSurface();
    fillQuickAdd(true);
    openFullEditorViaMoreDetails();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(useAppStore.getState().assignments.length).toBe(1);
    });
    const a = useAppStore.getState().assignments[0];
    expect(a.title).toBe("计量经济学实证报告");
    expect(a.courseId).toBe("c-jl");
    expect(a.ddl).toBe("2026-09-18T23:00:00");
    expect(a.estimatedMinutes).toBe(120);
    expect(a.priority).toBe("high");
    expect(a.description).toBe("完成基准回归");
  });

  it("无 DDL 草稿：Full Editor DDL toggle 保持关闭（不被内部默认 tomorrow 自动开启）", () => {
    renderCaptureSurface();
    fillQuickAdd(false); // 不启用截止时间
    openFullEditorViaMoreDetails();

    const checkbox = screen.getByLabelText("设置截止时间") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    // 提交后无 DDL（合法状态）
    fireEvent.change(document.getElementById("assignment-title") as HTMLInputElement, {
      target: { value: "无截止任务" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    const a = useAppStore.getState().assignments[0];
    expect(a.ddl).toBeUndefined();
  });

  it("estimate 清洗统一：非数字输入经 normalize 后为空（直提与 handoff 同规则）", () => {
    renderCaptureSurface();
    fireEvent.change(screen.getByPlaceholderText("要完成什么？"), { target: { value: "标题" } });
    fireEvent.click(screen.getByRole("button", { name: /更多$/ }));
    fireEvent.change(screen.getByLabelText("预计耗时（分钟）"), { target: { value: "abc" } });
    openFullEditorViaMoreDetails();
    const est = screen.getByLabelText("预计耗时（分钟）") as HTMLInputElement;
    expect(est.value).toBe("");
  });
});

// ============================================================
// Legacy 入口回归
// ============================================================
describe("Legacy editor entries regression", () => {
  beforeEach(() => {
    render(<AddAssignmentModal />);
  });

  it("plain create：空 draft 默认值来自 preferences", () => {
    act(() => openAssignmentEditor({}));
    const prioTrigger = screen.getAllByRole("combobox", { name: "优先级" })[0];
    expect(prioTrigger.textContent).toContain("中优先级");
    const statusDefault = useAppStore.getState().preferences.defaultTaskStatus;
    expect(statusDefault).toBe("todo");
  });

  it("courseId-only：课程预填且 DDL 关闭", () => {
    act(() => openAssignmentEditor({ courseId: "c-wl" }));
    const courseTrigger = screen.getAllByRole("combobox", { name: "关联课程" })[0];
    expect(courseTrigger.textContent).toContain("物理");
    const checkbox = screen.getByLabelText("设置截止时间") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it("ddlDate-only（Calendar）：DDL 自动开启，日期预填，时间 = defaultDDLTime", () => {
    act(() => openAssignmentEditor({ ddlDate: "2026-09-18" }));
    const checkbox = screen.getByLabelText("设置截止时间") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect((document.querySelector('input[type="date"]') as HTMLInputElement).value).toBe("2026-09-18");
    expect((document.querySelector('input[type="time"]') as HTMLInputElement).value).toBe("23:59");
  });

  it("assignmentId edit：已有任务回填不受 draft/preferences 影响", async () => {
    act(() => {
      useAppStore.setState({ assignments: [makeAssignment({ title: "既有任务", estimatedMinutes: 45 })] });
    });
    act(() => openAssignmentEditor({ assignmentId: "a-target" }));
    expect((document.getElementById("assignment-title") as HTMLInputElement).value).toBe("既有任务");
    expect((screen.getByLabelText("预计耗时") as HTMLInputElement).value).toBe("45");
  });

  it("preference listener deps：修改默认优先级后再次打开反映新值（旧 closure 不残留）", () => {
    act(() => openAssignmentEditor({}));
    let trigger = screen.getAllByRole("combobox", { name: "优先级" })[0];
    expect(trigger.textContent).toContain("中优先级");

    const prefs = useAppStore.getState().preferences;
    act(() => {
      useAppStore.setState({ preferences: { ...prefs, defaultTaskPriority: "urgent" } });
    });
    act(() => openAssignmentEditor({}));
    trigger = screen.getAllByRole("combobox", { name: "优先级" })[0];
    expect(trigger.textContent).toContain("紧急");
  });
});
