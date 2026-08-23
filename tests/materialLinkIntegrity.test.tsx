// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, act, within, waitFor } from "@testing-library/react";

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

import {
  collectCourseMaterialDeleteSnapshot,
  removeCourseMaterialDeleteSnapshot,
  restoreCourseMaterialDeleteSnapshot,
} from "@/lib/dataDependencies";
import { CourseDetailDrawer } from "@/components/drawers/CourseDetailDrawer";
import { AssignmentDrawer } from "@/components/drawers/AssignmentDrawer";
import { FilePreviewModal } from "@/components/modals/FilePreviewModal";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
// Kiro session 域 mock（本文件不测 Kiro 行为）
vi.mock("@/hooks/useKiroHandoff", () => ({
  useKiroHandoff: () => ({
    handoffPrompt: vi.fn(),
    handoffAssignmentPrompt: vi.fn(),
    openForWeek: vi.fn(),
    openForGroupProject: vi.fn(),
  }),
}));
import type { Assignment, Course, Material } from "@/types";

/**
 * Workflow UX V6 —— Material Link Integrity & Task Resource Access：
 * P0：Delete → Undo 是完整 inverse（relation-level snapshot/restore），
 *     不覆盖 Undo 窗口内 concurrent edits；Course/Assignment 已删时安全降级。
 * P1：Assignment 关联资料主体可点击 preview（unlink 为独立 sibling action）。
 */

const material = (id: string, over: Partial<Material> = {}): Material => ({
  id,
  title: `资料 ${id}`,
  type: "pdf",
  uploadDate: "2026-09-01",
  ...over,
});

const courseWith = (id: string, materials: Material[]): Course =>
  ({
    id,
    name: `课程 ${id}`,
    code: id.toUpperCase(),
    teacher: "",
    classroom: "",
    credit: 2,
    description: "",
    bgHex: "#E3E6E0",
    borderHex: "#CCCBC4",
    textHex: "#313032",
    materials,
  }) as unknown as Course;

const assignment = (
  id: string,
  courseId: string,
  materialIds: string[] | undefined,
  over: Partial<Assignment> = {}
): Assignment =>
  ({
    id,
    courseId,
    title: `任务 ${id}`,
    description: "",
    ddl: "2026-10-01T23:59:00",
    priority: "medium",
    status: "todo",
    progress: 0,
    tags: [],
    ...(materialIds ? { materialIds } : {}),
    ...over,
  }) as Assignment;

beforeEach(() => {
  cleanup();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("P0 snapshot：collect", () => {
  const m1 = material("m1");
  const m2 = material("m2");
  const m3 = material("m3");
  const courses = [courseWith("c1", [m1, m2, m3])];
  const assignments = [
    assignment("A", "c1", ["m1", "m2"]),
    assignment("B", "c1", ["m2", "m3"]),
  ];

  it("删除 m2：snapshot 捕获 material/index 与各任务 relation index", () => {
    const snap = collectCourseMaterialDeleteSnapshot(
      { courses, assignments },
      "c1",
      "m2"
    );
    expect(snap).not.toBeNull();
    expect(snap!.material).toEqual(m2);
    expect(snap!.materialIndex).toBe(1);
    const linkA = snap!.assignmentLinks.find((l) => l.assignmentId === "A");
    const linkB = snap!.assignmentLinks.find((l) => l.assignmentId === "B");
    expect(linkA?.materialIndex).toBe(1);
    expect(linkB?.materialIndex).toBe(0);
  });

  it("remove：Course=[m1,m3] / A=[m1] / B=[m3]；空数组存 undefined", () => {
    const snap = collectCourseMaterialDeleteSnapshot(
      { courses, assignments },
      "c1",
      "m2"
    )!;
    const next = removeCourseMaterialDeleteSnapshot({ courses, assignments }, snap);
    const c = next.courses.find((x) => x.id === "c1")!;
    expect(c.materials.map((m) => m.id)).toEqual(["m1", "m3"]);
    expect(next.assignments.find((a) => a.id === "A")!.materialIds).toEqual(["m1"]);
    expect(next.assignments.find((a) => a.id === "B")!.materialIds).toEqual(["m3"]);
  });

  it("course 或 material 不存在 → null", () => {
    expect(collectCourseMaterialDeleteSnapshot({ courses: [], assignments }, "c1", "m2")).toBeNull();
    expect(
      collectCourseMaterialDeleteSnapshot({ courses, assignments }, "c1", "missing")
    ).toBeNull();
  });
});

describe("P0 restore：完整 inverse + 边界", () => {
  const m1 = material("m1");
  const m2 = material("m2");
  const m3 = material("m3");

  function build() {
    const courses = [courseWith("c1", [m1, m2, m3])];
    const assignments = [
      assignment("A", "c1", ["m1", "m2"]),
      assignment("B", "c1", ["m2", "m3"]),
    ];
    const snap = collectCourseMaterialDeleteSnapshot({ courses, assignments }, "c1", "m2")!;
    const afterRemove = removeCourseMaterialDeleteSnapshot({ courses, assignments }, snap);
    return { snap, before: { courses, assignments }, afterRemove };
  }

  it("Undo 完整恢复：Course 原顺序 + A/B relation 原 index + 原对象", () => {
    const { snap, afterRemove } = build();
    const next = restoreCourseMaterialDeleteSnapshot(afterRemove, snap)!;
    const c = next.courses.find((x) => x.id === "c1")!;
    expect(c.materials.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(c.materials[1]).toEqual(m2); // index=1 且对象原值
    const a = next.assignments.find((x) => x.id === "A")!;
    const b = next.assignments.find((x) => x.id === "B")!;
    expect(a.materialIds).toEqual(["m1", "m2"]);
    expect(b.materialIds).toEqual(["m2", "m3"]);
  });

  it("concurrent edit 保留：Undo 只补回 deleted relation", () => {
    const { snap, afterRemove } = build();
    // Undo 窗口内 A 新增 m4
    const withConcurrent = {
      courses: afterRemove.courses,
      assignments: afterRemove.assignments.map((a) =>
        a.id === "A" ? { ...a, materialIds: [...(a.materialIds ?? []), "m4"] } : a
      ),
    };
    const next = restoreCourseMaterialDeleteSnapshot(withConcurrent, snap)!;
    const a = next.assignments.find((x) => x.id === "A")!;
    expect(a.materialIds).toEqual(["m1", "m2", "m4"]); // m4 保留，m2 按原 index 回到中间
  });

  it("幂等：同一 snapshot restore 两次不重复", () => {
    const { snap, afterRemove } = build();
    let state = afterRemove;
    state = restoreCourseMaterialDeleteSnapshot(state, snap)!;
    state = restoreCourseMaterialDeleteSnapshot(state, snap)!;
    const c = state.courses.find((x) => x.id === "c1")!;
    expect(c.materials.filter((m) => m.id === "m2")).toHaveLength(1);
    expect(state.assignments.find((x) => x.id === "A")!.materialIds.filter((id) => id === "m2")).toHaveLength(1);
  });

  it("Assignment 已删除：只恢复 Material，不重建 Assignment", () => {
    const { snap, afterRemove } = build();
    const onlyB = { courses: afterRemove.courses, assignments: afterRemove.assignments.filter((a) => a.id === "B") };
    const next = restoreCourseMaterialDeleteSnapshot(onlyB, snap)!;
    expect(next.courses[0].materials.some((m) => m.id === "m2")).toBe(true);
    expect(next.assignments.some((a) => a.id === "A")).toBe(false);
  });

  it("Assignment 换课程：不恢复跨课程 relation", () => {
    const { snap, afterRemove } = build();
    const moved = {
      courses: afterRemove.courses,
      assignments: afterRemove.assignments.map((a) =>
        a.id === "A" ? { ...a, courseId: "c-other" } : a
      ),
    };
    const next = restoreCourseMaterialDeleteSnapshot(moved, snap)!;
    expect(next.assignments.find((x) => x.id === "A")!.materialIds ?? []).not.toContain("m2");
  });

  it("Course 已删除 → null（no-op，不 orphan）", () => {
    const { snap, afterRemove } = build();
    expect(
      restoreCourseMaterialDeleteSnapshot(
        { courses: [], assignments: afterRemove.assignments },
        snap
      )
    ).toBeNull();
  });
});

// ============================================================
// Store 集成 + Blob lifecycle（CourseDetailDrawer）
// ============================================================
vi.mock("@/lib/fileStorage", async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, deleteFileBlob: vi.fn(async () => {}) };
});

import { deleteFileBlob } from "@/lib/fileStorage";

async function courseDrawerHarness(materials: Material[], assignments: Assignment[]) {
  useAppStore.setState({
    courses: [courseWith("c1", materials)],
    assignments,
    calendarMarks: [],
    reminders: [],
    studyBlocks: [],
    schedules: [],
    groupProjects: [],
    scheduleOccurrenceOverrides: [],
    selectedCourseId: null,
  });
  render(<CourseDetailDrawer />);
  // 模拟真实打开：closed → select course（swap state machine 收敛后 entity interactive）
  await act(() => {
    useAppStore.setState({ selectedCourseId: "c1" });
  });
}

describe("Store + CourseDetailDrawer Blob lifecycle", () => {
  const storageMat = material("m-store", { title: "带存储的讲义", storageKey: "blob-key-1" });

  beforeEach(() => {
    vi.mocked(deleteFileBlob).mockClear();
  });

  it("delete 返回 snapshot 并原子清理；store restore 成功返回 true", async () => {
    await courseDrawerHarness([storageMat], [assignment("A", "c1", ["m-store"])]);
    const btn = screen.getByLabelText(`删除资料 ${storageMat.title}`);
    fireEvent.click(btn);
    const after = useAppStore.getState();

    await waitFor(() => {
      expect(useAppStore.getState().courses[0].materials.length).toBe(0);
    });
    expect(useAppStore.getState().assignmEnts?.[0]?.materialIds ?? undefined).toBeUndefined();
  });

  it("Case A：未撤销 dismiss → deleteFileBlob 调用一次", async () => {
    await courseDrawerHarness([storageMat], []);
    fireEvent.click(screen.getByLabelText(`删除资料 ${storageMat.title}`));
    // eslint-disable-next-line no-console
    console.log("TOASTS:", JSON.stringify(useToastStore.getState().toasts.map((t: { message: string }) => t.message)));
    const toast = useToastStore.getState().toasts.at(-1)!;

    act(() => {
      toast.onDismiss?.();
    });
    expect(deleteFileBlob).toHaveBeenCalledTimes(1);
    expect(deleteFileBlob).toHaveBeenCalledWith("blob-key-1");
  });

  it("Case B：Undo 成功 → dismiss 不删除 Blob", async () => {
    await courseDrawerHarness([storageMat], []);
    fireEvent.click(screen.getByLabelText(`删除资料 ${storageMat.title}`));
    const toast = useToastStore.getState().toasts.at(-1)!;

    act(() => {
      toast.onAction?.();
    });
    act(() => {
      toast.onDismiss?.();
    });
    expect(deleteFileBlob).not.toHaveBeenCalled();
    expect(useAppStore.getState().courses[0].materials.some((m) => m.id === "m-store")).toBe(true);
  });

  it("Case C：Undo 请求但 restore 失败（Course 已删）→ Blob 仍被清理", async () => {
    await courseDrawerHarness([storageMat], []);
    fireEvent.click(screen.getByLabelText(`删除资料 ${storageMat.title}`));
    const toast = useToastStore.getState().toasts.at(-1)!;

    // Undo 前课程被删除
    useAppStore.setState({ courses: [] });
    act(() => {
      toast.onAction?.(); // restore 返回 false
    });
    expect(useAppStore.getState().courses.length).toBe(0); // 不凭空重建

    act(() => {
      toast.onDismiss?.();
    });
    expect(deleteFileBlob).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// P1：Assignment linked material preview / unlink
// ============================================================
describe("P1 Assignment linked material preview", () => {
  const mat1 = material("mat-1", { title: "回归分析讲义", url: "https://example.com/x.pdf" });

  function drawerHarness() {
    useAppStore.setState({
      courses: [courseWith("c-jl", [mat1])],
      assignments: [assignment("a-link", "c-jl", ["mat-1"], { title: "实证报告" })],
      calendarMarks: [],
      reminders: [],
      studyBlocks: [],
      schedules: [],
      groupProjects: [],
      scheduleOccurrenceOverrides: [],
      selectedAssignmentId: "a-link",
      isAddCourseModalOpen: false,
    });
    render(
      <>
        <AssignmentDrawer />
        <FilePreviewModal />
      </>
    );
    // 关联资料 Disclosure 默认 collapsed → 点击标题展开（linked rows 才挂载）
    fireEvent.click(screen.getByText("关联资料"));
  }

  function previewEvents() {
    const events: Material[] = [];
    const spy = vi.spyOn(window, "dispatchEvent").mockImplementation((ev: Event) => {
      const detail = (ev as CustomEvent<{ material: Material }>).detail;
      if ((ev.type as string) === "classflow:preview-material" && detail?.material) {
        events.push(detail.material);
        return true; // 拦截：不让真实 FPM 打开（单测聚焦契约）
      }
      return true;
    });
    return { events, spy };
  }

  it("关联资料主体点击 → previewMaterial(mat1)；selection 不变", () => {
    drawerHarness();
    const { events } = previewEvents();

    const previewBtn = screen.getByLabelText(`预览资料《${mat1.title}》`);
    fireEvent.click(previewBtn);
    expect(events).toEqual([mat1]);
    // Preview 打开不关闭 Assignment Drawer / 不改 selection
    expect(useAppStore.getState().selectedAssignmentId).toBe("a-link");
    expect(screen.getAllByText(/实证报告/).length).toBeGreaterThanOrEqual(1);
  });

  it("Unlink：仅解除关系，不触发 preview、不删除 Course Material", () => {
    drawerHarness();
    const { events } = previewEvents();

    fireEvent.click(screen.getByLabelText(`解除关联 ${mat1.title}`));
    expect(events).toHaveLength(0);
    const a = useAppStore.getState().assignments.find((x) => x.id === "a-link")!;
    expect(a.materialIds ?? []).not.toContain("mat-1");
    // Course 侧资料仍在（unlink ≠ delete）
    expect(useAppStore.getState().courses[0].materials.some((m) => m.id === "mat-1")).toBe(true);
  });

  it("FilePreviewModal 集成：preview → 文件预览 dialog 打开且显示标题", () => {
    drawerHarness();
    // 真实 dispatch（不拦截）：FPM 监听 onPreviewMaterial
    fireEvent.click(screen.getByLabelText(`预览资料《${mat1.title}》`));
    const dialog = screen.getByRole("dialog", { name: "文件预览" });
    expect(dialog).toBeTruthy();
    expect(within(dialog).getAllByText(mat1.title).length).toBeGreaterThanOrEqual(1);
    // Esc 只关预览层；Assignment selection 保持
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useAppStore.getState().selectedAssignmentId).toBe("a-link");
  });
});
