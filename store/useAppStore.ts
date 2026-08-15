import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  Course,
  CourseSchedule,
  Assignment,
  CalendarMark,
  UserProfile,
  GroupProject,
  GroupMember,
  GroupTask,
  NavTab,
  Reminder,
  ReminderTargetType,
  ScheduleConflict,
  Semester,
  ClassFlowBackupData,
  Material,
  TimeSliceFilter,
  AppPreferences,
  SettingsSection,
  StudyBlock,
} from "@/types";
import { createDefaultSemester, getSemesterWeek } from "@/lib/semester";
import { getLocalDDLDate, parseLocalDDL } from "@/lib/ddl";
import { normalizeAssignment, hasTaskDeadline } from "@/lib/tasks/taskSemantics";
import { sanitizeAssignmentMaterialIds } from "@/lib/tasks/taskMaterials";
import { TaskWorkspaceView } from "@/lib/tasks/taskViews";
import { deleteFileBlob, clearAllFileBlobs } from "@/lib/fileStorage";
import { isLegacyDDLMarkForAssignment, linkLegacyDDLMarks } from "@/lib/calendarMark";
import { createId } from "@/lib/utils";
import { calculateGroupProjectProgress, formatLocalDate, normalizeGroupProject } from "@/lib/groupProject";
import { DEFAULT_PREFERENCES, sanitizePreferences } from "@/lib/preferences";
import { buildNextRecurringAssignment } from "@/lib/tasks/taskRecurrence";
import {
  collectAssignmentDeleteSnapshot,
  collectCourseDeleteCascade,
  removeAssignmentDeleteSnapshot,
  removeCourseDeleteCascade,
  restoreAssignmentDeleteSnapshot,
  AssignmentDeleteSnapshot,
} from "@/lib/dataDependencies";
import {
  FocusErrorCode,
  FocusMutationResult,
  completeFocusSessionRecord,
  finishFocusSessionRecord,
  normalizeFocusSession,
  pauseFocusSessionRecord,
  resumeFocusSessionRecord,
} from "@/lib/focus/focusDomain";
import { FocusSession } from "@/types";
import {
  formatLocalDateTime,
  getReminderTargetAnchor,
  normalizeReminder,
  reconcileTargetReminders,
  resolveReminderTriggerAt,
} from "@/lib/reminders/reminderDomain";
import {
  AutoReconcileMode,
  reconcileAllAutomaticDeadlineReminders,
} from "@/lib/reminders/autoDeadlineReminder";
import {
  buildAssignmentCreatedEvent,
  deriveAssignmentTransitionEvents,
} from "@/lib/history/assignmentEvents";
import {
  buildStudyBlockCreatedEvent,
  buildStudyBlockDeletedEvent,
  buildStudyBlockUpdatedEvent,
} from "@/lib/history/studyBlockEvents";
import {
  buildFocusCompletedEvent,
  buildFocusPausedEvent,
  buildFocusResumedEvent,
  buildFocusStartedEvent,
} from "@/lib/history/focusEvents";
import {
  buildCourseCreatedEvent,
  buildCourseDeletedEvent,
  buildCourseUpdatedEvent,
  buildScheduleCreatedEvent,
  buildScheduleDeletedEvent,
  buildScheduleUpdatedEvent,
  buildSemesterUpdatedEvent,
} from "@/lib/history/courseScheduleEvents";
import {
  LearningEventEnvironment,
  LearningMutationContext,
  ResolvedLearningMutationContext,
  buildLearningHistoryEvent,
  enqueueLearningHistoryEvents,
  resolveLearningMutationContext,
} from "@/lib/history/recorder";
import { resetLearningHistoryForDomainReset } from "@/lib/history/clear";

/** History environment（semester 快照用于 week 计算） */
function historyEnvironment(state: { semester: Semester }): LearningEventEnvironment {
  return { semester: state.semester };
}

/** assignment.deleted / assignment.restored 通用构造（data 仅 title 快照） */
function buildAssignmentLifecycleEvent(
  type: "assignment.deleted" | "assignment.restored",
  assignment: Assignment,
  context: ResolvedLearningMutationContext,
  state: { semester: Semester }
) {
  return buildLearningHistoryEvent({
    type,
    entityType: "assignment",
    entityId: assignment.id,
    data: { titleSnapshot: assignment.title },
    context,
    environment: historyEnvironment(state),
    courseId: assignment.courseId,
    assignmentId: assignment.id,
    assignmentTitleSnapshot: assignment.title,
  });
}

/** Task 7G-A1：Reminder 时间戳统一本地墙钟 */
const nowLocalString = () => formatLocalDateTime(new Date());

/** Reminder target 的当前时间锚点（相对创建/更新时实时解析；无合法 anchor → null） */
function findTargetAnchor(
  state: { assignments: Assignment[]; studyBlocks: StudyBlock[]; calendarMarks: CalendarMark[] },
  targetType: ReminderTargetType,
  targetId: string
): string | null {
  if (targetType === "assignment") {
    const a = state.assignments.find((x) => x.id === targetId);
    return a ? getReminderTargetAnchor("assignment", a) : null;
  }
  if (targetType === "studyBlock") {
    const b = state.studyBlocks.find((x) => x.id === targetId);
    return b ? getReminderTargetAnchor("studyBlock", b) : null;
  }
  if (targetType === "calendarMark") {
    const m = state.calendarMarks.find((x) => x.id === targetId);
    return m ? getReminderTargetAnchor("calendarMark", m) : null;
  }
  return null;
}

/** Assignment 完成：清除其 scheduled reminders（fired 历史保留） */
function clearScheduledAssignmentReminders(reminders: Reminder[], assignmentId: string): Reminder[] {
  return reminders.filter(
    (r) => !(r.targetType === "assignment" && r.targetId === assignmentId && r.status === "scheduled")
  );
}

/** P2：全量自动 DDL 提醒 reconcile（幂等；policy 唯一来源 = autoDeadlineReminder Domain）。
 * mode 默认 preserve-schedule：普通 reconcile 不因 now 前进而移动既有 scheduled auto；
 * 仅显式重算路径（global default / re-enable / reset preferences）传 recompute-schedule。 */
function reconcileAllAuto(
  state: {
    assignments: Assignment[];
    calendarMarks: CalendarMark[];
    reminders: Reminder[];
    preferences: AppPreferences;
  },
  mode: AutoReconcileMode = "preserve-schedule"
): Reminder[] {
  return reconcileAllAutomaticDeadlineReminders({
    assignments: state.assignments,
    calendarMarks: state.calendarMarks,
    reminders: state.reminders,
    requestedLead: state.preferences.defaultDeadlineReminderMinutes,
    defaultDDLTime: state.preferences.defaultDDLTime,
    now: nowLocalString(),
    mode,
  });
}

/**
 * Task 7F + 7G：完成 Assignment 的统一 Domain 行为：
 * recurrence spawn（若适用）+ 清除该任务的 scheduled reminders。
 * spawnedAssignment：recurrence 生成的 child（History source=system 记录用）。
 */
function handleAssignmentCompleted(
  assignments: Assignment[],
  calendarMarks: CalendarMark[],
  reminders: Reminder[],
  completed: Assignment
): {
  assignments: Assignment[];
  calendarMarks: CalendarMark[];
  reminders: Reminder[];
  spawnedAssignment?: Assignment;
} {
  const spawned = spawnRecurringChild(assignments, calendarMarks, completed);
  return {
    assignments: spawned ? spawned.assignments : assignments,
    calendarMarks: spawned ? spawned.calendarMarks : calendarMarks,
    reminders: clearScheduledAssignmentReminders(reminders, completed.id),
    spawnedAssignment: spawned?.child,
  };
}

/** Task V2：根据 Assignment 有效 DDL 构建 linked CalendarMark（addAssignment 与 recurrence spawn 共用同一 helper） */
function buildAssignmentDDLMark(assignment: Assignment): CalendarMark | null {
  if (!hasTaskDeadline(assignment)) return null;
  return {
    id: createId("cm"),
    date: getLocalDDLDate(assignment.ddl),
    type: "ddl",
    title: assignment.title,
    sourceId: assignment.id,
  };
}

/**
 * Task 7F：completion-driven recurrence spawn（所有完成路径共用；幂等）。
 * 仅当 completed 任务有 recurrence 时生成下一次；child 已存在（recurrenceParentId 匹配）→ 不重复生成。
 */
function spawnRecurringChild(
  assignments: Assignment[],
  calendarMarks: CalendarMark[],
  completed: Assignment
): { assignments: Assignment[]; calendarMarks: CalendarMark[]; child: Assignment } | null {
  const draft = buildNextRecurringAssignment(completed);
  if (!draft) return null;
  if (assignments.some((a) => a.recurrenceParentId === completed.id)) return null;
  const child = normalizeAssignment({ ...draft, id: createId("a") });
  const mark = buildAssignmentDDLMark(child);
  return {
    assignments: [...assignments, child],
    calendarMarks: mark ? [...calendarMarks, mark] : calendarMarks,
    child,
  };
}

/**
 * 生产 First Run State：真实用户首次打开为空白、可配置、可导入。
 * 业务数据一律从空开始（演示数据只存在于测试 fixture，生产 runtime 不引用）。
 */
const EMPTY_USER_PROFILE: UserProfile = {
  name: "",
  avatarUrl: "",
  college: "",
  grade: "",
  studentId: "",
  completedCredits: 0,
  totalCredits: 0,
};

/**
 * 持久化白名单（localStorage，key 保持 classflow-storage-v2）：
 * 仅业务数据与明确的稳定偏好。瞬时 UI 状态（选中项、Modal 开关等）
 * 一律不入库 —— 未来新增 Modal state 时不会被自动写入。
 */
interface PersistedAppState {
  userProfile: UserProfile;
  semester: Semester;
  courses: Course[];
  schedules: CourseSchedule[];
  assignments: Assignment[];
  calendarMarks: CalendarMark[];
  groupProjects: GroupProject[];
  /** Timeline V1：学习计划（旧数据可缺失 → 回落 []） */
  studyBlocks?: StudyBlock[];
  /** 任务列表时间筛选：用户偏好，保留并在缺失时回落 "all" */
  assignmentTimeSlice?: TimeSliceFilter;
  /** 上次使用的工作区 Tab（仅记录 workspace，设置不是 Tab） */
  lastWorkspaceTab?: NavTab;
  /** 应用偏好：v2 旧数据可缺失，sanitize 逐字段补默认值 */
  preferences?: AppPreferences;
  /** Task 7G-A1：Reminder（旧数据可缺失 → []） */
  reminders?: Reminder[];
  /** Task 2：Focus Session（旧数据可缺失 → []） */
  focusSessions?: FocusSession[];
}

/** 旧版（无显式 version）持久化数据：可能混入瞬时 UI 状态，迁移时仅取白名单字段 */
interface LegacyPersistedStateV0 {
  userProfile?: unknown;
  semester?: unknown;
  courses?: unknown;
  schedules?: unknown;
  assignments?: unknown;
  calendarMarks?: unknown;
  groupProjects?: unknown;
  assignmentTimeSlice?: unknown;
  lastWorkspaceTab?: unknown;
  preferences?: unknown;
  studyBlocks?: unknown;
  reminders?: unknown;
  focusSessions?: unknown;
}

const TIME_SLICES: TimeSliceFilter[] = ["all", "overdue", "today", "3days", "7days", "completed"];

const NAV_TABS: NavTab[] = ["overview", "timetable", "assignments", "courses", "kiro", "analytics", "group"];

function isValidSemester(v: unknown): v is Semester {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as Semester).name === "string" &&
    typeof (v as Semester).startDate === "string" &&
    typeof (v as Semester).totalWeeks === "number"
  );
}

/**
 * 从任意历史/当前持久化载荷中提取白名单字段。
 * 保守策略：业务数组缺失 → []；可选字段非法 → 默认值；UI 瞬时状态一律丢弃。
 */
function sanitizePersistedState(persisted: unknown): PersistedAppState {
  const legacy = (persisted ?? {}) as LegacyPersistedStateV0;
  const assignments = Array.isArray(legacy.assignments)
    ? (legacy.assignments as Assignment[]).map(normalizeAssignment)
    : [];
  const marks = Array.isArray(legacy.calendarMarks)
    ? (legacy.calendarMarks as CalendarMark[])
    : [];
  const groupProjects = Array.isArray(legacy.groupProjects)
    ? (legacy.groupProjects as GroupProject[]).map(normalizeGroupProject)
    : [];
  return {
    userProfile:
      legacy.userProfile && typeof legacy.userProfile === "object"
        ? (legacy.userProfile as UserProfile)
        : EMPTY_USER_PROFILE,
    semester: isValidSemester(legacy.semester) ? legacy.semester : createDefaultSemester(),
    courses: Array.isArray(legacy.courses) ? (legacy.courses as Course[]) : [],
    schedules: Array.isArray(legacy.schedules) ? (legacy.schedules as CourseSchedule[]) : [],
    assignments,
    // 安全位置自动修复：唯一可确定的 legacy mark 补 sourceId
    calendarMarks: linkLegacyDDLMarks(assignments, marks),
    // v1 → v2：legacy 任务按 assigneeName 唯一匹配补 assigneeId，DDL 归一本地格式
    groupProjects,
    assignmentTimeSlice: TIME_SLICES.includes(legacy.assignmentTimeSlice as TimeSliceFilter)
      ? (legacy.assignmentTimeSlice as TimeSliceFilter)
      : "all",
    // 上次使用的工作区：缺失/非法回落 overview（旧数据从未记录该字段）
    lastWorkspaceTab: NAV_TABS.includes(legacy.lastWorkspaceTab as NavTab)
      ? (legacy.lastWorkspaceTab as NavTab)
      : "overview",
    // v3：preferences 稳定偏好，缺失/部分/非法均逐字段回落默认值
    preferences: sanitizePreferences(legacy.preferences),
    // v4：Timeline V1 学习计划（旧数据缺失 → []）
    studyBlocks: Array.isArray(legacy.studyBlocks) ? (legacy.studyBlocks as StudyBlock[]) : [],
    // v5：Reminder（旧数据缺失 → []；非法条目丢弃）
    reminders: Array.isArray(legacy.reminders)
      ? (legacy.reminders as Reminder[]).map(normalizeReminder).filter((r): r is Reminder => r !== null)
      : [],
    // v6：Focus Session（旧数据缺失 → []；非法条目丢弃）
    focusSessions: Array.isArray(legacy.focusSessions)
      ? (legacy.focusSessions as FocusSession[]).map(normalizeFocusSession).filter((f): f is FocusSession => f !== null)
      : [],
  };
}

export interface AppState {
  // Navigation & UI State
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  /** 上次使用的工作区 Tab（持久化；供 startupView=last 使用） */
  lastWorkspaceTab: NavTab;
  /** 任务列表时间筛选（全局共享，跨页保留） */
  assignmentTimeSlice: TimeSliceFilter;
  setAssignmentTimeSlice: (slice: TimeSliceFilter) => void;
  /** Assignment Workspace V2 视图（UI state，不持久化；focus/today/upcoming/unscheduled/all/archive） */
  assignmentWorkspaceView: TaskWorkspaceView;
  setAssignmentWorkspaceView: (view: TaskWorkspaceView) => void;

  // App Preferences（稳定用户偏好，持久化）
  preferences: AppPreferences;
  updatePreferences: (patch: Partial<AppPreferences>) => void;

  semester: Semester;
  setSemester: (semester: Semester, context?: LearningMutationContext) => void;
  currentSemesterWeek: number;
  setCurrentSemesterWeek: (week: number) => void;
  resetToCurrentWeek: () => void;

  // Selected Entities for Drawers & Modals
  selectedCourseId: string | null;
  setSelectedCourseId: (id: string | null) => void;
  selectedAssignmentId: string | null;
  setSelectedAssignmentId: (id: string | null) => void;
  /** 独立 DDL CalendarMark 的轻量详情（Task/DDL Detail Panel：linked mark 仍走 Assignment 详情） */
  selectedCalendarMarkId: string | null;
  setSelectedCalendarMarkId: (id: string | null) => void;
  isSearchModalOpen: boolean;
  setSearchModalOpen: (open: boolean) => void;
  /** 设置中心 Modal：侧边栏 / 底部导航 / 命令面板统一入口 */
  isSettingsModalOpen: boolean;
  setSettingsModalOpen: (open: boolean) => void;
  /** 外部请求打开的设置 section（如 Kiro「配置 AI 服务」）；SettingsView 消费后清空 */
  settingsTargetSection: SettingsSection | null;
  setSettingsTargetSection: (section: SettingsSection | null) => void;
  /** Command Center 子视图：默认命令面板；? 打开快捷键指南 */
  searchModalView: "palette" | "guide";
  setSearchModalView: (view: "palette" | "guide") => void;
  /** Assignment Workspace 焦点/选择上下文（Command Center 与列表共享） */
  highlightedAssignmentId: string | null;
  setHighlightedAssignmentId: (id: string | null) => void;
  assignmentSelection: string[];
  setAssignmentSelection: (ids: string[]) => void;
  assignmentPeekId: string | null;
  setAssignmentPeekId: (id: string | null) => void;
  isAddCourseModalOpen: boolean;
  setAddCourseModalOpen: (open: boolean) => void;
  isImportScheduleModalOpen: boolean;
  setImportScheduleModalOpen: (open: boolean) => void;
  isConflictModalOpen: boolean;
  setConflictModalOpen: (open: boolean) => void;
  isFullTimetableModalOpen: boolean;
  setFullTimetableModalOpen: (open: boolean) => void;
  selectedConflict: ScheduleConflict | null;
  setSelectedConflict: (conflict: ScheduleConflict | null) => void;

  // Domain Data State
  userProfile: UserProfile;
  courses: Course[];
  schedules: CourseSchedule[];  assignments: Assignment[];
  calendarMarks: CalendarMark[];
  groupProjects: GroupProject[];
  /** Timeline V1：学习计划 */
  studyBlocks: StudyBlock[];

  // Actions
  updateUserProfile: (profile: Partial<UserProfile>) => void;
  /** 只恢复偏好为默认值，不影响业务数据/个人资料/学期 */
  resetPreferences: () => void;
  /** 清空课程/排课/任务/日历/小组与附件 Blob；保留个人资料、学期与偏好 */
  clearLearningData: () => void;
  /** 回到真正 First Run State（空 profile + 空业务数据 + 默认偏好 + 默认学期） */
  resetEntireApp: () => void;
  restoreAppData: (data: ClassFlowBackupData) => void;

  // Course & Schedule Actions
  /** 创建课程（含排课），返回新课程 id */
  addCourseWithSchedule: (
    course: Omit<Course, "id" | "materials">,
    scheduleSlots: Omit<CourseSchedule, "id" | "courseId">[],
    context?: LearningMutationContext
  ) => string;
  updateCourse: (course: Course, context?: LearningMutationContext) => void;
  deleteCourse: (courseId: string, context?: LearningMutationContext) => void;
  /** 创建单个排课，返回新排课 id */
  addScheduleSlot: (schedule: Omit<CourseSchedule, "id">, context?: LearningMutationContext) => string;
  updateSchedule: (schedule: CourseSchedule, context?: LearningMutationContext) => void;
  deleteSchedule: (
    scheduleId: string,
    context?: LearningMutationContext
  ) => CourseSchedule | null;
  /** 撤销删除：恢复原 Schedule（保留原 ID）；History 追加 created restored=true */
  restoreSchedule: (schedule: CourseSchedule, context?: LearningMutationContext) => void;
  excludeWeekFromSchedule: (
    scheduleId: string,
    week: number,
    context?: LearningMutationContext
  ) => void;
  importSchedules: (
    newCourses: Course[],
    newSchedules: CourseSchedule[],
    context?: LearningMutationContext
  ) => void;

  // Material Actions
  addCourseMaterial: (
    courseId: string,
    material: { title: string; type: Material["type"]; size?: string; url?: string; storageKey?: string }
  ) => Material;
  /** 删除资料：仅移除 Zustand metadata；Blob 由调用方在撤销窗口结束后延迟删除 */
  deleteCourseMaterial: (courseId: string, materialId: string) => Material | null;
  /** 撤销删除：恢复资料 metadata（Blob 未被删除） */
  restoreCourseMaterial: (courseId: string, material: Material) => void;

  // Assignment Actions
  /** 创建任务，返回新任务 id（History context 可选；UI 默认 manual） */
  addAssignment: (assignment: Omit<Assignment, "id">, context?: LearningMutationContext) => string;
  updateAssignment: (updatedAssignment: Assignment, context?: LearningMutationContext) => void;
  /** Task V2：字段级 patch（未来 Kiro update_task 的稳定 Domain API；DDL mark 三态同步内置） */
  updateAssignmentPatch: (
    id: string,
    patch: Partial<Omit<Assignment, "id">>,
    context?: LearningMutationContext
  ) => void;
  updateAssignmentStatus: (
    id: string,
    status: Assignment["status"],
    context?: LearningMutationContext
  ) => void;
  updateAssignmentPriority: (
    id: string,
    priority: Assignment["priority"],
    context?: LearningMutationContext
  ) => void;
  updateAssignmentProgress: (id: string, progress: number, context?: LearningMutationContext) => void;
  toggleSubtask: (
    assignmentId: string,
    subtaskId: string,
    context?: LearningMutationContext
  ) => void;
  /** Task 6A：设置任务关联的课程资料 ID（仅保留所属 Course 中真实存在的 ID，跨课程引用被清洗） */
  setAssignmentMaterialIds: (assignmentId: string, materialIds: string[]) => void;
  /** 删除任务：返回完整依赖快照（Assignment + DDL mark + StudyBlocks + 关联 Reminder），供一次撤销恢复 */
  deleteAssignment: (id: string, context?: LearningMutationContext) => AssignmentDeleteSnapshot | null;
  /** 撤销删除：按快照原样恢复（原 ID / 原时间 / 原状态全部保持；按 ID 幂等）；History 追加 restored，不删除 deleted */
  restoreAssignment: (snapshot: AssignmentDeleteSnapshot, context?: LearningMutationContext) => void;

  // Timeline V1：StudyBlock Actions
  /** 创建学习计划，返回新 id */
  addStudyBlock: (block: Omit<StudyBlock, "id">, context?: LearningMutationContext) => string;
  /** Atomic Batch：一次性生成全部 ID，单次 set；全量成功或全量失败（Kiro Study Plan Apply） */
  addStudyBlocksBatch: (
    blocks: Omit<StudyBlock, "id">[],
    context?: LearningMutationContext
  ) => StudyBlock[];
  updateStudyBlock: (
    id: string,
    patch: Partial<Omit<StudyBlock, "id">>,
    context?: LearningMutationContext
  ) => void;
  deleteStudyBlock: (id: string, context?: LearningMutationContext) => void;
  /** Batch Delete：返回实际被删除的 Block（Undo 只删除本次 Apply 创建的 ID） */
  deleteStudyBlocksBatch: (ids: string[], context?: LearningMutationContext) => StudyBlock[];

  // CalendarMark Actions（Timeline V1：考试 / 活动等独立日程）
  /** 创建日程标记（exam / activity 等），返回新 id */
  addCalendarMark: (mark: Omit<CalendarMark, "id">) => string;
  deleteCalendarMark: (id: string) => void;

  // Reminder Actions（Task 7G-A1：Domain / Persistence 基础）
  /** 业务数据：Reminder（持久化） */
  reminders: Reminder[];
  /** 创建 Reminder：relative 按当前 target anchor 实时解析 triggerAt；失败返回 null */
  addReminder: (
    input: Omit<Reminder, "id" | "status" | "firedAt" | "readAt" | "createdAt" | "updatedAt">
  ) => string | null;
  updateReminder: (id: string, patch: Partial<Omit<Reminder, "id">>) => void;
  deleteReminder: (id: string) => void;
  /** 已真正交付给 Reminder Runtime */
  markReminderFired: (id: string, firedAt: string) => void;
  /** 用户已看过/确认（只写 readAt，不改 status） */
  markReminderRead: (id: string, readAt: string) => void;
  /** 一次标记所有 fired && !readAt 为已读（打开 Reminder Center 时调用） */
  markAllFiredRemindersRead: (readAt: string) => void;
  markReminderSkipped: (id: string) => void;
  /** Task 7G-B：Undo 精确恢复原 Reminder（相同 ID，不重跑 normalize / 不重新生成 ID） */
  restoreReminder: (reminder: Reminder) => void;
  /** target 时间变化后同步 relative reminders（absolute / fired 不动；anchor 消失 → scheduled relative 移除） */
  reconcileTargetReminders: (targetType: ReminderTargetType, targetId: string) => void;
  /** P2：原子更新全局默认自动提醒提前量（合法档位 60/1440/4320/10080；非法由 sanitize 回落）并重算全部 scheduled auto */
  setDefaultDeadlineReminderMinutes: (minutes: number) => void;
  /** P2：用户删除 Reminder —— 删除 source="auto" 的 scheduled 视为该 target 关闭默认自动提醒（opt-out 跟随 Source Entity） */
  deleteReminderByUser: (id: string) => void;
  /** P2：用户编辑 Reminder —— 编辑 source="auto" 转成自定义（source=manual）并关闭该 target 的默认自动提醒 */
  updateReminderByUser: (id: string, patch: Partial<Omit<Reminder, "id">>) => void;
  /** P2：重新启用目标默认自动提醒（清除 opt-out 并按当前 policy 重新生成；不恢复旧 snapshot） */
  enableAutomaticReminderForTarget: (targetType: ReminderTargetType, targetId: string) => void;

  // Focus Session Actions（Task 2：全局最多一个 running / paused Session）
  /** 业务数据：Focus Session（持久化） */
  focusSessions: FocusSession[];
  /** 启动专注：plannedMinutes 必须为整数 1–240；Assignment 关联自动取 courseId + 标题快照 */
  startFocusSession: (input: {
    plannedMinutes: number;
    assignmentId?: string;
    courseId?: string;
    note?: string;
    source?: FocusSession["source"];
    now?: number;
  }, context?: LearningMutationContext) => FocusMutationResult;
  /** 暂停唯一 active Session（已 paused → FOCUS_ALREADY_PAUSED） */
  pauseFocusSession: (now?: number, context?: LearningMutationContext) => FocusMutationResult;
  /** 恢复唯一 paused Session（非 paused → FOCUS_NOT_PAUSED） */
  resumeFocusSession: (now?: number, context?: LearningMutationContext) => FocusMutationResult;
  /** manual 结束唯一 active Session（无 active → NO_ACTIVE_FOCUS_SESSION） */
  finishFocusSession: (now?: number, context?: LearningMutationContext) => FocusMutationResult;
  /** 结算指定 running Session（timer / recovered 自然结束；重复完成 → FOCUS_NOT_PAUSED 之外的失败码） */
  completeFocusSession: (
    sessionId: string,
    reason: "timer" | "recovered",
    now?: number,
    context?: LearningMutationContext
  ) => FocusMutationResult;

  // Group Project Actions
  /** 创建空项目（当前用户为组长），返回新项目 id */
  addGroupProject: (project: { courseId: string; title: string; description?: string }) => string;
  updateGroupProject: (
    projectId: string,
    patch: { title?: string; description?: string; courseId?: string }
  ) => void;
  deleteGroupProject: (projectId: string) => void;
  addGroupMember: (
    projectId: string,
    member: { name: string; role?: GroupMember["role"]; major?: string; avatarUrl?: string }
  ) => string;
  updateGroupMember: (projectId: string, member: GroupMember) => void;
  /** 删除成员：最后一个 leader 会被阻止；被删成员的任务变为未分配 */
  deleteGroupMember: (
    projectId: string,
    memberId: string
  ) => { ok: boolean; reason?: string };
  addGroupTask: (
    projectId: string,
    task: { title: string; assigneeId?: string; ddl: string }
  ) => string;
  updateGroupTask: (projectId: string, task: GroupTask) => void;
  deleteGroupTask: (projectId: string, taskId: string) => void;
  toggleGroupTask: (projectId: string, taskId: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      activeTab: "overview",
      setActiveTab: (tab) => set({ activeTab: tab, lastWorkspaceTab: tab }),
      lastWorkspaceTab: "overview",
      assignmentTimeSlice: "all",
      setAssignmentTimeSlice: (slice) => set({ assignmentTimeSlice: slice }),
      assignmentWorkspaceView: "focus",
      setAssignmentWorkspaceView: (view) => set({ assignmentWorkspaceView: view }),
      preferences: DEFAULT_PREFERENCES,
      updatePreferences: (patch) =>
        set((state) => ({
          // immutable merge；patch 字段先经 sanitize 逐字段回落，防非法值入库
          preferences: sanitizePreferences({ ...state.preferences, ...patch }),
        })),
      semester: createDefaultSemester(),
      setSemester: (semester, context) =>
        set((state) => {
          const event = buildSemesterUpdatedEvent({
            before: state.semester,
            after: semester,
            context: resolveLearningMutationContext(context),
            environment: historyEnvironment(state),
          });
          if (event) enqueueLearningHistoryEvents([event]);
          return {
            semester,
            currentSemesterWeek: Math.min(
              Math.max(state.currentSemesterWeek, 1),
              semester.totalWeeks
            ),
          };
        }),
      currentSemesterWeek: 1,
      setCurrentSemesterWeek: (week) =>
        set((state) => ({
          currentSemesterWeek: Math.min(
            Math.max(week, 1),
            state.semester.totalWeeks
          ),
        })),
      resetToCurrentWeek: () =>
        set((state) => ({
          currentSemesterWeek: Math.min(
            Math.max(getSemesterWeek(new Date(), state.semester), 1),
            state.semester.totalWeeks
          ),
        })),

      selectedCourseId: null,
      setSelectedCourseId: (id) => set({ selectedCourseId: id }),
      selectedAssignmentId: null,
      // Task/DDL Detail：Assignment 与独立 DDL mark 详情互斥（setter 内归一，任何入口都成立）
      setSelectedAssignmentId: (id) =>
        set((state) => ({
          selectedAssignmentId: id,
          selectedCalendarMarkId: id !== null ? null : state.selectedCalendarMarkId,
        })),
      selectedCalendarMarkId: null,
      setSelectedCalendarMarkId: (id) =>
        set((state) => ({
          selectedCalendarMarkId: id,
          selectedAssignmentId: id !== null ? null : state.selectedAssignmentId,
        })),

      isSearchModalOpen: false,
      setSearchModalOpen: (open) => set({ isSearchModalOpen: open }),
      isSettingsModalOpen: false,
      setSettingsModalOpen: (open) => set({ isSettingsModalOpen: open }),
      settingsTargetSection: null,
      setSettingsTargetSection: (section) => set({ settingsTargetSection: section }),
      searchModalView: "palette",
      setSearchModalView: (view) => set({ searchModalView: view }),
      highlightedAssignmentId: null,
      setHighlightedAssignmentId: (id) => set({ highlightedAssignmentId: id }),
      assignmentSelection: [],
      setAssignmentSelection: (ids) => set({ assignmentSelection: ids }),
      assignmentPeekId: null,
      setAssignmentPeekId: (id) => set({ assignmentPeekId: id }),
      isAddCourseModalOpen: false,
      setAddCourseModalOpen: (open) => set({ isAddCourseModalOpen: open }),
      isImportScheduleModalOpen: false,
      setImportScheduleModalOpen: (open) => set({ isImportScheduleModalOpen: open }),
      isConflictModalOpen: false,
      setConflictModalOpen: (open) => set({ isConflictModalOpen: open }),
      isFullTimetableModalOpen: false,
      setFullTimetableModalOpen: (open) => set({ isFullTimetableModalOpen: open }),
      selectedConflict: null,
      setSelectedConflict: (conflict) => set({ selectedConflict: conflict }),

      userProfile: EMPTY_USER_PROFILE,
      courses: [],
      schedules: [],
      assignments: [],
      calendarMarks: [],
      groupProjects: [],
      studyBlocks: [],
      reminders: [],
      focusSessions: [],

      updateUserProfile: (profile) =>
        set((state) => ({
          userProfile: { ...state.userProfile, ...profile },
        })),

      resetPreferences: () => {
        // 只恢复偏好，不影响课程/任务/个人资料/学期
        set((state) => {
          const preferences = DEFAULT_PREFERENCES;
          // P2：默认自动提醒提前量恢复 1 天 → 按现有「修改 global default 会重算 auto」语义处理
          const reminders = reconcileAllAuto({
            assignments: state.assignments,
            calendarMarks: state.calendarMarks,
            reminders: state.reminders,
            preferences,
          }, "recompute-schedule");
          return { preferences, reminders };
        });
      },

      clearLearningData: () => {
        // 同步清空 IndexedDB 附件 Blob（fire-and-forget）
        clearAllFileBlobs().catch(() => {});
        // History：业务数据整体清空 → 重置 History（新 historyStartedAt；FocusSession 也清空 → 允许 backfill）
        resetLearningHistoryForDomainReset();
        // 清空业务数据；保留 userProfile / semester / preferences
        set({
          courses: [],
          schedules: [],
          assignments: [],
          calendarMarks: [],
          groupProjects: [],
          studyBlocks: [],
          reminders: [],
          focusSessions: [],
          currentSemesterWeek: Math.min(
            Math.max(getSemesterWeek(new Date(), get().semester), 1),
            get().semester.totalWeeks
          ),
          assignmentTimeSlice: "all",
          selectedCourseId: null,
          selectedAssignmentId: null,
          selectedConflict: null,
          assignmentSelection: [],
          assignmentPeekId: null,
          highlightedAssignmentId: null,
          isAddCourseModalOpen: false,
          isImportScheduleModalOpen: false,
          isConflictModalOpen: false,
          isFullTimetableModalOpen: false,
        });
      },

      resetEntireApp: () => {
        // 同步清空 IndexedDB 中保存的文件 Blob（fire-and-forget）
        clearAllFileBlobs().catch(() => {});
        // History：回到干净 First Run → 重置 History（允许 Focus backfill；无旧数据可回填）
        resetLearningHistoryForDomainReset();
        // 真正 First Run State：空白个人资料 + 空业务数据 + 默认偏好，无任何演示数据
        set({
          userProfile: EMPTY_USER_PROFILE,
          courses: [],
          schedules: [],
          assignments: [],
          calendarMarks: [],
          groupProjects: [],
          studyBlocks: [],
          reminders: [],
          focusSessions: [],
          semester: createDefaultSemester(),
          currentSemesterWeek: 1,
          assignmentTimeSlice: "all",
          preferences: DEFAULT_PREFERENCES,
          selectedCourseId: null,
          selectedAssignmentId: null,
          selectedCalendarMarkId: null,
          selectedConflict: null,
          assignmentSelection: [],
          assignmentPeekId: null,
          highlightedAssignmentId: null,
          isSearchModalOpen: false,
          isSettingsModalOpen: false,
          isAddCourseModalOpen: false,
          isImportScheduleModalOpen: false,
          isConflictModalOpen: false,
          isFullTimetableModalOpen: false,
        });
      },

      restoreAppData: (data) => {
        // History：Backup 不含 History → 先重置旧 History（避免旧 History + Backup Data 混合）；
        // 允许 completed Focus backfill（restore 后 Runtime 会跑）
        resetLearningHistoryForDomainReset();
        set((state) => {
          const assignments = data.assignments.map(normalizeAssignment);
          const calendarMarks = linkLegacyDDLMarks(data.assignments, data.calendarMarks);
          const preferences = data.preferences
            ? sanitizePreferences(data.preferences)
            : state.preferences;
          const restoredReminders = Array.isArray(data.reminders)
            ? data.reminders.map(normalizeReminder).filter((r): r is Reminder => r !== null)
            : [];
          // P2：restore 后按 restored entities/preferences 做一次幂等 reconcile/backfill
          // （重复导入 / reload 不产生重复 auto；history 与 manual/kiro 原样保留）
          const reminders = reconcileAllAutomaticDeadlineReminders({
            assignments,
            calendarMarks,
            reminders: restoredReminders,
            requestedLead: preferences.defaultDeadlineReminderMinutes,
            defaultDDLTime: preferences.defaultDDLTime,
            now: nowLocalString(),
          });
          return {
            userProfile: data.userProfile,
            semester: data.semester,
            courses: data.courses,
            schedules: data.schedules,
            assignments,
            calendarMarks,
            groupProjects: data.groupProjects.map(normalizeGroupProject),
            studyBlocks: Array.isArray(data.studyBlocks) ? data.studyBlocks : [],
            preferences,
            reminders,
            focusSessions: Array.isArray(data.focusSessions)
              ? data.focusSessions.map(normalizeFocusSession).filter((f): f is FocusSession => f !== null)
              : [],
            currentSemesterWeek: Math.min(
              Math.max(state.currentSemesterWeek, 1),
              data.semester.totalWeeks
            ),
          };
        });
      },

      addCourseWithSchedule: (courseData, scheduleSlots, context) => {
        const courseId = createId("c");
        const newCourse: Course = {
          ...courseData,
          id: courseId,
          materials: [],
        };

        const newSchedules: CourseSchedule[] = scheduleSlots.map((slot, idx) => ({
          ...slot,
          id: createId("s"),
          courseId,
        }));

        set((state) => {
          const resolved = resolveLearningMutationContext(context);
          enqueueLearningHistoryEvents([
            buildCourseCreatedEvent({ course: newCourse, context: resolved, environment: historyEnvironment(state) }),
            ...newSchedules.map((s) =>
              buildScheduleCreatedEvent({ schedule: s, context: resolved, environment: historyEnvironment(state) })
            ),
          ]);
          return {
            courses: [...state.courses, newCourse],
            schedules: [...state.schedules, ...newSchedules],
          };
        });
        return courseId;
      },

      updateCourse: (updatedCourse, context) =>
        set((state) => {
          const prev = state.courses.find((c) => c.id === updatedCourse.id);
          const event = prev
            ? buildCourseUpdatedEvent({
                before: prev,
                after: updatedCourse,
                context: resolveLearningMutationContext(context),
                environment: historyEnvironment(state),
              })
            : null;
          if (event) enqueueLearningHistoryEvents([event]);
          return {
            courses: state.courses.map((c) => (c.id === updatedCourse.id ? updatedCourse : c)),
          };
        }),

      deleteCourse: (courseId, context) => {
        const current = get();
        const cascade = collectCourseDeleteCascade(current, courseId);
        if (!cascade) return;

        // 1. 同步清理该课程关联资料的 Blob（fire-and-forget，失败不阻塞）
        cascade.course.materials.forEach((m) => {
          if (m.storageKey) deleteFileBlob(m.storageKey).catch(() => {});
        });

        // History：course.deleted + schedule.deleted×N + assignment.deleted×N + study_block.deleted×N
        const resolved = resolveLearningMutationContext(context);
        const env = historyEnvironment(current);
        enqueueLearningHistoryEvents([
          buildCourseDeletedEvent({ course: cascade.course, context: resolved, environment: env }),
          ...cascade.schedules.map((s) => buildScheduleDeletedEvent({ schedule: s, context: resolved, environment: env })),
          ...cascade.assignments.map((a) => buildAssignmentLifecycleEvent("assignment.deleted", a, resolved, current)),
          ...cascade.studyBlocks.map((b) => buildStudyBlockDeletedEvent({ block: b, context: resolved, environment: env })),
        ]);

        // 2. 一次 set 完成完整级联删除（Course + schedules + assignments + groupProjects +
        //    DDL marks + course/assignment-owned StudyBlocks + 受影响 Reminder）
        set((state) => {
          const next = removeCourseDeleteCascade(state, cascade);
          const deletedAssignmentIds = new Set(cascade.assignments.map((a) => a.id));
          return {
            ...next,
            selectedCourseId: state.selectedCourseId === courseId ? null : state.selectedCourseId,
            selectedAssignmentId:
              state.selectedAssignmentId !== null && deletedAssignmentIds.has(state.selectedAssignmentId)
                ? null
                : state.selectedAssignmentId,
          };
        });
      },

      addScheduleSlot: (scheduleData, context) => {
        const newSchedule: CourseSchedule = {
          ...scheduleData,
          id: createId("s"),
        };
        set((state) => {
          enqueueLearningHistoryEvents([
            buildScheduleCreatedEvent({
              schedule: newSchedule,
              context: resolveLearningMutationContext(context),
              environment: historyEnvironment(state),
            }),
          ]);
          return { schedules: [...state.schedules, newSchedule] };
        });
        return newSchedule.id;
      },

      updateSchedule: (updatedSchedule, context) =>
        set((state) => {
          const prev = state.schedules.find((s) => s.id === updatedSchedule.id);
          const changed =
            !!prev &&
            (prev.dayOfWeek !== updatedSchedule.dayOfWeek ||
              prev.startTime !== updatedSchedule.startTime ||
              prev.endTime !== updatedSchedule.endTime ||
              prev.location !== updatedSchedule.location ||
              prev.weeks !== updatedSchedule.weeks ||
              (prev.excludedWeeks ?? []).join(",") !== (updatedSchedule.excludedWeeks ?? []).join(","));
          if (changed) {
            enqueueLearningHistoryEvents([
              buildScheduleUpdatedEvent({
                schedule: updatedSchedule,
                context: resolveLearningMutationContext(context),
                environment: historyEnvironment(state),
              }),
            ]);
          }
          return {
            schedules: state.schedules.map((s) => (s.id === updatedSchedule.id ? updatedSchedule : s)),
          };
        }),

      deleteSchedule: (scheduleId, context) => {
        const current = get();
        const target = current.schedules.find((s) => s.id === scheduleId) || null;
        if (target) {
          enqueueLearningHistoryEvents([
            buildScheduleDeletedEvent({
              schedule: target,
              context: resolveLearningMutationContext(context),
              environment: historyEnvironment(current),
            }),
          ]);
        }
        set({ schedules: current.schedules.filter((s) => s.id !== scheduleId) });
        return target;
      },

      restoreSchedule: (schedule, context) =>
        set((state) => {
          enqueueLearningHistoryEvents([
            buildScheduleCreatedEvent({
              schedule,
              context: resolveLearningMutationContext(context),
              environment: historyEnvironment(state),
              restored: true,
            }),
          ]);
          return { schedules: [...state.schedules, schedule] };
        }),

      excludeWeekFromSchedule: (scheduleId, week, context) =>
        set((state) => {
          const target = state.schedules.find((s) => s.id === scheduleId);
          const schedules = state.schedules.map((s) => {
            if (s.id !== scheduleId) return s;
            const currentEx = s.excludedWeeks || [];
            if (currentEx.includes(week)) return s;
            return { ...s, excludedWeeks: [...currentEx, week] };
          });
          const after = schedules.find((s) => s.id === scheduleId);
          if (target && after && (target.excludedWeeks ?? []).join(",") !== (after.excludedWeeks ?? []).join(",")) {
            enqueueLearningHistoryEvents([
              buildScheduleUpdatedEvent({
                schedule: after,
                context: resolveLearningMutationContext(context),
                environment: historyEnvironment(state),
              }),
            ]);
          }
          return { schedules };
        }),

      importSchedules: (newCourses, newSchedules, context) =>
        set((state) => {
          const resolved = resolveLearningMutationContext(context ?? { source: "import" });
          enqueueLearningHistoryEvents([
            ...newCourses.map((c) => buildCourseCreatedEvent({ course: c, context: resolved, environment: historyEnvironment(state) })),
            ...newSchedules.map((s) => buildScheduleCreatedEvent({ schedule: s, context: resolved, environment: historyEnvironment(state) })),
          ]);
          return {
            courses: [...state.courses, ...newCourses],
            schedules: [...state.schedules, ...newSchedules],
          };
        }),

      addCourseMaterial: (courseId, materialData) => {
        const today = new Date();
        const pad2 = (n: number) => String(n).padStart(2, "0");
        const uploadDate = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
        // Task 6B-B：返回创建的 Material（调用方（如 Task Upload）可直接拿到 id 自动关联）
        // 真实语义：无 size 数据存空字符串，不生成「1.5 MB」类假大小
        const material: Material = {
          id: createId("m"),
          title: materialData.title,
          type: materialData.type,
          size: materialData.size || "",
          uploadDate,
          storageKey: materialData.storageKey,
          url: materialData.url,
        };

        set((state) => ({
          courses: state.courses.map((c) =>
            c.id === courseId ? { ...c, materials: [...c.materials, material] } : c
          ),
        }));
        return material;
      },

      deleteCourseMaterial: (courseId, materialId) => {
        // 仅移除 metadata；Blob 由调用方在撤销窗口结束后延迟删除
        const current = get();
        const targetCourse = current.courses.find((c) => c.id === courseId);
        const targetMaterial = targetCourse?.materials.find((m) => m.id === materialId) || null;

        set((state) => ({
          courses: state.courses.map((c) =>
            c.id === courseId
              ? { ...c, materials: c.materials.filter((m) => m.id !== materialId) }
              : c
          ),
          // Task 6A：资料被删除 → 清理所有同课程任务的 materialIds 引用（不留 dangling ref）
          assignments: state.assignments.map((a) => {
            if (a.courseId !== courseId || !a.materialIds?.includes(materialId)) return a;
            const rest = a.materialIds.filter((id) => id !== materialId);
            return { ...a, materialIds: rest.length > 0 ? rest : undefined };
          }),
        }));

        return targetMaterial;
      },

      restoreCourseMaterial: (courseId, material) =>
        set((state) => ({
          courses: state.courses.map((c) =>
            c.id === courseId && !c.materials.some((m) => m.id === material.id)
              ? { ...c, materials: [...c.materials, material] }
              : c
          ),
        })),

      addAssignment: (assignmentData, context) => {
        const newId = createId("a");
        const newAssignment: Assignment = normalizeAssignment({
          ...assignmentData,
          id: newId,
        });

        // Task V2：仅当 Assignment 有合法 DDL 才创建 linked CalendarMark（无 DDL 不建空 date mark）
        const mark = buildAssignmentDDLMark(newAssignment);
        const marks: CalendarMark[] = mark ? [mark] : [];

        set((state) => {
          const assignments = [newAssignment, ...state.assignments];
          const calendarMarks = [...state.calendarMarks, ...marks];
          // P2：新建未来 DDL → 按全局默认生成 auto Reminder（linked mark 不产生第二条）
          const reminders = reconcileAllAuto({
            assignments,
            calendarMarks,
            reminders: state.reminders,
            preferences: state.preferences,
          });
          // History：assignment.created（UI 默认 manual；Kiro/system/import 由 context 指定）
          const resolved = resolveLearningMutationContext(context);
          enqueueLearningHistoryEvents([
            buildAssignmentCreatedEvent({
              assignment: newAssignment,
              context: resolved,
              environment: historyEnvironment(state),
            }),
          ]);
          return { assignments, calendarMarks, reminders };
        });
        return newId;
      },

      updateAssignment: (updatedAssignment, context) =>
        set((state) => {
          const next = normalizeAssignment(updatedAssignment);
          const oldAssignment = state.assignments.find((a) => a.id === next.id);
          const hasDdl = hasTaskDeadline(next);
          const newDdlDate = getLocalDDLDate(next.ddl);

          // Update assignment object in place, preserving ID
          let newAssignments = state.assignments.map((a) =>
            a.id === next.id ? next : a
          );
          let newReminders = state.reminders;
          // Task 7G-A1：DDL 变化 → 同步该任务的 relative reminders（absolute 不动；
          // anchor 消失（DDL 删除）→ scheduled relative 移除，不自动变 absolute）
          if (oldAssignment && (oldAssignment.ddl ?? null) !== (next.ddl ?? null)) {
            newReminders = reconcileTargetReminders(
              newReminders,
              "assignment",
              next.id,
              hasDdl ? next.ddl ?? null : null,
              nowLocalString()
            );
            // P2 §5：DDL 变化（无→有 / 有→新值 / 有→无）→ scheduled auto 先移除，
            // 由下方统一 reconcile 按当前全局默认重新计算（不机械保持降级 offset）
            newReminders = newReminders.filter(
              (r) =>
                !(
                  r.targetType === "assignment" &&
                  r.targetId === next.id &&
                  r.source === "auto" &&
                  r.status === "scheduled"
                )
            );
          }

          // 关联 mark 三态同步（Task V2）：
          // A. 有 DDL → 有 DDL：更新已有 linked mark（sourceId 精确匹配 / legacy 唯一匹配）
          // B. 无 DDL → 有 DDL：创建 linked mark
          // C. 有 DDL → 无 DDL：删除 linked mark（不留下孤儿）
          let matchedId: string | null = null;
          let newCalendarMarks = state.calendarMarks.map((m) => {
            if (m.sourceId === next.id) {
              matchedId = m.id;
              if (!hasDdl) return null; // C：删除
              return {
                ...m,
                date: newDdlDate,
                title: next.title,
                sourceId: next.id,
              };
            }
            if (oldAssignment && isLegacyDDLMarkForAssignment(m, oldAssignment)) {
              matchedId = m.id;
              if (!hasDdl) return null; // C：删除
              return {
                ...m,
                date: newDdlDate,
                title: next.title,
                sourceId: next.id,
              };
            }
            return m;
          }).filter((m): m is CalendarMark => m !== null);

          // B：无关联 mark 且存在 DDL → 新建（避免重复：确认过滤后无同 id mark）
          void matchedId;
          if (hasDdl && !newCalendarMarks.some((m) => m.sourceId === next.id && m.type === "ddl")) {
            newCalendarMarks.push({
              id: createId("cm"),
              date: newDdlDate,
              type: "ddl",
              title: next.title,
              sourceId: next.id,
            });
          }

          // Task 7F：completion-driven recurrence —— 本次从非完成 → 完成且为重复任务 → 生成下一次
          let spawnedChild: Assignment | undefined;
          if (
            oldAssignment &&
            oldAssignment.status !== "completed" &&
            next.status === "completed"
          ) {
            const applied = handleAssignmentCompleted(
              newAssignments,
              newCalendarMarks,
              newReminders,
              next
            );
            newAssignments = applied.assignments;
            newCalendarMarks = applied.calendarMarks;
            newReminders = applied.reminders;
            spawnedChild = applied.spawnedAssignment;
          }

          // P2：统一自动 DDL 提醒 reconcile（eligible → 生成/保留；ineligible / opt-out / 已过 → 移除；
          // completed 清除的 reminders 不会重建；spawn 的 child 获得自己的 auto）
          const finalReminders = reconcileAllAuto({
            assignments: newAssignments,
            calendarMarks: newCalendarMarks,
            reminders: newReminders,
            preferences: state.preferences,
          });

          // History：assignment transition（status/completed/reopened/DDL/estimate/priority）
          if (oldAssignment) {
            const resolved = resolveLearningMutationContext(context);
            const events = deriveAssignmentTransitionEvents({
              before: oldAssignment,
              after: next,
              context: resolved,
              completionTrigger: "update",
              environment: historyEnvironment(state),
            });
            if (spawnedChild) {
              // recurrence child：source=system
              events.push(
                buildAssignmentCreatedEvent({
                  assignment: spawnedChild,
                  context: { ...resolved, source: "system" },
                  environment: historyEnvironment(state),
                })
              );
            }
            enqueueLearningHistoryEvents(events);
          }

          return {
            assignments: newAssignments,
            calendarMarks: newCalendarMarks,
            reminders: finalReminders,
          };
        }),

      /**
       * Task V2：字段级 patch（未来 Kiro update_task 的稳定 Domain API）。
       * 只改给定字段；DDL CalendarMark 三态同步由内部统一逻辑处理。
       */
      updateAssignmentPatch: (id, patch, context) => {
        const current = get().assignments.find((a) => a.id === id);
        if (!current) return;
        get().updateAssignment({ ...current, ...patch, id }, context);
      },

      /**
       * Task 6A：设置任务关联的课程资料 ID。
       * 仅保留所属 Course.materials 中真实存在的 ID（跨课程引用自动清洗）+ 去重；
       * 空结果 → undefined（无关联）。复用 updateAssignment（DDL mark 同步为 no-op）。
       */
      setAssignmentMaterialIds: (assignmentId, materialIds) => {
        const current = get().assignments.find((a) => a.id === assignmentId);
        if (!current) return;
        const valid = sanitizeAssignmentMaterialIds(current, get().courses, materialIds);
        get().updateAssignment({ ...current, materialIds: valid.length > 0 ? valid : undefined });
      },

      updateAssignmentStatus: (id, status, context) =>
        set((state) => {
          const target = state.assignments.find((a) => a.id === id);
          const isComp = status === "completed";
          const completedNow = !!target && target.status !== "completed" && isComp;
          let assignments = state.assignments.map((a) => {
            if (a.id !== id) return a;
            return { ...a, status, progress: isComp ? 100 : a.progress };
          });
          let calendarMarks = state.calendarMarks;
          let reminders = state.reminders;
          // Task 7F + 7G：completion → recurrence spawn + 清除 scheduled reminders
          let spawnedChild: Assignment | undefined;
          if (completedNow && target) {
            const applied = handleAssignmentCompleted(assignments, calendarMarks, reminders, {
              ...target,
              status,
              progress: 100,
            });
            assignments = applied.assignments;
            calendarMarks = applied.calendarMarks;
            reminders = applied.reminders;
            spawnedChild = applied.spawnedAssignment;
          }
          // P2：submitted/completed → scheduled auto 移除；回到 todo/doing（eligible）→ 按当前默认重建
          reminders = reconcileAllAuto({ assignments, calendarMarks, reminders, preferences: state.preferences });
          // History
          if (target) {
            const resolved = resolveLearningMutationContext(context);
            const after = assignments.find((a) => a.id === id)!;
            const events = deriveAssignmentTransitionEvents({
              before: target,
              after,
              context: resolved,
              completionTrigger: "status",
              environment: historyEnvironment(state),
            });
            if (spawnedChild) {
              events.push(
                buildAssignmentCreatedEvent({
                  assignment: spawnedChild,
                  context: { ...resolved, source: "system" },
                  environment: historyEnvironment(state),
                })
              );
            }
            enqueueLearningHistoryEvents(events);
          }
          return { assignments, calendarMarks, reminders };
        }),

      updateAssignmentPriority: (id, priority, context) => {
        // 委托 updateAssignmentPatch（→ updateAssignment → deriveAssignmentTransitionEvents）：
        // 复用既有 priority change / no-op suppression / History recording，不手写第二套事件生成器
        const current = get().assignments.find((a) => a.id === id);
        if (!current) return;
        if (current.priority === priority) return; // no-op：不产生事件
        get().updateAssignmentPatch(id, { priority }, context);
      },

      updateAssignmentProgress: (id, progress, context) =>
        set((state) => {
          const target = state.assignments.find((a) => a.id === id);
          let assignments = state.assignments.map((a) => {
            if (a.id !== id) return a;
            const status: Assignment["status"] =
              progress === 100 ? "completed" : progress > 0 ? "doing" : "todo";
            return { ...a, progress, status };
          });
          let calendarMarks = state.calendarMarks;
          let reminders = state.reminders;
          // Task 7F + 7G：进度拉满 → completed（Drawer 滑杆 / Kiro set_assignment_progress）
          const updated = assignments.find((a) => a.id === id);
          let spawnedChild: Assignment | undefined;
          if (target && updated && target.status !== "completed" && updated.status === "completed") {
            const applied = handleAssignmentCompleted(assignments, calendarMarks, reminders, updated);
            assignments = applied.assignments;
            calendarMarks = applied.calendarMarks;
            reminders = applied.reminders;
            spawnedChild = applied.spawnedAssignment;
          }
          // P2：统一自动 DDL 提醒 reconcile
          reminders = reconcileAllAuto({ assignments, calendarMarks, reminders, preferences: state.preferences });
          // History
          if (target && updated) {
            const resolved = resolveLearningMutationContext(context);
            const events = deriveAssignmentTransitionEvents({
              before: target,
              after: updated,
              context: resolved,
              completionTrigger: "progress",
              environment: historyEnvironment(state),
            });
            if (spawnedChild) {
              events.push(
                buildAssignmentCreatedEvent({
                  assignment: spawnedChild,
                  context: { ...resolved, source: "system" },
                  environment: historyEnvironment(state),
                })
              );
            }
            enqueueLearningHistoryEvents(events);
          }
          return { assignments, calendarMarks, reminders };
        }),

      toggleSubtask: (assignmentId, subtaskId, context) =>
        set((state) => {
          const target = state.assignments.find((a) => a.id === assignmentId);
          let assignments = state.assignments.map((a) => {
            if (a.id !== assignmentId || !a.subtasks) return a;
            const updatedSub = a.subtasks.map((st) =>
              st.id === subtaskId ? { ...st, completed: !st.completed } : st
            );
            const compCount = updatedSub.filter((st) => st.completed).length;
            const newProgress = Math.round((compCount / updatedSub.length) * 100);
            const newStatus: Assignment["status"] =
              newProgress === 100 ? "completed" : newProgress > 0 ? "doing" : "todo";
            return { ...a, subtasks: updatedSub, progress: newProgress, status: newStatus };
          });
          let calendarMarks = state.calendarMarks;
          let reminders = state.reminders;
          // Task 7F + 7G：完成最后一个子任务 → 同样 spawn + 清除 scheduled reminders
          const updated = assignments.find((a) => a.id === assignmentId);
          let spawnedChild: Assignment | undefined;
          if (target && updated && target.status !== "completed" && updated.status === "completed") {
            const applied = handleAssignmentCompleted(assignments, calendarMarks, reminders, updated);
            assignments = applied.assignments;
            calendarMarks = applied.calendarMarks;
            reminders = applied.reminders;
            spawnedChild = applied.spawnedAssignment;
          }
          // P2：统一自动 DDL 提醒 reconcile
          reminders = reconcileAllAuto({ assignments, calendarMarks, reminders, preferences: state.preferences });
          // History
          if (target && updated) {
            const resolved = resolveLearningMutationContext(context);
            const events = deriveAssignmentTransitionEvents({
              before: target,
              after: updated,
              context: resolved,
              completionTrigger: "subtasks",
              environment: historyEnvironment(state),
            });
            if (spawnedChild) {
              events.push(
                buildAssignmentCreatedEvent({
                  assignment: spawnedChild,
                  context: { ...resolved, source: "system" },
                  environment: historyEnvironment(state),
                })
              );
            }
            enqueueLearningHistoryEvents(events);
          }
          return { assignments, calendarMarks, reminders };
        }),

      deleteAssignment: (id, context) => {
        const current = get();
        const snapshot = collectAssignmentDeleteSnapshot(current, id);
        if (!snapshot) return null;

        // Task 7G-C：一次 set 完成全部级联删除（Assignment + DDL mark + StudyBlocks + 三类 Reminder），
        // 避免中间 orphan state（禁止 deleteStudyBlock → deleteReminder → deleteCalendarMark 连续调用）
        set((state) => ({
          ...removeAssignmentDeleteSnapshot(state, snapshot),
          selectedAssignmentId: state.selectedAssignmentId === id ? null : state.selectedAssignmentId,
        }));

        // History：assignment.deleted + cascade study_block.deleted ×N（fired/skipped 历史不在此列）
        const resolved = resolveLearningMutationContext(context);
        enqueueLearningHistoryEvents([
          buildAssignmentLifecycleEvent("assignment.deleted", snapshot.assignment, resolved, current),
          ...snapshot.studyBlocks.map((b) =>
            buildStudyBlockDeletedEvent({
              block: b,
              context: resolved,
              environment: historyEnvironment(current),
            })
          ),
        ]);

        return snapshot;
      },

      restoreAssignment: (snapshot, context) =>
        set((state) => {
          // History：assignment.restored + 恢复的 study blocks → study_block.created restored=true
          const resolved = resolveLearningMutationContext(context);
          enqueueLearningHistoryEvents([
            buildAssignmentLifecycleEvent("assignment.restored", snapshot.assignment, resolved, state),
            ...snapshot.studyBlocks.map((b) =>
              buildStudyBlockCreatedEvent({
                block: b,
                context: resolved,
                environment: historyEnvironment(state),
                restored: true,
              })
            ),
          ]);
          return {
            ...restoreAssignmentDeleteSnapshot(state, snapshot),
          };
        }),

      // ---- Timeline V1：StudyBlock（学习计划）----
      addStudyBlock: (blockData, context) => {
        const block: StudyBlock = {
          id: createId("sb"),
          title: blockData.title,
          date: blockData.date,
          startTime: blockData.startTime,
          endTime: blockData.endTime,
          assignmentId: blockData.assignmentId,
          courseId: blockData.courseId,
          source: blockData.source ?? "manual",
        };
        set((state) => {
          enqueueLearningHistoryEvents([
            buildStudyBlockCreatedEvent({
              block,
              context: resolveLearningMutationContext(context),
              environment: historyEnvironment(state),
            }),
          ]);
          return { studyBlocks: [block, ...state.studyBlocks] };
        });
        return block.id;
      },
      addStudyBlocksBatch: (blocksData, context) => {
        const created: StudyBlock[] = blocksData.map((b) => ({
          id: createId("sb"),
          title: b.title,
          date: b.date,
          startTime: b.startTime,
          endTime: b.endTime,
          assignmentId: b.assignmentId,
          courseId: b.courseId,
          source: b.source ?? "manual",
        }));
        // 整个 batch 只有一次 state mutation（All-or-None）
        set((state) => {
          // History（best-effort；failure 不影响 state mutation）：
          // 同一 batch 共享 resolved context（同一 occurredAt / source），sequence 保序
          const resolved = resolveLearningMutationContext(context);
          const env = historyEnvironment(state);
          enqueueLearningHistoryEvents(
            created.map((block) =>
              buildStudyBlockCreatedEvent({ block, context: resolved, environment: env })
            )
          );
          return { studyBlocks: [...created, ...state.studyBlocks] };
        });
        return created;
      },
      updateStudyBlock: (id, patch, context) =>
        set((state) => {
          const prev = state.studyBlocks.find((b) => b.id === id);
          const blocks = state.studyBlocks.map((b) => (b.id === id ? { ...b, ...patch } : b));
          let reminders = state.reminders;
          // Task 7G-A1：date / startTime 变化 → 同步 relative reminders（absolute 不动）
          const next = prev ? blocks.find((b) => b.id === id) : undefined;
          if (prev && next && (prev.date !== next.date || prev.startTime !== next.startTime)) {
            reminders = reconcileTargetReminders(
              reminders,
              "studyBlock",
              id,
              getReminderTargetAnchor("studyBlock", next),
              nowLocalString()
            );
          }
          // History：只记录 date/startTime/endTime（及对应 planned minutes）变化；仅 title 变化不记录
          if (prev && next) {
            const event = buildStudyBlockUpdatedEvent({
              before: prev,
              after: next,
              context: resolveLearningMutationContext(context),
              environment: historyEnvironment(state),
            });
            if (event) enqueueLearningHistoryEvents([event]);
          }
          return { studyBlocks: blocks, reminders };
        }),
      deleteStudyBlock: (id, context) =>
        set((state) => {
          const target = state.studyBlocks.find((b) => b.id === id);
          if (target) {
            enqueueLearningHistoryEvents([
              buildStudyBlockDeletedEvent({
                block: target,
                context: resolveLearningMutationContext(context),
                environment: historyEnvironment(state),
              }),
            ]);
          }
          return {
            studyBlocks: state.studyBlocks.filter((b) => b.id !== id),
            // Task 7G-A1：target 删除 → 关联 Reminder 一并删除（无 orphan）
            reminders: state.reminders.filter((r) => !(r.targetType === "studyBlock" && r.targetId === id)),
          };
        }),
      deleteStudyBlocksBatch: (ids, context) => {
        const current = get();
        const idSet = new Set(ids);
        const removed = current.studyBlocks.filter((b) => idSet.has(b.id));
        if (removed.length === 0) return [];
        set((state) => {
          // History（best-effort）：只记录真实删除项；同一 batch 共享 resolved context
          const resolved = resolveLearningMutationContext(context);
          const env = historyEnvironment(state);
          enqueueLearningHistoryEvents(
            removed.map((block) =>
              buildStudyBlockDeletedEvent({ block, context: resolved, environment: env })
            )
          );
          return {
            studyBlocks: state.studyBlocks.filter((b) => !idSet.has(b.id)),
            // Task 7G-A1：批量删除同样级联清理关联 Reminder
            reminders: state.reminders.filter(
              (r) => !(r.targetType === "studyBlock" && r.targetId && idSet.has(r.targetId))
            ),
          };
        });
        return removed;
      },
      addCalendarMark: (markData) => {
        const mark: CalendarMark = { id: createId("cm"), ...markData };
        set((state) => {
          const calendarMarks = [...state.calendarMarks, mark];
          // P2：独立 DDL CalendarMark → 按默认自动生成 auto（linked mark 由 sourceId relation 排除）
          const reminders = reconcileAllAuto({
            assignments: state.assignments,
            calendarMarks,
            reminders: state.reminders,
            preferences: state.preferences,
          });
          return { calendarMarks, reminders };
        });
        return mark.id;
      },
      deleteCalendarMark: (id) =>
        set((state) => {
          const calendarMarks = state.calendarMarks.filter((m) => m.id !== id);
          // Task 7G-A1：target 删除 → 关联 Reminder 一并删除（fired 历史随 target 删除，既有语义）
          const reminders = state.reminders.filter(
            (r) => !(r.targetType === "calendarMark" && r.targetId === id)
          );
          return {
            calendarMarks,
            reminders,
            selectedCalendarMarkId: state.selectedCalendarMarkId === id ? null : state.selectedCalendarMarkId,
          };
        }),

      // ---- Reminder Actions（Task 7G-A1）----
      addReminder: (input) => {
        const now = nowLocalString();
        const state = get();
        let triggerAt = input.triggerAt;
        if (input.timingMode === "relative") {
          // relative：按当前 target anchor 实时解析（无合法 anchor → 创建失败，不 fallback absolute）
          const anchor = findTargetAnchor(state, input.targetType, input.targetId ?? "");
          if (!anchor) return null;
          const resolved = resolveReminderTriggerAt({
            timingMode: "relative",
            triggerAt: anchor,
            offsetMinutes: input.offsetMinutes,
          });
          if (!resolved) return null;
          triggerAt = resolved;
        } else if (!parseLocalDDL(input.triggerAt)) {
          return null;
        }
        const reminder = normalizeReminder({
          ...input,
          id: createId("r"),
          status: "scheduled",
          triggerAt,
          createdAt: now,
          updatedAt: now,
        });
        if (!reminder) return null;
        set((s) => {
          const reminders = [...s.reminders, reminder];
          // P3 fix 1：same-trigger invariant 在 mutation 后立即成立——
          // 新增非-auto scheduled 后立即对该 target 做自动提醒 reconcile
          // （同最终 triggerAt 的 auto 被 suppression；standalone/studyBlock 无 auto policy）
          if (reminder.targetType === "assignment" || reminder.targetType === "calendarMark") {
            return {
              reminders: reconcileAllAuto({
                assignments: s.assignments,
                calendarMarks: s.calendarMarks,
                reminders,
                preferences: s.preferences,
              }),
            };
          }
          return { reminders };
        });
        return reminder.id;
      },
      updateReminder: (id, patch) =>
        set((state) => {
          const target = state.reminders.find((r) => r.id === id);
          const reminders = state.reminders.map((r) =>
            r.id === id ? { ...r, ...patch, updatedAt: nowLocalString() } : r
          );
          // P3 fix 1：内部修改非-auto scheduled 后同样立即 reconcile（same-trigger invariant）
          if (
            target &&
            target.status === "scheduled" &&
            (target.targetType === "assignment" || target.targetType === "calendarMark")
          ) {
            return {
              reminders: reconcileAllAuto({
                assignments: state.assignments,
                calendarMarks: state.calendarMarks,
                reminders,
                preferences: state.preferences,
              }),
            };
          }
          return { reminders };
        }),
      deleteReminder: (id) =>
        set((state) => ({ reminders: state.reminders.filter((r) => r.id !== id) })),
      // P3 fix 2：用户主动删除任何 source="auto" 的 Reminder（scheduled/fired/skipped 历史），
      // 只要 target 是 assignment/calendarMark，都 = 该 target 关闭默认自动提醒（durable opt-out）。
      // 删除 auto history 不能导致同一未到期 DDL 重新复活提醒。
      // 内部 Domain cleanup / cascade delete / restore 不走 ByUser opt-out；manual/kiro 历史删除不写 opt-out。
      deleteReminderByUser: (id) =>
        set((state) => {
          const target = state.reminders.find((r) => r.id === id);
          if (
            !target ||
            target.source !== "auto" ||
            !target.targetId ||
            (target.targetType !== "assignment" && target.targetType !== "calendarMark")
          ) {
            return { reminders: state.reminders.filter((r) => r.id !== id) };
          }
          let assignments = state.assignments;
          let calendarMarks = state.calendarMarks;
          if (target.targetType === "assignment") {
            assignments = state.assignments.map((a) =>
              a.id === target.targetId ? { ...a, autoReminderDisabled: true } : a
            );
          } else if (target.targetType === "calendarMark") {
            calendarMarks = state.calendarMarks.map((m) =>
              m.id === target.targetId ? { ...m, autoReminderDisabled: true } : m
            );
          }
          return {
            assignments,
            calendarMarks,
            reminders: state.reminders.filter((r) => r.id !== id),
          };
        }),
      // P3 fix 1：用户编辑后（含 non-auto 编辑）立即 reconcile——同最终 triggerAt 的 auto 被 suppression
      updateReminderByUser: (id, patch) =>
        set((state) => {
          const target = state.reminders.find((r) => r.id === id);
          if (!target || target.source !== "auto") {
            const reminders = state.reminders.map((r) =>
              r.id === id ? { ...r, ...patch, updatedAt: nowLocalString() } : r
            );
            if (target && (target.targetType === "assignment" || target.targetType === "calendarMark")) {
              return {
                reminders: reconcileAllAuto({
                  assignments: state.assignments,
                  calendarMarks: state.calendarMarks,
                  reminders,
                  preferences: state.preferences,
                }),
              };
            }
            return { reminders };
          }
          let assignments = state.assignments;
          let calendarMarks = state.calendarMarks;
          if (target.targetId) {
            if (target.targetType === "assignment") {
              assignments = state.assignments.map((a) =>
                a.id === target.targetId ? { ...a, autoReminderDisabled: true } : a
              );
            } else if (target.targetType === "calendarMark") {
              calendarMarks = state.calendarMarks.map((m) =>
                m.id === target.targetId ? { ...m, autoReminderDisabled: true } : m
              );
            }
          }
          return {
            assignments,
            calendarMarks,
            reminders: state.reminders.map((r) =>
              r.id === id
                ? { ...r, ...patch, source: "manual", updatedAt: nowLocalString() }
                : r
            ),
          };
        }),
      // P2 §15：重新启用目标默认自动提醒（清除 opt-out → 按当前 anchor/status/now/全局默认重新生成；
      // 不恢复旧 snapshot；fired/skipped 历史保留且同 anchor 不重复，但「明确重新启用」允许新生成）
      enableAutomaticReminderForTarget: (targetType, targetId) =>
        set((state) => {
          if (targetType !== "assignment" && targetType !== "calendarMark") return {};
          let assignments = state.assignments;
          let calendarMarks = state.calendarMarks;
          if (targetType === "assignment") {
            assignments = state.assignments.map((a) =>
              a.id === targetId ? { ...a, autoReminderDisabled: undefined } : a
            );
          } else {
            calendarMarks = state.calendarMarks.map((m) =>
              m.id === targetId ? { ...m, autoReminderDisabled: undefined } : m
            );
          }
          // 明确重新启用：绕过「同 anchor 历史已处理」防重建（该 target 的 fired/skipped auto 暂不参与判定）
          const handledHistory = state.reminders.filter(
            (r) =>
              r.targetType === targetType &&
              r.targetId === targetId &&
              r.source === "auto" &&
              r.status !== "scheduled"
          );
          const base = state.reminders.filter((r) => !handledHistory.includes(r));
          const reconciled = reconcileAllAutomaticDeadlineReminders({
            assignments,
            calendarMarks,
            reminders: base,
            requestedLead: state.preferences.defaultDeadlineReminderMinutes,
            defaultDDLTime: state.preferences.defaultDDLTime,
            now: nowLocalString(),
            mode: "recompute-schedule",
          });
          return { assignments, calendarMarks, reminders: [...reconciled, ...handledHistory] };
        }),
      // P2 §11：原子更新全局默认自动提醒提前量（非法值由 sanitizePreferences 回落）并重算全部 scheduled auto；
      // 只更新 source="auto"；manual/kiro/custom 与 fired/skipped 历史绝不修改
      setDefaultDeadlineReminderMinutes: (minutes) =>
        set((state) => {
          const preferences = sanitizePreferences({
            ...state.preferences,
            defaultDeadlineReminderMinutes: minutes,
          });
          // P2 §11：显式 global-default 变化 → recompute-schedule（全部 scheduled auto 按新默认重算）
          const reminders = reconcileAllAuto({
            assignments: state.assignments,
            calendarMarks: state.calendarMarks,
            reminders: state.reminders,
            preferences,
          }, "recompute-schedule");
          return { preferences, reminders };
        }),
      markReminderFired: (id, firedAt) =>
        set((state) => ({
          reminders: state.reminders.map((r) =>
            r.id === id ? { ...r, status: "fired", firedAt, updatedAt: nowLocalString() } : r
          ),
        })),
      markReminderRead: (id, readAt) =>
        set((state) => ({
          reminders: state.reminders.map((r) =>
            r.id === id ? { ...r, readAt, updatedAt: nowLocalString() } : r
          ),
        })),
      markAllFiredRemindersRead: (readAt) =>
        set((state) => ({
          reminders: state.reminders.map((r) =>
            r.status === "fired" && !r.readAt
              ? { ...r, readAt, updatedAt: nowLocalString() }
              : r
          ),
        })),
      markReminderSkipped: (id) =>
        set((state) => ({
          reminders: state.reminders.map((r) =>
            r.id === id ? { ...r, status: "skipped", updatedAt: nowLocalString() } : r
          ),
        })),
      restoreReminder: (reminder) =>
        set((state) => {
          const reminders = state.reminders.some((r) => r.id === reminder.id)
            ? state.reminders
            : [...state.reminders, reminder];
          // P3 fix 1：恢复 scheduled 非-auto reminder 后立即 reconcile（same-trigger invariant）
          if (
            reminder.status === "scheduled" &&
            (reminder.targetType === "assignment" || reminder.targetType === "calendarMark")
          ) {
            return {
              reminders: reconcileAllAuto({
                assignments: state.assignments,
                calendarMarks: state.calendarMarks,
                reminders,
                preferences: state.preferences,
              }),
            };
          }
          return { reminders };
        }),
      reconcileTargetReminders: (targetType, targetId) =>
        set((state) => ({
          reminders: reconcileTargetReminders(
            state.reminders,
            targetType,
            targetId,
            findTargetAnchor(state, targetType, targetId),
            nowLocalString()
          ),
        })),

      // ---- Focus Session Actions（Task 2）----

      startFocusSession: (input, context) => {
        const now = input.now ?? Date.now();
        if (
          !Number.isInteger(input.plannedMinutes) ||
          input.plannedMinutes < 1 ||
          input.plannedMinutes > 240
        ) {
          return { ok: false, code: "INVALID_FOCUS_DURATION" };
        }
        const current = get();
        if (current.focusSessions.some((s) => s.status === "running" || s.status === "paused")) {
          return { ok: false, code: "FOCUS_SESSION_ALREADY_ACTIVE" };
        }
        let assignmentId = input.assignmentId;
        let courseId = input.courseId;
        let assignmentTitleSnapshot: string | undefined;
        let courseNameSnapshot: string | undefined;
        if (assignmentId !== undefined) {
          const assignment = current.assignments.find((a) => a.id === assignmentId);
          if (!assignment) return { ok: false, code: "FOCUS_TARGET_NOT_FOUND" };
          assignmentTitleSnapshot = assignment.title;
          courseId = assignment.courseId;
          courseNameSnapshot =
            current.courses.find((c) => c.id === assignment.courseId)?.name ?? undefined;
        } else if (courseId !== undefined) {
          const course = current.courses.find((c) => c.id === courseId);
          if (!course) return { ok: false, code: "FOCUS_TARGET_NOT_FOUND" };
          courseNameSnapshot = course.name;
        }
        // Assignment + courseId 同时提供但不匹配 → mismatch（courseId 未显式提供时已被 assignment 覆盖，不算冲突）
        if (
          input.assignmentId !== undefined &&
          input.courseId !== undefined &&
          input.courseId !== courseId
        ) {
          return { ok: false, code: "FOCUS_TARGET_MISMATCH" };
        }
        const session: FocusSession = {
          id: createId("fs"),
          plannedMinutes: input.plannedMinutes,
          startedAt: now,
          activeStartedAt: now,
          accumulatedActiveMs: 0,
          status: "running",
          assignmentId,
          courseId,
          assignmentTitleSnapshot,
          courseNameSnapshot,
          note: input.note,
          source: input.source ?? "manual",
          createdAt: now,
          updatedAt: now,
        };
        set((state) => {
          // History：focus.started（source = context 优先，否则 session.source；occurredAt = 事件时间 now）
          const resolved = resolveLearningMutationContext({
            ...(context ?? {}),
            source: context?.source ?? (session.source as "manual" | "kiro"),
            occurredAt: context?.occurredAt ?? now,
          });
          enqueueLearningHistoryEvents([
            buildFocusStartedEvent({ session, context: resolved, environment: historyEnvironment(state) }),
          ]);
          return { focusSessions: [...state.focusSessions, session] };
        });
        return { ok: true, session };
      },

      pauseFocusSession: (now, context) => {
        const t = now ?? Date.now();
        const state = get();
        // active = running 或 paused（paused 再次 pause 必须给出 FOCUS_ALREADY_PAUSED，而非「找不到」）
        const active = state.focusSessions.find(
          (s) => s.status === "running" || s.status === "paused"
        );
        if (!active) return { ok: false, code: "NO_ACTIVE_FOCUS_SESSION" };
        if (active.status === "paused") return { ok: false, code: "FOCUS_ALREADY_PAUSED" };
        const session = pauseFocusSessionRecord(active, t);
        if (session.status !== "paused") return { ok: false, code: "FOCUS_ALREADY_PAUSED" };
        set((s) => {
          enqueueLearningHistoryEvents([
            buildFocusPausedEvent({ session, context: resolveLearningMutationContext({ ...(context ?? {}), occurredAt: context?.occurredAt ?? t }), environment: historyEnvironment(s) }),
          ]);
          return {
            focusSessions: s.focusSessions.map((x) => (x.id === session.id ? session : x)),
          };
        });
        return { ok: true, session };
      },

      resumeFocusSession: (now, context) => {
        const t = now ?? Date.now();
        const state = get();
        const paused = state.focusSessions.find((s) => s.status === "paused");
        if (!paused) return { ok: false, code: "FOCUS_NOT_PAUSED" };
        const session = resumeFocusSessionRecord(paused, t);
        if (session.status !== "running") return { ok: false, code: "FOCUS_NOT_PAUSED" };
        set((s) => {
          enqueueLearningHistoryEvents([
            buildFocusResumedEvent({ session, context: resolveLearningMutationContext({ ...(context ?? {}), occurredAt: context?.occurredAt ?? t }), environment: historyEnvironment(s) }),
          ]);
          return {
            focusSessions: s.focusSessions.map((x) => (x.id === session.id ? session : x)),
          };
        });
        return { ok: true, session };
      },

      finishFocusSession: (now, context) => {
        const t = now ?? Date.now();
        const state = get();
        // active = running 或 paused：paused 会话的 actualActiveMs 由 finishFocusSessionRecord 按真实 active 时间结算
        const active = state.focusSessions.find(
          (s) => s.status === "running" || s.status === "paused"
        );
        if (!active) return { ok: false, code: "NO_ACTIVE_FOCUS_SESSION" };
        const session = finishFocusSessionRecord(active, t);
        set((s) => {
          const event = buildFocusCompletedEvent({
            session,
            endReason: "manual",
            context: resolveLearningMutationContext({ ...(context ?? {}), occurredAt: context?.occurredAt ?? t }),
            environment: historyEnvironment(s),
          });
          if (event) enqueueLearningHistoryEvents([event]);
          return {
            focusSessions: s.focusSessions.map((x) => (x.id === session.id ? session : x)),
          };
        });
        return { ok: true, session };
      },

      completeFocusSession: (sessionId, reason, now, context) => {
        const t = now ?? Date.now();
        const state = get();
        const target = state.focusSessions.find((s) => s.id === sessionId);
        if (!target || target.status !== "running") {
          // 指定 session 不存在或已结算：第二次完成必须失败
          return { ok: false, code: "NO_ACTIVE_FOCUS_SESSION" };
        }
        const session = completeFocusSessionRecord(target, reason, t);
        set((s) => {
          // timer / recovered 自然结束 → source=system（用户操作由 finishFocusSession 覆盖）
          const event = buildFocusCompletedEvent({
            session,
            endReason: reason,
            context: resolveLearningMutationContext({
              ...(context ?? { source: "system" }),
              occurredAt: context?.occurredAt ?? t,
            }),
            environment: historyEnvironment(s),
          });
          if (event) enqueueLearningHistoryEvents([event]);
          return {
            focusSessions: s.focusSessions.map((x) => (x.id === session.id ? session : x)),
          };
        });
        return { ok: true, session };
      },

      addGroupProject: (projectData) => {
        const current = get();
        // 空项目：不注入任何假成员/假任务；仅把当前真实用户设为 leader
        const members: GroupMember[] =
          current.userProfile.name.trim().length > 0
            ? [
                {
                  id: createId("gm"),
                  name: current.userProfile.name,
                  avatarUrl: current.userProfile.avatarUrl || undefined,
                  role: "leader",
                },
              ]
            : [];

        const newProject: GroupProject = {
          id: createId("gp"),
          courseId: projectData.courseId,
          title: projectData.title,
          description: projectData.description ?? "",
          progress: 0,
          updatedAt: formatLocalDate(),
          members,
          tasks: [],
        };
        set((state) => ({
          groupProjects: [newProject, ...state.groupProjects],
        }));
        return newProject.id;
      },

      updateGroupProject: (projectId, patch) =>
        set((state) => ({
          groupProjects: state.groupProjects.map((p) =>
            p.id === projectId
              ? { ...p, ...patch, updatedAt: formatLocalDate() }
              : p
          ),
        })),

      deleteGroupProject: (projectId) =>
        set((state) => ({
          groupProjects: state.groupProjects.filter((p) => p.id !== projectId),
        })),

      addGroupMember: (projectId, member) => {
        const newMemberId = createId("gm");
        set((state) => ({
          groupProjects: state.groupProjects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  members: [
                    ...p.members,
                    {
                      id: newMemberId,
                      name: member.name,
                      role: member.role ?? "member",
                      major: member.major,
                      avatarUrl: member.avatarUrl,
                    },
                  ],
                  updatedAt: formatLocalDate(),
                }
              : p
          ),
        }));
        return newMemberId;
      },

      updateGroupMember: (projectId, member) =>
        set((state) => ({
          groupProjects: state.groupProjects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  members: p.members.map((m) => (m.id === member.id ? member : m)),
                  updatedAt: formatLocalDate(),
                }
              : p
          ),
        })),

      deleteGroupMember: (projectId, memberId) => {
        const project = get().groupProjects.find((p) => p.id === projectId);
        const target = project?.members.find((m) => m.id === memberId);
        if (!project || !target) return { ok: false, reason: "not_found" };

        // Leader 规则：阻止删除最后一个 leader，避免项目没有负责人
        if (target.role === "leader" && project.members.filter((m) => m.role === "leader").length <= 1) {
          return { ok: false, reason: "last_leader" };
        }

        set((state) => ({
          groupProjects: state.groupProjects.map((p) => {
            if (p.id !== projectId) return p;
            return {
              ...p,
              members: p.members.filter((m) => m.id !== memberId),
              // 被删成员负责的任务变为未分配，不删除任务
              tasks: p.tasks.map((t) =>
                t.assigneeId === memberId ? { ...t, assigneeId: undefined } : t
              ),
              updatedAt: formatLocalDate(),
            };
          }),
        }));
        return { ok: true };
      },

      addGroupTask: (projectId, task) => {
        const newTaskId = createId("gt");
        set((state) => ({
          groupProjects: state.groupProjects.map((p) => {
            if (p.id !== projectId) return p;
            const tasks: GroupTask[] = [
              ...p.tasks,
              {
                id: newTaskId,
                title: task.title,
                assigneeId: task.assigneeId,
                ddl: task.ddl,
                completed: false,
              },
            ];
            return { ...p, tasks, progress: calculateGroupProjectProgress(tasks), updatedAt: formatLocalDate() };
          }),
        }));
        return newTaskId;
      },

      updateGroupTask: (projectId, task) =>
        set((state) => ({
          groupProjects: state.groupProjects.map((p) => {
            if (p.id !== projectId) return p;
            const tasks = p.tasks.map((t) => (t.id === task.id ? task : t));
            return { ...p, tasks, progress: calculateGroupProjectProgress(tasks), updatedAt: formatLocalDate() };
          }),
        })),

      deleteGroupTask: (projectId, taskId) =>
        set((state) => ({
          groupProjects: state.groupProjects.map((p) => {
            if (p.id !== projectId) return p;
            const tasks = p.tasks.filter((t) => t.id !== taskId);
            return { ...p, tasks, progress: calculateGroupProjectProgress(tasks), updatedAt: formatLocalDate() };
          }),
        })),

      toggleGroupTask: (projectId, taskId) =>
        set((state) => ({
          groupProjects: state.groupProjects.map((p) => {
            if (p.id !== projectId) return p;
            const tasks = p.tasks.map((t) =>
              t.id === taskId ? { ...t, completed: !t.completed } : t
            );
            return { ...p, tasks, progress: calculateGroupProjectProgress(tasks), updatedAt: formatLocalDate() };
          }),
        })),
    }),
    {
      name: "classflow-storage-v2",
      // v1 → v2：GroupTask 从 assigneeName/assigneeAvatar 改为 assigneeId
      // v2 → v3：新增 AppPreferences（缺失/部分/非法逐字段回落默认值）
      // v3 → v4：Task V2 —— Assignment ddl 可选 + estimatedMinutes（normalizeAssignment 归一；旧数据 ddl 原值保留）
      // v4 → v5：Task 7G-A1 —— Reminder（旧数据缺失 → []；sanitize 丢弃非法条目）
      // v5 → v6：Task 2 —— Focus Session（旧数据缺失 → []；sanitize 丢弃非法条目）
      version: 6,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): PersistedAppState => ({
        userProfile: state.userProfile,
        semester: state.semester,
        courses: state.courses,
        schedules: state.schedules,
        assignments: state.assignments,
        calendarMarks: state.calendarMarks,
        groupProjects: state.groupProjects,
        studyBlocks: state.studyBlocks,
        assignmentTimeSlice: state.assignmentTimeSlice,
        lastWorkspaceTab: state.lastWorkspaceTab,
        preferences: state.preferences,
        reminders: state.reminders,
        focusSessions: state.focusSessions,
      }),
      migrate: (persistedState) => sanitizePersistedState(persistedState),
      // zustand 在存储为空时也会调用 merge（migratedState=undefined），
      // 此时必须原样保留 currentState（初始演示数据），不能把 undefined 清洗成空数组；
      // 旧数据可能没有 version 键（zustand 不会触发 migrate），
      // 用 merge 兜底：只合并白名单字段，历史 UI 瞬时状态绝不进入 state。
      merge: (persistedState, currentState) => {
        if (persistedState == null) return currentState;
        return {
          ...currentState,
          ...sanitizePersistedState(persistedState),
        };
      },
    }
  )
);

// 启动校正：当前教学周不持久化（避免历史周次过期），
// 每次打开按真实日期计算并 clamp 到 [1, semester.totalWeeks]。
// Settings V3：任务工作区视图不持久化，每次打开按「默认任务视图」偏好 seed。
// P2：首次上线 backfill + 每次 hydrate 的一次性幂等自动提醒 reconcile
//（用户无需打开 Reminder Center；重复 hydrate/reload 不产生重复 auto）。
{
  const state = useAppStore.getState();
  const week = Math.min(
    Math.max(getSemesterWeek(new Date(), state.semester), 1),
    state.semester.totalWeeks
  );
  const reminders = reconcileAllAutomaticDeadlineReminders({
    assignments: state.assignments,
    calendarMarks: state.calendarMarks,
    reminders: state.reminders,
    requestedLead: state.preferences.defaultDeadlineReminderMinutes,
    defaultDDLTime: state.preferences.defaultDDLTime,
    now: nowLocalString(),
  });
  useAppStore.setState({
    currentSemesterWeek: week,
    assignmentWorkspaceView: state.preferences.defaultTaskWorkspaceView,
    reminders,
  });
}
