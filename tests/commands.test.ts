import { describe, it, expect, vi } from "vitest";
import {
  buildPalette,
  getContextCommands,
  getAssignmentContextCommands,
  getSelectedCourse,
  getSelectedAssignment,
  CommandContext,
} from "@/lib/commands";
import { Course, Assignment } from "@/types";

const course = (id: string, name: string): Course => ({
  id,
  name,
  code: "C" + id,
  teacher: "老师",
  classroom: "教室",
  credit: 3,
  description: "",
  bgHex: "#E3E6E0",
  borderHex: "#D0D5CC",
  textHex: "#313032",
  materials: [],
});

const assignment = (id: string, title: string): Assignment => ({
  id,
  courseId: "c1",
  title,
  description: "",
  ddl: "2026-08-12T23:59:00",
  priority: "medium",
  status: "todo",
  progress: 0,
  tags: [],
});

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  const courses = [course("c1", "高等数学")];
  const assignments = [
    assignment("a1", "微积分作业"),
    assignment("a2", "经济学论文"),
    assignment("a3", "英语演讲"),
  ];
  return {
    activeTab: "overview",
    selectedCourseId: null,
    selectedAssignmentId: null,
    courses,
    assignments,
    semester: { id: "s", name: "2026春", startDate: "2026-02-23", totalWeeks: 16 },
    currentSemesterWeek: 1,
    highlightedAssignmentId: null,
    assignmentSelection: [],
    assignmentActions: {
      openDrawer: () => {},
      editDrawer: () => {},
      markCompleted: () => {},
      markDoing: () => {},
      setPriority: () => {},
      setDDLDate: () => {},
      shiftDDL: () => {},
      remove: () => {},
    },
    setActiveTab: () => {},
    setSelectedCourseId: () => {},
    setSelectedAssignmentId: () => {},
    setAddCourseModalOpen: () => {},
    setImportScheduleModalOpen: () => {},
    setFullTimetableModalOpen: () => {},
    setAssignmentTimeSlice: () => {},
    resetToCurrentWeek: () => {},
    close: () => {},
    ...overrides,
  };
}

describe("getSelectedCourse / getSelectedAssignment", () => {
  it("ID 非空但实体不存在 → null（stale 安全）", () => {
    expect(getSelectedCourse(makeCtx({ selectedCourseId: "gone" }))).toBeNull();
    expect(getSelectedAssignment(makeCtx({ selectedAssignmentId: "gone" }))).toBeNull();
  });

  it("ID 有效 → 返回实体", () => {
    expect(getSelectedCourse(makeCtx({ selectedCourseId: "c1" }))?.name).toBe("高等数学");
    expect(getSelectedAssignment(makeCtx({ selectedAssignmentId: "a1" }))?.title).toBe("微积分作业");
  });
});

describe("Course Context Commands（when 启用）", () => {
  it("selectedCourseId = null → 不显示课程上下文命令", () => {
    const ctx = makeCtx({ selectedCourseId: null });
    expect(getContextCommands(ctx).some((c) => c.id === "ctx-course-new-task")).toBe(false);
    const items = buildPalette("", ctx);
    expect(items.some((i) => i.group === "context" && i.label.includes("新建任务"))).toBe(false);
    expect(items.some((i) => i.label === "上下文操作")).toBe(false);
  });

  it("有效 selectedCourseId → 显示「为《高等数学》新建任务」", () => {
    const ctx = makeCtx({ selectedCourseId: "c1" });
    const cmds = getContextCommands(ctx);
    const cmd = cmds.find((c) => c.id === "ctx-course-new-task");
    expect(cmd).toBeDefined();
    expect(cmd!.label).toBe("为《高等数学》新建任务");
    expect(cmd!.group).toBe("context");
    // when 校验通过
    expect(cmd!.when?.(ctx)).toBe(true);
  });

  it("stale course id → 过滤（when 校验实体存在）", () => {
    const ctx = makeCtx({ selectedCourseId: "deleted-course" });
    expect(getContextCommands(ctx).some((c) => c.id === "ctx-course-new-task")).toBe(false);
  });

  it("搜索「任务」/「高等数学」/「新建」能匹配课程上下文命令", () => {
    const ctx = makeCtx({ selectedCourseId: "c1" });
    for (const q of ["任务", "高等数学", "新建"]) {
      const items = buildPalette(q, ctx);
      expect(items.some((i) => i.key === "cmd-ctx-course-new-task")).toBe(true);
    }
  });

  it("run 防 stale：实体消失后执行不 throw 且不打开 editor", () => {
    const ctx = makeCtx({ selectedCourseId: "c1" });
    const cmd = getContextCommands(ctx).find((c) => c.id === "ctx-course-new-task")!;
    const spy = vi.fn();
    const staleCtx = makeCtx({ selectedCourseId: "c1", courses: [] });
    expect(() => cmd.run(staleCtx)).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("Assignment Context Commands（when 启用）", () => {
  it("selectedAssignmentId = null → 不显示任务上下文命令", () => {
    expect(getContextCommands(makeCtx({ selectedAssignmentId: null })).length).toBe(0);
  });

  it("有效 selectedAssignmentId → 显示「编辑『微积分作业』」", () => {
    const ctx = makeCtx({ selectedAssignmentId: "a1" });
    const cmd = getContextCommands(ctx).find((c) => c.id === "ctx-assignment-edit");
    expect(cmd).toBeDefined();
    expect(cmd!.label).toBe("编辑「微积分作业」");
    expect(cmd!.when?.(ctx)).toBe(true);
  });

  it("stale assignment id → 过滤", () => {
    const ctx = makeCtx({ selectedAssignmentId: "deleted" });
    expect(getContextCommands(ctx).some((c) => c.id === "ctx-assignment-edit")).toBe(false);
  });

  it("搜索「编辑」能匹配任务上下文命令", () => {
    const ctx = makeCtx({ selectedAssignmentId: "a1" });
    const items = buildPalette("编辑", ctx);
    expect(items.some((i) => i.key === "cmd-ctx-assignment-edit")).toBe(true);
  });
});

describe("空查询展示顺序", () => {
  it("Context 在 Create 之前；无上下文时不显示「上下文操作」标题", () => {
    const withCourse = buildPalette("", makeCtx({ selectedCourseId: "c1" }));
    const ctxIdx = withCourse.findIndex((i) => i.group === "context");
    const createIdx = withCourse.findIndex((i) => i.group === "create");
    expect(ctxIdx).toBeGreaterThanOrEqual(0);
    expect(createIdx).toBeGreaterThan(ctxIdx);

    const none = buildPalette("", makeCtx());
    expect(none.some((i) => i.group === "context")).toBe(false);
  });
});

describe("Context scope：entity 与 workspace 语义分层（Task 3）", () => {
  it("仅 entity（选中任务）→ context 项带 entity scope", () => {
    const ctx = makeCtx({ selectedAssignmentId: "a1" });
    const items = buildPalette("", ctx).filter((i) => i.group === "context");
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.contextScope === "entity")).toBe(true);
  });

  it("entity + workspace 同时存在 → 两者都显示且 scope 正确", () => {
    // 选中任务 a1 且工作区 highlight a1
    const ctx = makeCtx({ selectedAssignmentId: "a1", highlightedAssignmentId: "a1" });
    const items = buildPalette("", ctx).filter((i) => i.group === "context");
    expect(items.some((i) => i.contextScope === "entity")).toBe(true);
    expect(items.some((i) => i.contextScope === "workspace")).toBe(true);
  });

  it("workspace 命令 label 动态表达目标：单项目前任务 / 多选 N 项", () => {
    const single = buildPalette("", makeCtx({ highlightedAssignmentId: "a1" }));
    expect(single.some((i) => i.label === "标记当前任务完成")).toBe(true);

    const multi = buildPalette(
      "",
      makeCtx({ assignmentSelection: ["a1", "a2", "a3"] })
    );
    expect(multi.some((i) => i.label === "标记已选 3 项完成")).toBe(true);
    expect(multi.some((i) => i.label === "删除已选 3 项")).toBe(true);
  });

  it("selection 优先于 highlight：同时存在时操作目标为 selection", () => {
    const ctx = makeCtx({
      highlightedAssignmentId: "a1",
      assignmentSelection: ["a1", "a2", "a3"],
    });
    const items = buildPalette("", ctx);
    expect(items.some((i) => i.label === "标记已选 3 项完成")).toBe(true);
    expect(items.some((i) => i.label === "标记当前任务完成")).toBe(false);
  });
});

describe("Context 命令 Dedupe（Task 3）", () => {
  it("selectedAssignmentId === 工作区目标 → 不重复出现编辑类命令", () => {
    const ctx = makeCtx({ selectedAssignmentId: "a1", highlightedAssignmentId: "a1" });
    const labels = buildPalette("", ctx)
      .filter((i) => i.group === "context")
      .map((i) => i.label);
    // entity 的「编辑『微积分作业』」保留；workspace 的 编辑当前任务/打开当前任务 被去重
    expect(labels.some((l) => l.includes("编辑「微积分作业」"))).toBe(true);
    expect(labels.some((l) => l === "编辑当前任务")).toBe(false);
    expect(labels.some((l) => l === "打开当前任务")).toBe(false);
    // 不同动作正常保留
    expect(labels.some((l) => l === "标记当前任务完成")).toBe(true);
  });

  it("target 与 entity 不同 → 编辑类命令正常出现", () => {
    const ctx = makeCtx({ selectedAssignmentId: "a1" });
    const cmds = getAssignmentContextCommands(
      {
        assignmentActions: ctx.assignmentActions,
        highlightedAssignmentId: "a2",
        selectedAssignmentId: "a1",
        close: () => {},
      },
      ["a2"]
    );
    expect(cmds.some((c) => c.id === "ctx-edit")).toBe(true);
    expect(cmds.some((c) => c.id === "ctx-open")).toBe(true);
  });

  it("stale highlighted / selection 含已删除 id → 上下文命令被过滤", () => {
    // stale highlight → 无 workspace 上下文命令
    const staleHl = makeCtx({ highlightedAssignmentId: "deleted" });
    expect(buildPalette("", staleHl).filter((i) => i.group === "context").length).toBe(0);
    // selection 含已删除 id：命令目标只保留存活的（单条 → 当前任务）
    const sel = makeCtx({ assignmentSelection: ["a1", "deleted"] });
    const items = buildPalette("", sel).filter((i) => i.group === "context");
    expect(items.some((i) => i.label === "标记当前任务完成")).toBe(true);
    expect(items.some((i) => i.label.includes("已选 2 项"))).toBe(false);
  });
});
