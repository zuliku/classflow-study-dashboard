/**
 * Kiro Text Eval V1 —— 固定 Eval World（DeepSeek V4 Flash 文字 Agent baseline）。
 * 覆盖全部 15 个 KIRO_EVAL_SCENARIOS 所需的最小数据（courses/schedules/assignments/
 * studyBlocks/calendarMarks/reminders/focus/materials/memory/semester/currentWeek）。
 * 绝不用真实 Zustand Demo Store；每 Scenario 独立 fresh clone。
 * 固定时钟 2026-08-16（周日，week 2）Asia/Shanghai，不调用 new Date()。
 */
import { KiroPromptContextRef } from "@/lib/ai/context/contextSelection";
import { AppState } from "@/store/useAppStore";
import { ReadToolState } from "@/lib/ai/tools/read/executor";

export const KIRO_TEXT_NOW = "2026-08-16T01:00:00.000Z"; // 2026-08-16 09:00 Asia/Shanghai
export const KIRO_TEXT_TIMEZONE = "Asia/Shanghai";

/** Text Eval World 形状：ReadToolState 可执行层 + 写/提醒/专注所需字段（非完整 AppState） */
export interface KiroTextWorldState extends ReadToolState {
  preferences: AppState["preferences"];
  reminders: AppState["reminders"];
  focusSessions: AppState["focusSessions"];
  scheduleOccurrenceOverrides: AppState["scheduleOccurrenceOverrides"];
}

/** Text Eval World（每 Scenario 独立 fresh clone） */
export const KIRO_TEXT_EVAL_WORLD: KiroTextWorldState = {
  userProfile: { name: "测试用户", college: "计科", grade: "2024", completedCredits: 20, totalCredits: 160 },
  semester: { id: "text-sem", name: "Text Eval 学期", startDate: "2026-08-03", totalWeeks: 16 },
  currentSemesterWeek: 2,
  activeTab: "overview",
  selectedCourseId: null,
  selectedAssignmentId: null,
  highlightedAssignmentId: null,
  courses: [
    { id: "c_stat", name: "统计学", code: "ST101", teacher: "", classroom: "", credit: 3, bgHex: "#E8E2D5", borderHex: "#D5CBB8", textHex: "#4A4642", description: "", materials: [
      { id: "m_syllabus", title: "课程大纲.pdf", type: "pdf", size: "245KB", uploadDate: "2026-08-01" },
    ] },
    { id: "c_ds", name: "数据结构与算法", code: "DS202", teacher: "", classroom: "", credit: 4, bgHex: "#E3E7DE", borderHex: "#C9D2C4", textHex: "#4A4642", description: "", materials: [
      { id: "m_pdf", title: "实验指导.pdf", type: "pdf", size: "3KB", uploadDate: "2026-08-10" },
      { id: "m_notes", title: "课堂笔记.doc", type: "doc", size: "8KB", uploadDate: "2026-08-12" },
    ] },
    { id: "c_cn", name: "计算机网络", code: "CN205", teacher: "", classroom: "", credit: 3, bgHex: "#E9E2DC", borderHex: "#D6C8BC", textHex: "#4A4642", description: "", materials: [] },
    { id: "c_math", name: "高等数学", code: "MA101", teacher: "", classroom: "", credit: 5, bgHex: "#E4E6EB", borderHex: "#C7CCD6", textHex: "#4A4642", description: "", materials: [] },
  ],
  schedules: [
    { id: "s_stat", courseId: "c_stat", dayOfWeek: 1, startTime: "10:00", endTime: "11:40", location: "教201", weeks: "1-16周" },
    { id: "s_math", courseId: "c_math", dayOfWeek: 2, startTime: "08:00", endTime: "09:40", location: "教301", weeks: "1-16周" },
    { id: "s_ds", courseId: "c_ds", dayOfWeek: 3, startTime: "10:00", endTime: "11:40", location: "教101", weeks: "1-16周" },
    { id: "s_cn", courseId: "c_cn", dayOfWeek: 5, startTime: "14:00", endTime: "15:40", location: "教102", weeks: "1-16周" },
  ],
  assignments: [
    { id: "a_react", courseId: "c_stat", title: "统计学复习", description: "复习第 1-3 章", ddl: "2026-08-16T22:00:00", priority: "urgent", status: "todo", progress: 0, tags: [] },
    { id: "a_prob", courseId: "c_math", title: "概率论作业", description: "习题 4.1-4.5", ddl: "2026-08-16T23:59:00", priority: "high", status: "doing", progress: 40, tags: [] },
    { id: "a_ds_lab", courseId: "c_ds", title: "数据结构实验报告", description: "链表实验", ddl: "2026-08-18T22:00:00", priority: "medium", status: "todo", progress: 0, tags: [], materialIds: ["m_pdf"] },
    { id: "a_measure", courseId: "c_stat", title: "计量作业", description: "回归分析练习", ddl: "2026-08-19T23:59:00", priority: "medium", status: "todo", progress: 0, tags: [] },
    { id: "a_cn_proj", courseId: "c_cn", title: "计网课程设计", description: "组网方案", ddl: "2026-08-20T23:59:00", priority: "low", status: "todo", progress: 0, tags: [] },
    { id: "a_math_ch4", courseId: "c_math", title: "高数第四章作业", description: "", ddl: "2026-08-20T23:59:00", priority: "medium", status: "todo", progress: 0, tags: [] },
    { id: "a_stat_quiz", courseId: "c_stat", title: "统计学小测", description: "已完成", ddl: "2026-08-15T23:59:00", priority: "high", status: "completed", progress: 100, tags: [] },
  ],
  calendarMarks: [
    { id: "cm_exam", title: "概率论考试", type: "exam", date: "2026-08-18", startTime: "09:00", endTime: "11:00" },
  ],
  groupProjects: [],
  studyBlocks: [
    { id: "sb1", assignmentId: "a_prob", title: "概率论作业", date: "2026-08-16", startTime: "19:00", endTime: "20:00", source: "kiro" },
    { id: "sb2", assignmentId: "a_react", title: "统计学复习", date: "2026-08-16", startTime: "21:00", endTime: "21:30", source: "kiro" },
  ],
  reminders: [
    { id: "r_measure", title: "交计量作业", note: "", status: "scheduled", targetType: "assignment", targetId: "a_measure", timingMode: "relative", offsetMinutes: -60, triggerAt: "2026-08-19T22:59:00", source: "manual", createdAt: "2026-08-10T10:00:00", updatedAt: "2026-08-10T10:00:00" },
  ],
  focusSessions: [],
  scheduleOccurrenceOverrides: [],
  preferences: {
    showWeekends: true,
    ddlWarningDays: 3,
    defaultDDLTime: "23:59",
    enableScheduleDirectManipulation: false,
    enableDDLDirectManipulation: false,
    motionPreference: "reduced",
    startupView: "overview",
    defaultTaskPriority: "medium",
    defaultTaskStatus: "todo",
    enableSingleKeyShortcuts: false,
    contentDensity: "comfortable",
    defaultTaskWorkspaceView: "focus",
    defaultDeadlineReminderMinutes: 60,
    focusDefaultMinutes: 25,
    focusSoundEnabled: true,
    focusSoundVolume: 70,
  },
};

/** 每 Scenario 独立 fresh clone（隔离：Scenario 1 的 mutation 不影响 Scenario 2） */
export function createFreshKiroTextWorld(): KiroTextWorldState {
  return structuredClone(KIRO_TEXT_EVAL_WORLD);
}

/** Text Eval Base Context（生产式；contextRefs 由场景种子注入） */
export const KIRO_TEXT_BASE_CONTEXT: Record<string, unknown> = {
  version: 1,
  now: KIRO_TEXT_NOW,
  timezone: KIRO_TEXT_TIMEZONE,
  activeTab: "overview",
  semester: {
    id: KIRO_TEXT_EVAL_WORLD.semester.id,
    name: KIRO_TEXT_EVAL_WORLD.semester.name,
    startDate: KIRO_TEXT_EVAL_WORLD.semester.startDate,
    totalWeeks: KIRO_TEXT_EVAL_WORLD.semester.totalWeeks,
    currentWeek: KIRO_TEXT_EVAL_WORLD.currentSemesterWeek,
  },
  profile: {
    name: KIRO_TEXT_EVAL_WORLD.userProfile.name,
    college: KIRO_TEXT_EVAL_WORLD.userProfile.college,
    grade: KIRO_TEXT_EVAL_WORLD.userProfile.grade,
  },
  ui: {
    selectedCourseId: null,
    selectedAssignmentId: null,
    highlightedAssignmentId: null,
    assignmentWorkspaceView: "focus",
  },
  summary: {
    courseCount: KIRO_TEXT_EVAL_WORLD.courses.length,
    scheduleCount: KIRO_TEXT_EVAL_WORLD.schedules.length,
    assignmentCount: KIRO_TEXT_EVAL_WORLD.assignments.length,
    groupProjectCount: 0,
    studyBlockCount: KIRO_TEXT_EVAL_WORLD.studyBlocks.length,
  },
};

/** Memory Index（baseContext 注入；与 save-study-preference-memory 场景请求不重复） */
export const KIRO_TEXT_MEMORY_INDEX: Array<{ id: string; title: string; category: string; scope: string }> = [
  { id: "mem_1", title: "周末喜欢集中复习", category: "study-habit", scope: "global" },
];

/** Scenario → 种子 contextRefs（对应 contract 的 contextAssumptions「当前 contextRefs 已提供唯一 xxx」；
 *  material kind 提供 courseId + materialId 双 trusted provenance） */
export const KIRO_TEXT_SEED_REFS: Record<string, KiroPromptContextRef[]> = {
  "assignment-health": [{ kind: "assignment", id: "a_math_ch4", label: "高数第四章作业" }],
  "pdf-task-breakdown": [{ kind: "assignment", id: "a_ds_lab", label: "数据结构实验报告" }],
  "course-material-list": [{ kind: "course", id: "c_ds", label: "数据结构与算法" }],
  "material-requirements-summary": [
    { kind: "course", id: "c_ds", label: "数据结构与算法" },
    { kind: "material", id: "m_pdf", label: "实验指导.pdf" },
  ],
  "create-reminder": [{ kind: "assignment", id: "a_ds_lab", label: "数据结构实验报告" }],
  "start-focus": [{ kind: "course", id: "c_stat", label: "统计学" }],
  // Eval 收口：用户表达「这周这几个作业」依赖已选实体 → contextRefs 成为真实 source-of-truth
  "multi-assignment-week-plan": [
    { kind: "assignment", id: "a_ds_lab", label: "数据结构实验报告" },
    { kind: "assignment", id: "a_measure", label: "计量作业" },
    { kind: "assignment", id: "a_cn_proj", label: "计网课程设计" },
  ],
};

/**
 * read_material 的确定性内容（Node Eval 无 IndexedDB：生产 getFileBlob 不可用；
 * 这是 Eval 层的提取 stand-in —— 内容来自 World 数据，不是真实文件解析）。
 * pdf-task-breakdown / material-requirements-summary 依赖它。
 */
export const KIRO_TEXT_MATERIAL_CONTENT: Record<string, string> = {
  m_pdf: "数据结构实验要求：\n1. 使用链表实现多项式加法；\n2. 提交实验报告，包含测试用例；\n3. 报告需包含复杂度分析。\n截止时间见课程通知。",
  m_notes: "课堂笔记：线性表、栈与队列的基本操作。",
  m_syllabus: "统计学课程大纲：描述统计、概率论基础、参数估计。",
};
