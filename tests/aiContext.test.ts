import { describe, it, expect, beforeEach, vi } from "vitest";
import { addDays } from "date-fns";
import { MAX_READ_TOOL_CALLS_PER_TURN } from "@/lib/ai/tools/read/executor";

const KEY = "classflow-storage-v2";

function seedStore() {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const local = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now = new Date();
  const dow = now.getDay() === 0 ? 7 : now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dow - 1));
  const startDate = local(monday);

  const state = {
    userProfile: {
      name: "测试用户",
      avatarUrl: "https://example.com/avatar.png",
      college: "经管学院",
      grade: "大三",
      studentId: "2023001",
      completedCredits: 10,
      totalCredits: 20,
    },
    semester: { id: "sem_1", name: "测试学期", startDate, totalWeeks: 16 },
    courses: [
      {
        id: "c1", name: "统计学", code: "STAT101", teacher: "李老师", classroom: "教101", credit: 3,
        bgHex: "#E7E3D8", borderHex: "#D5CDBE", textHex: "#313032", description: "统计基础",
        materials: [
          { id: "m1", title: "第三章讲义.pdf", type: "pdf", size: "2 MB", uploadDate: "2026-03-01", storageKey: "blob-1" },
          { id: "m2", title: "回归案例.docx", type: "doc", size: "1 MB", uploadDate: "2026-03-05", storageKey: "blob-2" },
        ],
      },
      {
        id: "c2", name: "计量经济学", code: "ECON305", teacher: "王老师", classroom: "教302", credit: 4,
        bgHex: "#DCE6DC", borderHex: "#C4D6C6", textHex: "#313032", description: "", materials: [],
      },
    ],
    schedules: [
      { id: "s1", courseId: "c1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "教101", weeks: "1-16周" },
      // 本周被调课排除
      { id: "s2", courseId: "c1", dayOfWeek: 2, startTime: "10:00", endTime: "11:40", location: "教102", weeks: "1-16周", excludedWeeks: [1] },
      { id: "s3", courseId: "c2", dayOfWeek: 3, startTime: "09:00", endTime: "10:40", location: "教302", weeks: "单周" },
    ],
    assignments: [
      { id: "a1", courseId: "c1", title: "统计学作业", description: "第三章习题", ddl: `${local(addDays(now, 1))}T23:59:00`, priority: "high", status: "todo", progress: 0, tags: ["作业"] },
      { id: "a2", courseId: "c1", title: "统计学报告", description: "回归分析报告", ddl: `${local(addDays(now, -2))}T18:00:00`, priority: "urgent", status: "doing", progress: 40, tags: ["报告"] },
      { id: "a3", courseId: "c1", title: "已完成的作业", description: "", ddl: `${local(addDays(now, 3))}T23:59:00`, priority: "medium", status: "completed", progress: 100, tags: [] },
      { id: "a4", courseId: "c2", title: "计量论文", description: "", ddl: `${local(addDays(now, 10))}T23:59:00`, priority: "low", status: "todo", progress: 0, tags: [] },
    ],
    calendarMarks: [
      { id: "cm1", date: local(addDays(now, 1)), type: "ddl", title: "统计学作业", sourceId: "a1" },
      { id: "cm2", date: local(addDays(now, 5)), type: "exam", title: "计量期中考试" },
    ],
    groupProjects: [
      {
        id: "gp1", courseId: "c1", title: "统计小组项目", description: "案例分析", progress: 50, updatedAt: local(now),
        members: [
          { id: "gm1", name: "张三", role: "leader", major: "统计", avatarUrl: "https://example.com/gm1.png" },
          { id: "gm2", name: "李四", role: "member", major: "金融" },
        ],
        tasks: [
          { id: "gt1", title: "数据收集", assigneeId: "gm1", ddl: `${local(addDays(now, 3))}T20:00:00`, completed: false },
          { id: "gt2", title: "问卷设计", assigneeId: undefined, ddl: `${local(addDays(now, 5))}T18:00:00`, completed: true },
        ],
      },
    ],
    assignmentTimeSlice: "all",
    lastWorkspaceTab: "overview",
    preferences: {
      showWeekends: true, ddlWarningDays: 7, defaultDDLTime: "23:59",
      enableScheduleDirectManipulation: true, enableDDLDirectManipulation: true, motionPreference: "system",
      startupView: "overview", defaultTaskPriority: "medium", defaultTaskStatus: "todo",
      enableSingleKeyShortcuts: true, contentDensity: "comfortable",
    },
  };
  localStorage.setItem(KEY, JSON.stringify({ version: 3, state }));
}

/** 全部相关模块随 store 一起重新加载，避免 resetModules 后的陈旧引用 */
async function freshModules() {
  vi.resetModules();
  const storeMod = await import("@/store/useAppStore");
  const baseCtxMod = await import("@/lib/ai/context/buildBaseContext");
  const selMod = await import("@/lib/ai/context/contextSelection");
  const execMod = await import("@/lib/ai/tools/read/executor");
  return {
    store: storeMod.useAppStore,
    buildBaseContext: baseCtxMod.buildBaseContext,
    buildAutoContextRefs: selMod.buildAutoContextRefs,
    resolveContextRefs: selMod.resolveContextRefs,
    refsForPrompt: selMod.refsForPrompt,
    replaceEntryRefs: selMod.replaceEntryRefs,
    assignmentEntryRef: (await import("@/lib/ai/context/handoff")).assignmentEntryRef,
    courseEntryRef: (await import("@/lib/ai/context/handoff")).courseEntryRef,
    groupProjectEntryRef: (await import("@/lib/ai/context/handoff")).groupProjectEntryRef,
    weekEntryRef: (await import("@/lib/ai/context/handoff")).weekEntryRef,
    suggestionsTypeOf: (await import("@/lib/ai/context/handoff")).suggestionsTypeOf,
    dedupeContextRefs: selMod.dedupeContextRefs,
    executeKiroReadTool: execMod.executeKiroReadTool,
    getUpcomingAssignments: execMod.getUpcomingAssignments,
    getWeekSchedule: execMod.getWeekSchedule,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("Base Context（安全字段）", () => {
  it("包含 timezone / semester / safe profile / summary", async () => {
    seedStore();
    const { buildBaseContext } = await freshModules();
    const ctx = buildBaseContext();
    expect(ctx.version).toBe(1);
    expect(ctx.timezone.length).toBeGreaterThan(0);
    expect(ctx.semester.name).toBe("测试学期");
    expect(ctx.semester.currentWeek).toBeGreaterThanOrEqual(1);
    expect(ctx.profile.name).toBe("测试用户");
    expect(ctx.summary.courseCount).toBe(2);
    expect(ctx.summary.assignmentCount).toBe(4);
    expect(ctx.summary.groupProjectCount).toBe(1);
    expect(ctx.now.length).toBeGreaterThan(0);
  });

  it("排除 studentId / avatarUrl / API Key / Blob / 完整业务实体", async () => {
    seedStore();
    const { buildBaseContext } = await freshModules();
    const ctx = buildBaseContext();
    const raw = JSON.stringify(ctx);
    expect(ctx.profile).not.toHaveProperty("studentId");
    expect(ctx.profile).not.toHaveProperty("avatarUrl");
    expect(raw).not.toContain("2023001");
    expect(raw).not.toContain("avatar");
    expect(raw).not.toContain("storageKey");
    expect(raw).not.toContain("blob-1");
    expect(raw).not.toContain("apiKey");
    expect(raw).not.toContain("assignments");
    expect(raw).not.toContain("courses");
    expect(ctx.summary.assignmentCount).toBe(4);
  });
});

describe("Context Selection", () => {
  it("自动 Context：选中课程/任务 + 本周", async () => {
    seedStore();
    const { store, buildAutoContextRefs } = await freshModules();
    store.getState().setSelectedCourseId("c1");
    store.getState().setSelectedAssignmentId("a1");
    const refs = buildAutoContextRefs(store.getState());
    const kinds = refs.map((r) => r.kind);
    expect(kinds).toContain("course");
    expect(kinds).toContain("assignment");
    expect(kinds).toContain("week");
    expect(refs.find((r) => r.kind === "course")?.entityId).toBe("c1");
    expect(refs.find((r) => r.kind === "assignment")?.label).toContain("统计学作业");
  });

  it("抑制的自动 Context 不再生效；手动 refs 保留", async () => {
    const { resolveContextRefs } = await freshModules();
    const auto = [
      { key: "auto-week-current", kind: "week" as const, entityId: "current", label: "本周", source: "auto" as const },
      { key: "auto-course-c1", kind: "course" as const, entityId: "c1", label: "当前课程", source: "auto" as const },
    ];
    const manual = [{ key: "manual-course-c2", kind: "course" as const, entityId: "c2", label: "统计学", source: "manual" as const }];
    const entry = [{ key: "entry-course-c3", kind: "course" as const, entityId: "c3", label: "高数", source: "entry" as const }];
    const active = resolveContextRefs(auto, manual, entry, ["auto-course-c1"]);
    expect(active.map((r) => r.key)).toEqual(["auto-week-current", "entry-course-c3", "manual-course-c2"]);
  });

  it("传给模型的引用只有 kind/id/label", async () => {
    const { refsForPrompt } = await freshModules();
    const refs = [{ key: "k", kind: "course" as const, entityId: "c1", label: "统计学", source: "manual" as const }];
    expect(refsForPrompt(refs)).toEqual([{ kind: "course", id: "c1", label: "统计学" }]);
  });
});

describe("Entry Context（handoff）", () => {
  it("存在的实体生成 entry ref；kind/label/source 正确", async () => {
    seedStore();
    const { store, assignmentEntryRef, courseEntryRef, groupProjectEntryRef, weekEntryRef } = await freshModules();
    const s = store.getState();
    const a = assignmentEntryRef(s, "a1");
    expect(a).toEqual({ key: "entry-assignment-a1", kind: "assignment", entityId: "a1", label: "任务 · 统计学作业", source: "entry" });
    const c = courseEntryRef(s, "c1");
    expect(c?.kind).toBe("course");
    expect(c?.label).toContain("统计学");
    const g = groupProjectEntryRef(s, "gp1");
    expect(g?.kind).toBe("group-project");
    const w = weekEntryRef(3);
    expect(w).toEqual({ key: "entry-week-3", kind: "week", entityId: "3", label: "时间范围 · 第 3 周", source: "entry" });
  });

  it("不存在的实体返回 null（不制造假引用）", async () => {
    seedStore();
    const { store, assignmentEntryRef, courseEntryRef, groupProjectEntryRef } = await freshModules();
    const s = store.getState();
    expect(assignmentEntryRef(s, "nope")).toBeNull();
    expect(courseEntryRef(s, "nope")).toBeNull();
    expect(groupProjectEntryRef(s, "nope")).toBeNull();
  });

  it("replaceEntryRefs：新入口替换旧入口（不累积）；手动 refs 不受影响", async () => {
    const { replaceEntryRefs } = await freshModules();
    const prev = [{ key: "entry-course-c1", kind: "course" as const, entityId: "c1", label: "统计学", source: "entry" as const }];
    const next = [{ key: "entry-assignment-a2", kind: "assignment" as const, entityId: "a2", label: "报告", source: "entry" as const }];
    expect(replaceEntryRefs(prev, next)).toEqual(next);
  });

  it("suggestionsTypeOf：未知 kind（material 等）回退 generic", async () => {
    const { suggestionsTypeOf } = await freshModules();
    expect(suggestionsTypeOf({ key: "k", kind: "assignment", entityId: "a1", label: "任务", source: "entry" })).toBe("assignment");
    expect(suggestionsTypeOf({ key: "k", kind: "material", entityId: "m1", label: "资料", source: "entry" })).toBe("generic");
  });

  it("dedupe：auto 与 entry 同实体只保留一个；manual 优先", async () => {
    const { dedupeContextRefs } = await freshModules();
    const autoCourse = { key: "auto-course-c1", kind: "course" as const, entityId: "c1", label: "当前课程 · 统计学", source: "auto" as const };
    const entryCourse = { key: "entry-course-c1", kind: "course" as const, entityId: "c1", label: "课程 · 统计学", source: "entry" as const };
    const manualCourse = { key: "manual-course-c1", kind: "course" as const, entityId: "c1", label: "统计学", source: "manual" as const };
    const refs = dedupeContextRefs([autoCourse, entryCourse], 3);
    expect(refs).toEqual([entryCourse]);
    expect(dedupeContextRefs([autoCourse, entryCourse, manualCourse], 3)).toEqual([manualCourse]);
  });

  it("dedupe：week 实体——entry 周次与当前周相同视为同一实体", async () => {
    const { dedupeContextRefs } = await freshModules();
    const autoWeek = { key: "auto-week-current", kind: "week" as const, entityId: "current", label: "时间范围 · 本周（第 3 周）", source: "auto" as const };
    const entryWeek3 = { key: "entry-week-3", kind: "week" as const, entityId: "3", label: "时间范围 · 第 3 周", source: "entry" as const };
    const entryWeek5 = { key: "entry-week-5", kind: "week" as const, entityId: "5", label: "时间范围 · 第 5 周", source: "entry" as const };
    // 当前周 = 3：entry 第 3 周与本周去重（entry 优先），第 5 周保留
    const refs = dedupeContextRefs([autoWeek, entryWeek3, entryWeek5], 3);
    expect(refs.map((r) => r.key)).toEqual(["entry-week-3", "entry-week-5"]);
    // 当前周 = 5：保留第 5 周 entry，去掉本周 auto
    const refs2 = dedupeContextRefs([autoWeek, entryWeek3, entryWeek5], 5);
    expect(refs2.map((r) => r.key)).toEqual(["entry-week-3", "entry-week-5"]);
  });

  it("dedupe：不同实体不被误删；无 currentWeek 时按原样处理", async () => {
    const { dedupeContextRefs } = await freshModules();
    const a = { key: "auto-course-c1", kind: "course" as const, entityId: "c1", label: "统计学", source: "auto" as const };
    const b = { key: "auto-course-c2", kind: "course" as const, entityId: "c2", label: "高数", source: "auto" as const };
    expect(dedupeContextRefs([a, b], 3).length).toBe(2);
    const w = { key: "entry-week-2", kind: "week" as const, entityId: "2", label: "第 2 周", source: "entry" as const };
    expect(dedupeContextRefs([w], undefined).length).toBe(1);
  });
});

describe("Read Tool Executor", () => {
  it("search_courses：按名称/教师匹配，多结果返回候选", async () => {
    seedStore();
    const { store, executeKiroReadTool } = await freshModules();
    const state = store.getState();
    const r = executeKiroReadTool("search_courses", { query: "统计" }, state) as { ok: true; data: { id: string; name: string }[] };
    expect(r.ok).toBe(true);
    expect(r.data.map((c) => c.id)).toContain("c1");
    const byTeacher = executeKiroReadTool("search_courses", { query: "王老师" }, state) as { ok: true; data: { id: string }[] };
    expect(byTeacher.data[0].id).toBe("c2");
  });

  it("get_course：返回排课摘要与资料 metadata（不含 storageKey/Blob）", async () => {
    seedStore();
    const { store, executeKiroReadTool } = await freshModules();
    const state = store.getState();
    const r = executeKiroReadTool("get_course", { courseId: "c1" }, state) as {
      ok: true;
      data: { materials: { id: string; title: string; storageKey?: string }[] };
    };
    expect(r.ok).toBe(true);
    expect(r.data.materials.length).toBe(2);
    expect(r.data.materials[0].title).toBe("第三章讲义.pdf");
    expect(r.data.materials[0]).not.toHaveProperty("storageKey");
    expect(JSON.stringify(r)).not.toContain("blob-1");
  });

  it("get_week_schedule：默认当前周；excludedWeeks 的课不返回", async () => {
    seedStore();
    const { store, getWeekSchedule } = await freshModules();
    const state = store.getState();
    const r = getWeekSchedule(state, {}) as { ok: true; data: { week: number; entries: { courseId: string }[] } };
    expect(r.ok).toBe(true);
    const entries = r.data.entries;
    // s2（周二 10:00）第 1 周被 excludedWeeks: [1] 排除；s1（周一）生效；s3 单周第 1 周生效
    expect(entries.some((e) => e.courseId === "c1")).toBe(true);
    expect(entries.filter((e) => e.courseId === "c1").length).toBe(1);
    expect(entries.some((e) => e.courseId === "c2")).toBe(true);
  });

  it("search_assignments：due=overdue / 按课程过滤 / 按状态过滤", async () => {
    seedStore();
    const { store, executeKiroReadTool } = await freshModules();
    const state = store.getState();
    const overdue = executeKiroReadTool("search_assignments", { due: "overdue" }, state) as { ok: true; data: { id: string }[] };
    expect(overdue.data.map((a) => a.id)).toContain("a2");
    expect(overdue.data.map((a) => a.id)).not.toContain("a3");
    const byCourse = executeKiroReadTool("search_assignments", { courseId: "c2" }, state) as { ok: true; data: { id: string }[] };
    expect(byCourse.data.map((a) => a.id)).toEqual(["a4"]);
    const byStatus = executeKiroReadTool("search_assignments", { status: "completed" }, state) as { ok: true; data: { id: string }[] };
    expect(byStatus.data.map((a) => a.id)).toEqual(["a3"]);
  });

  it("get_upcoming_assignments：排除 completed、升序、isOverdue 标记、limit 生效", async () => {
    seedStore();
    const { store, getUpcomingAssignments } = await freshModules();
    const state = store.getState();
    const r = getUpcomingAssignments(state, { days: 7, limit: 10 }) as {
      ok: true;
      data: { items: { id: string; isOverdue: boolean }[] };
    };
    expect(r.ok).toBe(true);
    const ids = r.data.items.map((i) => i.id);
    expect(ids).not.toContain("a3"); // completed 排除
    expect(ids).not.toContain("a4"); // +10 天超出 7 天窗口
    expect(ids).toContain("a2"); // 逾期在窗口内，isOverdue=true
    expect(ids).toContain("a1");
    expect(r.data.items.find((i) => i.id === "a2")?.isOverdue).toBe(true);
    expect(r.data.items.find((i) => i.id === "a1")?.isOverdue).toBe(false);
    expect(ids.indexOf("a2")).toBeLessThan(ids.indexOf("a1"));

    const limited = getUpcomingAssignments(state, { days: 7, limit: 1 }) as { ok: true; data: { items: unknown[] } };
    expect(limited.data.items.length).toBe(1);
    const outOfRange = getUpcomingAssignments(state, { days: 31 }) as { ok: false; code: string };
    expect(outOfRange.ok).toBe(false);
    expect(outOfRange.code).toBe("INVALID_INPUT");
  });

  it("get_group_tasks：本地 DDL 原样保留（不做 UTC 转换）；assignee 可过滤", async () => {
    seedStore();
    const { store, executeKiroReadTool } = await freshModules();
    const state = store.getState();
    const r = executeKiroReadTool("get_group_tasks", { projectId: "gp1", assigneeId: "gm1" }, state) as {
      ok: true;
      data: { ddl: string; assigneeName: string | null; completed: boolean }[];
    };
    expect(r.ok).toBe(true);
    expect(r.data.length).toBe(1);
    expect(r.data[0].assigneeName).toBe("张三");
    expect(r.data[0].ddl).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/); // 本地 wall-clock，无 Z
    expect(r.data[0].ddl.endsWith("Z")).toBe(false);

    const all = executeKiroReadTool("get_group_tasks", { projectId: "gp1" }, state) as { ok: true; data: { assigneeName: string | null }[] };
    expect(all.data.find((t) => t.assigneeName === null)).toBeTruthy(); // 未分配 → null，不猜
  });

  it("get_group_project：不含 avatarUrl", async () => {
    seedStore();
    const { store, executeKiroReadTool } = await freshModules();
    const state = store.getState();
    const r = executeKiroReadTool("get_group_project", { projectId: "gp1" }, state);
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain("avatar");
  });

  it("get_calendar_range：90 天上限；类型过滤；DDL 关联任务信息", async () => {
    seedStore();
    const { store, executeKiroReadTool } = await freshModules();
    const state = store.getState();
    const r = executeKiroReadTool("get_calendar_range", { startDate: "2026-01-01", endDate: "2026-04-02" }, state) as { ok: false; code: string };
    expect(r.code).toBe("OUT_OF_RANGE");

    const now = new Date();
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const local = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const ok = executeKiroReadTool(
      "get_calendar_range",
      { startDate: local(addDays(now, 0)), endDate: local(addDays(now, 6)), types: ["ddl"] },
      state
    ) as { ok: true; data: { title: string; assignmentTitle?: string }[] };
    expect(ok.ok).toBe(true);
    expect(ok.data.length).toBe(1);
    expect(ok.data[0].assignmentTitle).toBe("统计学作业");
  });

  it("get_material_metadata：materialId 直接定位；未知 → NOT_FOUND", async () => {
    seedStore();
    const { store, executeKiroReadTool } = await freshModules();
    const state = store.getState();
    const r = executeKiroReadTool("get_material_metadata", { materialId: "m2" }, state) as {
      ok: true;
      data: { courseName: string; material: { id: string; title: string } };
    };
    expect(r.data.courseName).toBe("统计学");
    expect(r.data.material.title).toBe("回归案例.docx");
    const nf = executeKiroReadTool("get_material_metadata", { materialId: "nope" }, state) as { ok: false; code: string };
    expect(nf.code).toBe("NOT_FOUND");
  });

  it("Entity 不存在 → NOT_FOUND（不猜、不 fallback）", async () => {
    seedStore();
    const { store, executeKiroReadTool } = await freshModules();
    const state = store.getState();
    const r = executeKiroReadTool("get_assignment", { assignmentId: "ghost" }, state) as { ok: false; code: string; message: string };
    expect(r.ok).toBe(false);
    expect(r.code).toBe("NOT_FOUND");
    expect(r.message.length).toBeGreaterThan(0);
    const course = executeKiroReadTool("get_course", { courseId: "ghost" }, state) as { ok: false; code: string };
    expect(course.code).toBe("NOT_FOUND");
  });

  it("非法输入 → INVALID_INPUT（不崩溃）", async () => {
    seedStore();
    const { store, executeKiroReadTool } = await freshModules();
    const state = store.getState();
    const r = executeKiroReadTool("get_upcoming_assignments", { days: "abc" }, state) as { ok: false; code: string };
    expect(r.code).toBe("INVALID_INPUT");
    const unknown = executeKiroReadTool("not_a_tool", {}, state) as { ok: false; code: string };
    expect(unknown.code).toBe("INVALID_INPUT");
  });

  it("只读安全：执行全部工具前后业务数据快照完全一致（无 mutation）", async () => {
    seedStore();
    const { store, executeKiroReadTool } = await freshModules();
    const state = store.getState();
    const snapshot = () =>
      JSON.stringify({
        courses: state.courses,
        schedules: state.schedules,
        assignments: state.assignments,
        calendarMarks: state.calendarMarks,
        groupProjects: state.groupProjects,
      });
    const before = snapshot();

    const calls: { name: string; input: unknown }[] = [
      { name: "get_current_context", input: {} },
      { name: "get_user_study_profile", input: {} },
      { name: "search_courses", input: {} },
      { name: "get_course", input: { courseId: "c1" } },
      { name: "get_week_schedule", input: {} },
      { name: "search_assignments", input: {} },
      { name: "get_assignment", input: { assignmentId: "a1" } },
      { name: "get_upcoming_assignments", input: {} },
      { name: "search_group_projects", input: {} },
      { name: "get_group_project", input: { projectId: "gp1" } },
      { name: "get_group_tasks", input: { projectId: "gp1" } },
      { name: "get_calendar_range", input: { startDate: "2026-01-01", endDate: "2026-01-07" } },
      { name: "get_material_metadata", input: {} },
    ];
    for (const c of calls) {
      executeKiroReadTool(c.name, c.input, state);
    }
    expect(snapshot()).toBe(before);
  });

  it("循环保护上限常量存在且为正", async () => {
    await freshModules();
    expect(MAX_READ_TOOL_CALLS_PER_TURN).toBe(10);
  });
});
