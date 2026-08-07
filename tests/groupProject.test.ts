import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore } from "@/store/useAppStore";
import { calculateGroupProjectProgress, normalizeGroupProject, normalizeLocalDDL } from "@/lib/groupProject";
import { GroupProject } from "@/types";

describe("calculateGroupProjectProgress", () => {
  it("无任务 = 0%", () => {
    expect(calculateGroupProjectProgress([])).toBe(0);
  });

  it("completed / total * 100", () => {
    const tasks = [
      { id: "t1", title: "a", ddl: "2026-08-10T23:59:00", completed: true },
      { id: "t2", title: "b", ddl: "2026-08-10T23:59:00", completed: true },
      { id: "t3", title: "c", ddl: "2026-08-10T23:59:00", completed: false },
    ] as any;
    expect(calculateGroupProjectProgress(tasks)).toBe(67);
  });
});

describe("normalizeLocalDDL（GroupTask 本地时间模型）", () => {
  it("本地格式原样保留", () => {
    expect(normalizeLocalDDL("2026-08-10T23:59:00")).toBe("2026-08-10T23:59:00");
  });

  it("旧 Z 数据按墙钟重建为本地格式", () => {
    expect(normalizeLocalDDL("2026-08-10T23:59:00.000Z")).toBe("2026-08-10T23:59:00");
  });
});

describe("normalizeGroupProject（v1 → v2）", () => {
  const legacyProject = {
    id: "gp_1",
    courseId: "c_1",
    title: "旧项目",
    description: "",
    progress: 50,
    updatedAt: "2026-08-01",
    members: [
      { id: "m_1", name: "张同学", avatarUrl: "x", role: "leader", major: "经济学" },
      { id: "m_2", name: "李同学", avatarUrl: "y", role: "member", major: "会计学" },
    ],
    tasks: [
      { id: "gt_1", title: "报告", assigneeName: "张同学", assigneeAvatar: "x", ddl: "2026-08-10T23:59:00.000Z", completed: true },
      { id: "gt_2", title: "汇总", assigneeName: "不存在的成员", assigneeAvatar: "y", ddl: "2026-08-12T10:00:00", completed: false },
    ],
  } as unknown as GroupProject;

  it("assigneeName 唯一匹配 → assigneeId；无法唯一匹配 → 未分配；DDL 归一；移除冗余字段", () => {
    const normalized = normalizeGroupProject(legacyProject);
    expect(normalized.tasks[0].assigneeId).toBe("m_1");
    expect(normalized.tasks[0].ddl).toBe("2026-08-10T23:59:00");
    expect((normalized.tasks[0] as any).assigneeName).toBeUndefined();
    expect((normalized.tasks[0] as any).assigneeAvatar).toBeUndefined();
    expect(normalized.tasks[1].assigneeId).toBeUndefined();
    expect(normalized.tasks[1].ddl).toBe("2026-08-12T10:00:00");
    // progress 自动重算（1/2 = 50%）
    expect(normalized.progress).toBe(50);
  });

  it("两个同名成员时 assigneeName 不唯一 → 不猜测", () => {
    const project = {
      ...legacyProject,
      members: [
        { id: "m_1", name: "张同学", role: "leader" },
        { id: "m_2", name: "张同学", role: "member" },
      ],
    } as unknown as GroupProject;
    const normalized = normalizeGroupProject(project);
    expect(normalized.tasks[0].assigneeId).toBeUndefined();
  });
});

describe("小组项目 Store CRUD", () => {
  beforeEach(() => {
    useAppStore.getState().resetAllDataToDefault();
  });

  it("创建项目为空项目：无假任务、无硬编码成员，当前 userProfile 作为 leader", () => {
    useAppStore.getState().updateUserProfile({ name: "测试用户", avatarUrl: "" });
    useAppStore.getState().addGroupProject({ courseId: "c_1", title: "新项目", description: "说明" });

    const project = useAppStore.getState().groupProjects[0];
    expect(project.title).toBe("新项目");
    expect(project.tasks).toHaveLength(0);
    expect(project.members).toHaveLength(1);
    expect(project.members[0].name).toBe("测试用户");
    expect(project.members[0].role).toBe("leader");
    expect(project.members[0].avatarUrl).toBeUndefined();
    expect(project.progress).toBe(0);
    expect(project.id.startsWith("gp_")).toBe(true);
  });

  it("updateGroupProject 更新 title/description/courseId 并刷新 updatedAt（本地日期格式）", () => {
    useAppStore.getState().addGroupProject({ courseId: "c_1", title: "旧标题" });
    const id = useAppStore.getState().groupProjects[0].id;
    // 人为制造过期 updatedAt
    useAppStore.setState((s) => ({
      groupProjects: s.groupProjects.map((p) => (p.id === id ? { ...p, updatedAt: "2020-01-01" } : p)),
    }));

    useAppStore.getState().updateGroupProject(id, { title: "新标题", description: "新说明", courseId: "c_2" });
    const p = useAppStore.getState().groupProjects[0];
    expect(p.title).toBe("新标题");
    expect(p.description).toBe("新说明");
    expect(p.courseId).toBe("c_2");
    // 本地 "YYYY-MM-DD"，非 ISO 带 T；且已刷新
    expect(p.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.updatedAt).not.toBe("2020-01-01");
  });

  it("deleteGroupProject 只删项目，课程保留", () => {
    useAppStore.getState().addGroupProject({ courseId: "c_1", title: "待删" });
    const id = useAppStore.getState().groupProjects[0].id;
    useAppStore.getState().deleteGroupProject(id);
    expect(useAppStore.getState().groupProjects.find((p) => p.id === id)).toBeUndefined();
    expect(useAppStore.getState().courses.find((c) => c.id === "c_1")).toBeTruthy();
  });

  it("成员 CRUD：添加 / 更新 / 删除；删除成员后其任务变为未分配", () => {
    useAppStore.getState().addGroupProject({ courseId: "c_1", title: "P" });
    const id = useAppStore.getState().groupProjects[0].id;

    useAppStore.getState().addGroupMember(id, { name: "成员甲" });
    const member = useAppStore.getState().groupProjects[0].members[1];
    expect(member.role).toBe("member");
    expect(member.id.startsWith("gm_")).toBe(true);

    useAppStore.getState().addGroupTask(id, { title: "任务A", assigneeId: member.id, ddl: "2026-08-10T23:59:00" });
    useAppStore.getState().updateGroupMember(id, { ...member, name: "成员甲改" });
    expect(useAppStore.getState().groupProjects[0].members[1].name).toBe("成员甲改");

    const result = useAppStore.getState().deleteGroupMember(id, member.id);
    expect(result.ok).toBe(true);
    const p = useAppStore.getState().groupProjects[0];
    expect(p.members.find((m) => m.id === member.id)).toBeUndefined();
    expect(p.tasks[0].assigneeId).toBeUndefined(); // 任务保留，负责人变未分配
    expect(p.tasks).toHaveLength(1);
  });

  it("删除最后一个 leader 被阻止", () => {
    useAppStore.getState().updateUserProfile({ name: "组长" });
    useAppStore.getState().addGroupProject({ courseId: "c_1", title: "P" });
    const id = useAppStore.getState().groupProjects[0].id;
    const leaderId = useAppStore.getState().groupProjects[0].members[0].id;

    const result = useAppStore.getState().deleteGroupMember(id, leaderId);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("last_leader");
    expect(useAppStore.getState().groupProjects[0].members).toHaveLength(1);
  });

  it("Task CRUD：add/update/delete + toggle 自动重算 progress + updatedAt 刷新", () => {
    useAppStore.getState().addGroupProject({ courseId: "c_1", title: "P" });
    const id = useAppStore.getState().groupProjects[0].id;

    useAppStore.getState().addGroupTask(id, { title: "T1", ddl: "2026-08-10T23:59:00" });
    useAppStore.getState().addGroupTask(id, { title: "T2", ddl: "2026-08-11T23:59:00" });
    let p = useAppStore.getState().groupProjects[0];
    expect(p.tasks).toHaveLength(2);
    expect(p.tasks[0].id.startsWith("gt_")).toBe(true);
    expect(p.progress).toBe(0);
    const t1 = p.tasks[0];
    const t2 = p.tasks[1];

    // toggle 完成一项 → 50%
    useAppStore.getState().toggleGroupTask(id, t1.id);
    p = useAppStore.getState().groupProjects[0];
    expect(p.progress).toBe(50);

    // updateGroupTask
    useAppStore.getState().updateGroupTask(id, { ...t1, title: "T1改", completed: true });
    p = useAppStore.getState().groupProjects[0];
    expect(p.tasks.find((t) => t.id === t1.id)!.title).toBe("T1改");
    expect(p.progress).toBe(50);

    // 删除已完成任务 → 只剩未完成 → 0%
    useAppStore.getState().deleteGroupTask(id, t1.id);
    p = useAppStore.getState().groupProjects[0];
    expect(p.tasks.map((t) => t.id)).toEqual([t2.id]);
    expect(p.progress).toBe(0);
  });
});

describe("persist v1 → v2 group 迁移", () => {
  it("旧 groupProjects（assigneeName/assigneeAvatar）升级为 assigneeId 且任务/成员不丢失", async () => {
    localStorage.clear();
    localStorage.setItem(
      "classflow-storage-v2",
      JSON.stringify({
        version: 1,
        state: {
          userProfile: { name: "张同学", avatarUrl: "", college: "x", grade: "x", studentId: "1", completedCredits: 0, totalCredits: 10 },
          semester: { id: "s", name: "学期", startDate: "2026-02-23", totalWeeks: 16 },
          courses: [{ id: "c_1", name: "课", code: "C", teacher: "t", classroom: "r", credit: 3, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [] }],
          schedules: [],
          assignments: [],
          calendarMarks: [],
          groupProjects: [
            {
              id: "gp_old",
              courseId: "c_1",
              title: "旧项目",
              description: "",
              progress: 50,
              updatedAt: "2026-08-01",
              members: [
                { id: "m_1", name: "张同学", avatarUrl: "a", role: "leader", major: "经济学" },
                { id: "m_2", name: "李同学", avatarUrl: "b", role: "member", major: "会计学" },
              ],
              tasks: [
                { id: "gt_1", title: "报告", assigneeName: "张同学", assigneeAvatar: "a", ddl: "2026-08-10T23:59:00.000Z", completed: true },
                { id: "gt_2", title: "汇总", assigneeName: "神秘人", assigneeAvatar: "c", ddl: "2026-08-12T10:00:00", completed: false },
              ],
            },
          ],
        },
      })
    );

    vi.resetModules();
    const { useAppStore: freshStore } = await import("@/store/useAppStore");
    const project = freshStore.getState().groupProjects[0];

    // 项目/成员/任务本体不丢失
    expect(project.title).toBe("旧项目");
    expect(project.members).toHaveLength(2);
    expect(project.tasks).toHaveLength(2);
    // assigneeName 唯一匹配 → assigneeId
    expect(project.tasks[0].assigneeId).toBe("m_1");
    expect((project.tasks[0] as any).assigneeName).toBeUndefined();
    // 无法唯一匹配 → 未分配
    expect(project.tasks[1].assigneeId).toBeUndefined();
    // DDL 归一本地格式
    expect(project.tasks[0].ddl).toBe("2026-08-10T23:59:00");
    expect(project.tasks[1].ddl).toBe("2026-08-12T10:00:00");
  });
});
