// @vitest-environment jsdom
/**
 * Course Library V5 Card 组件测试（copy / actions / footer removal / color identity）。
 * jsdom + react-dom/client + act；不写 brittle snapshot。
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Course, Material } from "@/types";
import { CourseTaskRowView } from "@/lib/courseDetailView";
import { buildCourseLibraryTaskView } from "@/lib/courses/courseLibraryView";
import { CourseLibraryCard } from "@/components/course/CourseLibraryCard";

if (!window.matchMedia) {
  (window as unknown as { matchMedia: unknown }).matchMedia = () =>
    ({
      matches: false,
      media: "",
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }) as unknown as MediaQueryList;
}

function mkCourse(patch: Partial<Course> = {}): Course {
  return {
    id: "c1",
    name: "数据结构与算法",
    code: "CS-210",
    teacher: "李教授",
    classroom: "计算机楼102",
    credit: 4,
    bgHex: "#E3F0E6",
    borderHex: "#2E7D5B",
    textHex: "#313032",
    description: "",
    materials: [],
    ...patch,
  };
}

function mkRow(patch: Partial<CourseTaskRowView>): CourseTaskRowView {
  return {
    id: "a1",
    title: "红黑树删除算法整理",
    status: "todo",
    statusLabel: "待办",
    deadlineLabel: "8月19日",
    overdue: false,
    hasDdl: true,
    ...patch,
  };
}

const mkMat = (id: string, title: string): Material => ({
  id,
  title,
  type: "pdf",
  size: "2.4 MB",
  uploadDate: "2026-08-10",
});

function renderCard(overrides: Partial<Parameters<typeof CourseLibraryCard>[0]> = {}) {
  const onOpenCourse = vi.fn();
  const onOpenAssignment = vi.fn();
  const onUploadClick = vi.fn();
  const onAddTask = vi.fn();
  const onPreviewMaterial = vi.fn();
  const onTogglePopover = vi.fn();
  const onClosePopover = vi.fn();

  const rows: CourseTaskRowView[] = overrides.taskRows ?? [];
  const props = {
    course: mkCourse(),
    next: null,
    nextCellText: "本周无后续课程",
    meta: "李教授 · 计算机楼102",
    taskRows: rows,
    taskView: buildCourseLibraryTaskView(rows),
    materials: [],
    newMaterialIds: new Set<string>(),
    uploading: false,
    activePopover: null,
    onTogglePopover,
    onClosePopover,
    onOpenCourse,
    onOpenAssignment,
    onUploadClick,
    onAddTask,
    onPreviewMaterial,
    ...overrides,
  };

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<CourseLibraryCard {...props} />);
  });
  return {
    container,
    root,
    onOpenCourse,
    onOpenAssignment,
    onUploadClick,
    onAddTask,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("CourseLibraryCard V5 copy", () => {
  it("4 total（2 active / 1 submitted / 1 completed）→ 待处理 2（非 任务 · 4）；全部 4 项（非 查看全部 +2）", () => {
    const rows = [
      mkRow({ id: "a1", status: "todo" }),
      mkRow({ id: "a2", status: "doing", title: "整理本周算法笔记" }),
      mkRow({ id: "a3", status: "submitted", title: "已提交作业" }),
      mkRow({ id: "a4", status: "completed", title: "已完成作业" }),
    ];
    const h = renderCard({ taskRows: rows });
    const text = h.container.textContent ?? "";
    expect(text).toContain("待处理 2");
    expect(text).not.toContain("任务 · 4");
    expect(text).toContain("全部 4 项");
    expect(text).not.toContain("查看全部 +2");
    h.cleanup();
  });

  it("5 completed → 待处理 0 + 暂无待处理任务 + 全部 5 项", () => {
    const rows = Array.from({ length: 5 }, (_, i) => mkRow({ id: `c${i}`, status: "completed" as const }));
    const h = renderCard({ taskRows: rows });
    const text = h.container.textContent ?? "";
    expect(text).toContain("待处理 0");
    expect(text).toContain("暂无待处理任务");
    expect(text).toContain("全部 5 项");
    expect(text).not.toContain("待处理 5");
    h.cleanup();
  });

  it("3 materials → 课程资料 3 + 全部 3 项（非 查看全部 +1）", () => {
    const h = renderCard({
      materials: [mkMat("m1", "第1章 讲义.pdf"), mkMat("m2", "第2章 讲义.pdf"), mkMat("m3", "第3章 讲义.pdf")],
    });
    const text = h.container.textContent ?? "";
    expect(text).toContain("课程资料 3");
    expect(text).toContain("全部 3 项");
    expect(text).not.toContain("查看全部 +1");
    h.cleanup();
  });

  it("≤2 tasks / ≤2 materials → 不显示「全部」", () => {
    const h = renderCard({
      taskRows: [mkRow({ id: "a1", status: "todo" }), mkRow({ id: "a2", status: "doing" })],
      materials: [mkMat("m1", "讲义.pdf"), mkMat("m2", "大纲.pdf")],
    });
    expect(h.container.textContent).not.toContain("全部");
    h.cleanup();
  });

  it("V5.1：2 todo → preview 2 → 无全部入口（不冗余）", () => {
    const h = renderCard({
      taskRows: [mkRow({ id: "a1", status: "todo" }), mkRow({ id: "a2", status: "doing" })],
    });
    expect(h.container.textContent).not.toContain("全部");
    h.cleanup();
  });

  it("V5.1：3 todo → 全部 3 项（preview 只显示 2）", () => {
    const h = renderCard({
      taskRows: [
        mkRow({ id: "a1", status: "todo" }),
        mkRow({ id: "a2", status: "doing" }),
        mkRow({ id: "a3", status: "todo", title: "第三条" }),
      ],
    });
    const text = h.container.textContent ?? "";
    expect(text).toContain("全部 3 项");
    expect(text).not.toContain("第三条"); // preview 只显示前 2
    h.cleanup();
  });

  it("V5.1：1 todo + 1 submitted → 全部 2 项（submitted 可访问入口）", () => {
    const h = renderCard({
      taskRows: [
        mkRow({ id: "a1", status: "todo", title: "待办任务" }),
        mkRow({ id: "a2", status: "submitted", title: "已提交任务" }),
      ],
    });
    const text = h.container.textContent ?? "";
    expect(text).toContain("待处理 1");
    expect(text).toContain("待办任务"); // preview 中的 todo
    expect(text).not.toContain("已提交任务"); // 不在 preview
    expect(text).toContain("全部 2 项");
    h.cleanup();
  });

  it("V5.1：completed only（1 项）→ 待处理 0 + 全部 1 项", () => {
    const h = renderCard({
      taskRows: [mkRow({ id: "a1", status: "completed", title: "已完成任务" })],
    });
    const text = h.container.textContent ?? "";
    expect(text).toContain("待处理 0");
    expect(text).toContain("暂无待处理任务");
    expect(text).toContain("全部 1 项");
    expect(text).not.toContain("已完成任务"); // preview 不显示 completed
    h.cleanup();
  });

  it("V5.1：2 submitted only → 全部 2 项", () => {
    const h = renderCard({
      taskRows: [
        mkRow({ id: "a1", status: "submitted" }),
        mkRow({ id: "a2", status: "submitted" }),
      ],
    });
    const text = h.container.textContent ?? "";
    expect(text).toContain("待处理 0");
    expect(text).toContain("全部 2 项");
    h.cleanup();
  });

  it("V5.1：2 todo + 1 completed → 全部 3 项", () => {
    const h = renderCard({
      taskRows: [
        mkRow({ id: "a1", status: "todo" }),
        mkRow({ id: "a2", status: "doing" }),
        mkRow({ id: "a3", status: "completed" }),
      ],
    });
    const text = h.container.textContent ?? "";
    expect(text).toContain("待处理 2");
    expect(text).toContain("全部 3 项");
    h.cleanup();
  });

  it("footer 完全移除（无 + 任务 / 课程详情）；Add 在 Task Section", () => {
    const h = renderCard({ taskRows: [mkRow({ id: "a1", status: "todo" })] });
    expect(h.container.querySelector("footer")).toBeNull();
    const text = h.container.textContent ?? "";
    expect(text).not.toContain("课程详情");
    expect(text).not.toContain("+ 任务");
    expect(text).toContain("添加");
    h.cleanup();
  });
});

describe("CourseLibraryCard V5 actions / identity", () => {
  it("Course name 打开 Course Hub；task row 打开 Assignment；添加 → onAddTask", () => {
    const h = renderCard({ taskRows: [mkRow({ id: "a1", status: "todo" })] });
    const title = h.container.querySelector('button[title="数据结构与算法"]')!;
    act(() => (title as HTMLButtonElement).click());
    expect(h.onOpenCourse).toHaveBeenCalledTimes(1);

    const task = Array.from(h.container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("红黑树删除算法整理")
    )!;
    act(() => (task as HTMLButtonElement).click());
    expect(h.onOpenAssignment).toHaveBeenCalledWith("a1");

    const add = Array.from(h.container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("添加")
    )!;
    act(() => (add as HTMLButtonElement).click());
    expect(h.onAddTask).toHaveBeenCalledTimes(1);
    h.cleanup();
  });

  it("color identity：header 用 bgHex，accent rail 用 borderHex（无 tiny dot）", () => {
    const h = renderCard({
      course: mkCourse({ bgHex: "#E3F0E6", borderHex: "#2E7D5B" }),
    });
    const header = h.container.querySelector("header") as HTMLElement;
    expect(header.style.backgroundColor).toBe("rgb(227, 240, 230)");
    const rail = h.container.querySelector('span[aria-hidden="true"]') as HTMLElement;
    expect(rail.style.backgroundColor).toBe("rgb(46, 125, 91)");
    // 不再有 7px 圆点（仅 rail 一种颜色提示）
    const dots = h.container.querySelectorAll("span.rounded-full");
    expect(dots.length).toBe(1); // rail
    h.cleanup();
  });

  it("上传 action：compact + aria-label 含课程名", () => {
    const h = renderCard({ course: mkCourse({ name: "数据结构与算法" }) });
    const upload = h.container.querySelector('button[aria-label="上传《数据结构与算法》的课程资料"]') as HTMLButtonElement;
    expect(upload).not.toBeNull();
    expect(upload.textContent).toContain("上传");
    h.cleanup();
  });

  it("task preview deadline：overdue danger / future sandrift / 无 ddl muted（preview ≤2 行）", () => {
    const rows = [
      mkRow({ id: "a1", title: "逾期任务", overdue: true, deadlineLabel: "8月10日" }),
      mkRow({ id: "a2", title: "无截止", overdue: false, deadlineLabel: "无截止时间", hasDdl: false }),
    ];
    const h = renderCard({ taskRows: rows });
    const text = h.container.textContent ?? "";
    expect(text).toContain("逾期任务");
    expect(text).toContain("8月10日");
    expect(text).toContain("无截止时间");
    // 超过 2 条只预览前 2（第三条不出现）
    const three = renderCard({
      taskRows: [...rows, mkRow({ id: "a3", title: "第三条", overdue: false, deadlineLabel: "8月19日" })],
    });
    expect(three.container.textContent).not.toContain("第三条");
    three.cleanup();
    h.cleanup();
  });

  it("empty course：待处理 0 + 暂无待处理任务 + 暂无课程资料（视觉完整）", () => {
    const h = renderCard();
    const text = h.container.textContent ?? "";
    expect(text).toContain("待处理 0");
    expect(text).toContain("暂无待处理任务");
    expect(text).toContain("课程资料 0");
    expect(text).toContain("暂无课程资料");
    expect(text).toContain("本周无后续课程");
    h.cleanup();
  });

  it("无下一节：只显示 muted 文案（不叠加 下节课 前缀）", () => {
    const h = renderCard({ nextCellText: "本周无后续课程" });
    const text = h.container.textContent ?? "";
    expect(text).toContain("本周无后续课程");
    expect(text.match(/下节课/g)).toBeNull();
    h.cleanup();
  });
});
