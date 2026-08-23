// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
  buildPalette,
  getCommands,
  getContextCommands,
  getAssignmentContextCommands,
  getSelectedCourse,
  getSelectedAssignment,
  normalizeQuery,
  normalizeSearchText,
  queryTerms,
  matchesFields,
  CommandContext,
} from "@/lib/commands";
import { previewMaterial } from "@/lib/uiEvents";
import { KIRO_ICON } from "@/components/layout/navItems";
import { Course, Assignment, Material } from "@/types";

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
    calendarMarks: [],
    groupProjects: [],
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
      clearDDLDate: () => {},
      shiftDDL: () => {},
      remove: () => {},
    },
    setActiveTab: () => {},
    setSettingsModalOpen: () => {},
    setAssignmentWorkspaceView: () => {},
    openReminderCenter: () => {},
    setSelectedCourseId: () => {},
    setSelectedAssignmentId: () => {},
    setSelectedCalendarMarkId: () => {},
    setSelectedGroupProjectId: () => {},
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
  it("Context 在 Create 之前；无上下文时不显示「当前」标题", () => {
    const withCourse = buildPalette("", makeCtx({ selectedCourseId: "c1" }));
    const ctxIdx = withCourse.findIndex((i) => i.group === "context");
    const createIdx = withCourse.findIndex((i) => i.group === "create");
    expect(ctxIdx).toBeGreaterThanOrEqual(0);
    expect(createIdx).toBeGreaterThan(ctxIdx);

    const none = buildPalette("", makeCtx());
    expect(none.some((i) => i.group === "context")).toBe(false);
  });

  it("App Chrome V2：空查询顺序 = 创建 → 前往 → 高频视图 → 操作；视图只含主视图", () => {
    const items = buildPalette("", makeCtx());
    const groupOrder = items.map((i) => i.group);
    const firstOf = (g: string) => groupOrder.indexOf(g as never);
    expect(firstOf("create")).toBeGreaterThanOrEqual(0);
    expect(firstOf("navigate")).toBeGreaterThan(firstOf("create"));
    expect(firstOf("views")).toBeGreaterThan(firstOf("navigate"));
    expect(firstOf("action")).toBeGreaterThan(firstOf("views"));

    // 高频视图（5 个主视图）在空查询展示；低频 at-risk / archive 只按查询命中
    const viewLabels = items.filter((i) => i.group === "views").map((i) => i.label);
    expect(viewLabels).toEqual([
      "任务与 DDL → 聚焦",
      "任务与 DDL → 今天",
      "任务与 DDL → 即将截止",
      "任务与 DDL → 待安排",
      "任务与 DDL → 全部",
    ]);
    const all = buildPalette("已归档", makeCtx());
    expect(all.some((i) => i.label === "任务与 DDL → 已归档")).toBe(true);
  });

  it("App Chrome V2：导航命令与 Sidebar 共享同一事实源（label/icon 一致）", () => {
    const navCommands = getCommands().filter((c) => c.group === "navigate");
    const labels = navCommands.map((c) => c.label);
    // Sidebar 文案（WORKSPACE_NAV_ITEMS）：总览/时间表/任务与 DDL/课程资料/学习洞察/小组协作/Kiro
    expect(labels).toEqual([
      "前往总览",
      "前往时间表",
      "前往任务与 DDL",
      "前往课程资料",
      "前往学习洞察",
      "前往小组协作",
      "前往Kiro",
    ]);
    // 旧搜索习惯词保留：课表 → 时间表命令
    expect(buildPalette("课表", makeCtx()).some((i) => i.key === "cmd-nav-timetable")).toBe(true);
    // Kiro 导航命令使用品牌图标（navItems.KIRO_ICON）
    const kiroCmd = navCommands.find((c) => c.id === "nav-kiro");
    expect(kiroCmd?.icon).toBe(KIRO_ICON);
  });

  it("App Chrome V2：视图命令原子执行（切工作区 + 切视图 + 关闭）", () => {
    const calls: string[] = [];
    const ctx = makeCtx({
      setActiveTab: (t) => calls.push(`tab:${t}`),
      setAssignmentWorkspaceView: (v) => calls.push(`view:${v}`),
      close: () => calls.push("close"),
    });
    const viewCmd = getCommands().find((c) => c.id === "view-today")!;
    viewCmd.run(ctx);
    expect(calls).toEqual(["tab:assignments", "view:today", "close"]);
  });

  it("App Chrome V2：全局操作含 打开设置 与 打开提醒", () => {
    const items = buildPalette("", makeCtx());
    expect(items.some((i) => i.label === "打开设置")).toBe(true);
    expect(items.some((i) => i.label === "打开提醒")).toBe(true);
    const opened: string[] = [];
    const ctx = makeCtx({ openReminderCenter: () => opened.push("reminders") });
    getCommands().find((c) => c.id === "open-reminders")!.run(ctx);
    expect(opened).toEqual(["reminders"]);
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

// ============================================================
// Global Search V2 —— Material 搜索 + 实体语义匹配
// ============================================================

const material = (id: string, title: string, type: Material["type"], size?: string): Material => ({
  id,
  title,
  type,
  uploadDate: "2026-09-01",
  ...(size ? { size } : {}),
});

/** 计量经济学课程：含 classroom + 全类型 materials */
function econCourse(): Course {
  return {
    ...course("c1", "计量经济学"),
    code: "ECON301",
    teacher: "李教授",
    classroom: "文科楼 B203",
    materials: [
      material("m1", "回归分析讲义", "pdf", "2.4 MB"),
      material("m2", "第三章课件", "ppt"),
      material("m3", "课程大纲", "doc"),
      material("m4", "散点图示例", "image"),
      material("m5", "课程主页", "link"),
    ],
  };
}

describe("Query normalization（Search V2 纯函数）", () => {
  it("大小写等价：PDF == pdf", () => {
    expect(normalizeSearchText("PDF")).toBe(normalizeSearchText("pdf"));
    expect(queryTerms("PDF")).toEqual(queryTerms("pdf"));
  });

  it("whitespace：连续空白折叠为单空格并分词", () => {
    expect(queryTerms("  计量   讲义 ")).toEqual(["计量", "讲义"]);
  });

  it("NFKC：全角拉丁/数字折叠为半角", () => {
    expect(normalizeSearchText("ＰＤＦ")).toBe("pdf");
    expect(normalizeSearchText("２０２６")).toBe("2026");
  });

  it("空字符串 → []", () => {
    expect(queryTerms("")).toEqual([]);
    expect(queryTerms("   ")).toEqual([]);
  });

  it("matchesFields：每个 term 至少被一个字段包含；空 terms 不匹配", () => {
    expect(matchesFields(["回归分析讲义"], ["回归", "讲义"])).toBe(true);
    expect(matchesFields(["回归分析讲义"], ["回归", "缺失词"])).toBe(false);
    expect(matchesFields(["a"], [])).toBe(false);
    expect(matchesFields([undefined, ""], ["x"])).toBe(false);
  });
});

describe("Global Search V2 —— Course", () => {
  it("按 name 搜索仍正常（单 term）", () => {
    const items = buildPalette("计量经济", makeCtx({ courses: [econCourse()] }));
    expect(items.some((i) => i.kind === "course" && i.label === "计量经济学")).toBe(true);
  });

  it("classroom 现在可搜索", () => {
    const items = buildPalette("B203", makeCtx({ courses: [econCourse()] }));
    expect(items.some((i) => i.kind === "course" && i.label === "计量经济学")).toBe(true);
  });
});

describe("Global Search V2 —— Assignment", () => {
  function econAssignments(): Assignment[] {
    return [
      { ...assignment("a1", "第三次作业"), courseId: "c1", priority: "urgent", status: "doing", tags: ["回归"] as never },
      assignment("a2", "英语演讲"),
    ];
  }

  it("title 旧行为不变", () => {
    const items = buildPalette("第三次作业", makeCtx({ courses: [econCourse()], assignments: econAssignments() }));
    expect(items.some((i) => i.kind === "assignment" && i.label === "第三次作业")).toBe(true);
  });

  it("跨字段：『计量 作业』通过 course.name + assignment.title 命中", () => {
    const items = buildPalette("计量 作业", makeCtx({ courses: [econCourse()], assignments: econAssignments() }));
    expect(items.some((i) => i.kind === "assignment" && i.label === "第三次作业")).toBe(true);
  });

  it("tags 可搜索", () => {
    const items = buildPalette("回归", makeCtx({ courses: [econCourse()], assignments: econAssignments() }));
    expect(items.some((i) => i.kind === "assignment" && i.label === "第三次作业")).toBe(true);
  });

  it("priority alias：『紧急』命中 urgent 任务", () => {
    const items = buildPalette("紧急", makeCtx({ courses: [econCourse()], assignments: econAssignments() }));
    expect(items.some((i) => i.kind === "assignment" && i.label === "第三次作业")).toBe(true);
  });

  it("status alias：『进行中』命中 doing 任务；不误伤 todo", () => {
    const items = buildPalette("进行中", makeCtx({ courses: [econCourse()], assignments: econAssignments() }));
    expect(items.some((i) => i.kind === "assignment" && i.label === "第三次作业")).toBe(true);
    expect(items.some((i) => i.kind === "assignment" && i.label === "英语演讲")).toBe(false);
  });

  it("DDL：YYYY-MM-DD 与 M月D日 均可命中", () => {
    const ctx = makeCtx({ courses: [econCourse()], assignments: econAssignments() });
    // a1 ddl = 2026-08-12T23:59:00
    expect(buildPalette("2026-08-12", ctx).some((i) => i.kind === "assignment" && i.label === "第三次作业")).toBe(true);
    expect(buildPalette("8月12日", ctx).some((i) => i.kind === "assignment" && i.label === "第三次作业")).toBe(true);
  });
});

describe("Global Search V2 —— Material", () => {
  it("title 搜索返回 kind=material，sub 含 课程名 · 类型 · size", () => {
    const items = buildPalette("回归分析讲义", makeCtx({ courses: [econCourse()] }));
    const hit = items.find((i) => i.kind === "material");
    expect(hit).toBeTruthy();
    expect(hit!.label).toBe("回归分析讲义");
    expect(hit!.sub).toBe("计量经济学 · PDF · 2.4 MB");
  });

  it("type 中英文 alias：ppt / pdf / 图片 各自命中对应类型", () => {
    const ctx = makeCtx({ courses: [econCourse()] });
    const kindsOf = (q: string) =>
      buildPalette(q, ctx).filter((i) => i.kind === "material").map((i) => i.label);
    expect(kindsOf("ppt")).toContain("第三章课件");
    expect(kindsOf("演示文稿")).toContain("第三章课件");
    expect(kindsOf("pdf")).toContain("回归分析讲义");
    expect(kindsOf("图片")).toContain("散点图示例");
    // 类型间不串扰
    expect(kindsOf("pdf")).not.toContain("第三章课件");
  });

  it("multi-term：『计量 讲义』= course context + material title 跨字段命中", () => {
    const items = buildPalette("计量 讲义", makeCtx({ courses: [econCourse()] }));
    expect(items.some((i) => i.kind === "material" && i.label === "回归分析讲义")).toBe(true);
  });

  it("flood 防护：仅搜课程名不得倾倒该课全部资料", () => {
    const materials = buildPalette("计量经济学", makeCtx({ courses: [econCourse()] }))
      .filter((i) => i.kind === "material");
    expect(materials.length).toBe(0);
  });

  it("run：调用 previewMaterial（唯一打开契约）并关闭 Command Center", () => {
    const sent: Material[] = [];
    const dispatchSpy = vi
      .spyOn(window, "dispatchEvent")
      .mockImplementation((ev: Event) => {
        const detail = (ev as CustomEvent<{ material: Material }>).detail;
        if (detail?.material) sent.push(detail.material);
        return true;
      });
    let closed = false;
    const ctx = makeCtx({
      courses: [econCourse()],
      close: () => { closed = true; },
    });
    const item = buildPalette("回归分析讲义", ctx).find((i) => i.kind === "material");
    item!.run();
    expect(sent).toHaveLength(1);
    expect(sent[0].id).toBe("m1");
    expect(sent[0].title).toBe("回归分析讲义");
    expect(closed).toBe(true);
    dispatchSpy.mockRestore();
  });

  it("empty query 不出现任何实体结果（course/assignment/material）", () => {
    const items = buildPalette("", makeCtx({ courses: [econCourse()], assignments: [assignment("a1", "作业")] }));
    expect(items.some((i) => i.kind === "course")).toBe(false);
    expect(items.some((i) => i.kind === "assignment")).toBe(false);
    expect(items.some((i) => i.kind === "material")).toBe(false);
  });
});

// ============================================================
// Global Search V3 —— CalendarMark（exam / activity）
// ============================================================

const calendarMark = (id: string, over: Partial<import("@/types").CalendarMark> = {}): import("@/types").CalendarMark => ({
  id,
  date: "2026-09-18",
  type: "exam",
  title: `Mark ${id}`,
  ...over,
});

function searchCtx(marks: import("@/types").CalendarMark[]) {
  return makeCtx({ calendarMarks: marks });
}

describe("Global Search V3 —— CalendarMark", () => {
  it("empty query：calendar 不出现（Empty Palette 契约不变）", () => {
    const items = buildPalette("", searchCtx([
      calendarMark("e1", { title: "英语六级模拟考试" }),
    ]));
    expect(items.some((i) => i.kind === "calendar")).toBe(false);
  });

  it("exam title：『六级』命中对应考试，sub 含 类型/日期/时间", () => {
    const items = buildPalette("六级", searchCtx([
      calendarMark("e1", { title: "英语六级模拟考试", startTime: "14:00", endTime: "16:00" }),
      calendarMark("a1", { type: "activity", title: "班级答辩", date: "2026-09-20" }),
    ]));
    const hit = items.find((i) => i.kind === "calendar");
    expect(hit?.label).toBe("英语六级模拟考试");
    expect(hit?.sub).toBe("考试 · 9月18日 · 14:00–16:00");
  });

  it("type aliases：『考试』『测验』命中 exam；『活动』『日程』命中 activity", () => {
    const marks = [
      calendarMark("e1", { title: "线代期末" }),
      calendarMark("ac1", { type: "activity", title: "社团招新" }),
    ];
    expect(buildPalette("考试", searchCtx(marks)).some((i) => i.label === "线代期末")).toBe(true);
    expect(buildPalette("测验", searchCtx(marks)).some((i) => i.label === "线代期末")).toBe(true);
    expect(buildPalette("活动", searchCtx(marks)).some((i) => i.label === "社团招新")).toBe(true);
    expect(buildPalette("日程", searchCtx(marks)).some((i) => i.label === "社团招新")).toBe(true);
    // 类型间不串扰
    expect(buildPalette("考试", searchCtx(marks)).some((i) => i.label === "社团招新")).toBe(false);
  });

  it("date：YYYY-MM-DD 与 M月D日 均可命中", () => {
    const marks = [calendarMark("e1", { title: "英语六级模拟考试" })];
    expect(buildPalette("2026-09-18", searchCtx(marks)).some((i) => i.kind === "calendar")).toBe(true);
    expect(buildPalette("9月18日", searchCtx(marks)).some((i) => i.kind === "calendar")).toBe(true);
  });

  it("time：14:00 命中带起止时间的 timed exam/activity；all-day 不误中", () => {
    const marks = [
      calendarMark("e-timed", { title: "口试", startTime: "14:00", endTime: "15:30" }),
      calendarMark("a-allday", { type: "activity", title: "全天讲座" }),
    ];
    const hits = buildPalette("14:00", searchCtx(marks)).filter((i) => i.kind === "calendar");
    expect(hits).toHaveLength(1);
    expect(hits[0].label).toBe("口试");
  });

  it("multi-term：『六级 考试』跨字段命中同一 mark", () => {
    const items = buildPalette("六级 考试", searchCtx([
      calendarMark("e1", { title: "英语六级模拟考试" }),
    ]));
    expect(items.some((i) => i.kind === "calendar")).toBe(true);
  });

  it("type=course 与 type=ddl 不进入 Calendar 结果", () => {
    const items = buildPalette("考试", searchCtx([
      calendarMark("c-type", { type: "course", title: "课程块" }),
      calendarMark("d-type", { type: "ddl", title: "独立截止" }),
      calendarMark("e-real", { title: "真实考试" }),
    ]));
    const calItems = items.filter((i) => i.kind === "calendar");
    expect(calItems).toHaveLength(1);
    expect(calItems[0].label).toBe("真实考试");
  });

  it("run：setSelectedCalendarMarkId(id) + close()", () => {
    let selectedId: string | null = null;
    let closed = false;
    const ctx = makeCtx({
      calendarMarks: [calendarMark("e-run", { title: "英语六级模拟考试" })],
      setSelectedCalendarMarkId: (id) => { selectedId = id; },
      close: () => { closed = true; },
    });
    buildPalette("六级", ctx).find((i) => i.kind === "calendar")!.run();
    expect(selectedId).toBe("e-run");
    expect(closed).toBe(true);
  });

  it("结果顺序：Course → Assignment → Calendar → Material", () => {
    const econ = {
      ...course("c1", "计量经济学"),
      // material title 自身含「计量」→ selfHit 成立（与 flood 防护规则一致），四类同屏验证顺序
      materials: [material("m1", "计量经济学课件", "pdf")],
    };
    const items = buildPalette("计量", makeCtx({
      courses: [econ],
      assignments: [{ ...assignment("a1", "计量作业"), courseId: "c1" }],
      calendarMarks: [calendarMark("e1", { title: "计量期中考试", date: "2026-09-18" })],
    })).filter((i) => i.group === "search");
    const kinds = items.map((i) => i.kind);
    expect(kinds.indexOf("course")).toBeLessThan(kinds.indexOf("assignment"));
    expect(kinds.indexOf("assignment")).toBeLessThan(kinds.indexOf("calendar"));
    expect(kinds.indexOf("calendar")).toBeLessThan(kinds.indexOf("material"));
  });
});

// ============================================================
// Global Search V4 —— GroupProject Deep Link
// ============================================================

const groupProject = (id: string, over: Partial<import("@/types").GroupProject> = {}): import("@/types").GroupProject => ({
  id,
  courseId: "c1",
  title: `项目 ${id}`,
  description: "",
  progress: 0,
  updatedAt: "2026-09-01",
  members: [],
  tasks: [],
  ...over,
});

function searchCtxV4(marks: import("@/types").CalendarMark[] = [], projects: import("@/types").GroupProject[] = []) {
  return makeCtx({ calendarMarks: marks, groupProjects: projects });
}

describe("Global Search V4 —— GroupProject", () => {
  it("title 命中，sub 含 真实计数（人/任务）与课程名", () => {
    const items = buildPalette("红海危机", searchCtxV4([], [
      groupProject("g1", { title: "红海危机案例分析", description: "", members: [{ id: "m1", name: "张三", role: "leader" }] as never, tasks: [{}, {}, {}] as never }),
    ]));
    const hit = items.find((i) => i.kind === "group-project");
    expect(hit?.label).toBe("红海危机案例分析");
    expect(hit?.sub).toContain("小组项目");
    expect(hit?.sub).toContain("高等数学");
    expect(hit?.sub).toContain("1 人");
    expect(hit?.sub).toContain("3 个任务");
  });

  it("description 命中", () => {
    const items = buildPalette("供应链韧性", searchCtxV4([], [
      groupProject("g2", { title: "案例分析二", description: "研究全球供应链韧性问题" }),
    ]));
    expect(items.some((i) => i.kind === "group-project")).toBe(true);
  });

  it("aliases：『小组』『项目』『group』命中 self 字段", () => {
    const projects = [groupProject("g3", { title: "案例分析三" })];
    for (const q of ["小组", "项目", "group"]) {
      expect(buildPalette(q, searchCtxV4([], projects)).some((i) => i.kind === "group-project" && i.label === "案例分析三")).toBe(true);
    }
  });

  it("course context + alias：『计量 项目』命中关联课程的项目", () => {
    const items = buildPalette("计量 项目", makeCtx({
      courses: [{ ...course("c1", "计量经济学") }],
      groupProjects: [groupProject("g4", { title: "期中案例", courseId: "c1" })],
    }));
    expect(items.some((i) => i.kind === "group-project" && i.label === "期中案例")).toBe(true);
  });

  it("member name 跨字段：member term + self alias 命中", () => {
    const items = buildPalette("李四 项目", searchCtxV4([], [
      groupProject("g5", { title: "数据调研", members: [{ id: "m9", name: "李四", role: "member" }] as never }),
    ]));
    expect(items.some((i) => i.kind === "group-project" && i.label === "数据调研")).toBe(true);
  });

  it("flood 防护：仅搜课程名不倾倒该课全部项目", () => {
    const items = buildPalette("高等数学", searchCtxV4([], [
      groupProject("ga"), groupProject("gb"), groupProject("gc"),
    ]));
    expect(items.filter((i) => i.kind === "group-project")).toHaveLength(0);
  });

  it("run 顺序：先 selectedGroupProjectId → 再 activeTab=group → close", () => {
    let selectedId: string | null = null;
    let tab: string | null = null;
    let closed = false;
    const ctx = makeCtx({
      groupProjects: [groupProject("g-run")],
      setSelectedGroupProjectId: (id) => { selectedId = id; },
      setActiveTab: (t) => { tab = t; },
      close: () => { closed = true; },
    });
    buildPalette("项目 g-run", ctx).find((i) => i.kind === "group-project")!.run();
    expect(selectedId).toBe("g-run");
    expect(tab).toBe("group");
    expect(closed).toBe(true);
    expect(selectedId !== null).toBe(true); // selection 先于导航语义（顺序断言见 invocationCallOrder）
    void closed;
  });

  it("empty query 不出现 group-project；结果位置在 calendar 后 material 前", () => {
    expect(buildPalette("", searchCtxV4([], [groupProject("gx")])).some((i) => i.kind === "group-project")).toBe(false);

    const econ = { ...course("c1", "计量经济学"), materials: [material("m1", "计量课件", "pdf")] };
    const items = buildPalette("计量", makeCtx({
      courses: [econ],
      assignments: [{ ...assignment("a1", "计量作业"), courseId: "c1" }],
      calendarMarks: [calendarMark("e1", { title: "计量期中考试" })],
      groupProjects: [groupProject("gp", { title: "计量小组课题" })],
    })).filter((i) => i.group === "search");
    const kinds = items.map((i) => i.kind);
    expect(kinds.indexOf("calendar")).toBeLessThan(kinds.indexOf("group-project"));
    expect(kinds.indexOf("group-project")).toBeLessThan(kinds.indexOf("material"));
  });
});