import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createGuardedStorage, subscribeCrossWindowSync } from "@/lib/persistStorage";
import { useToastStore } from "@/store/useToastStore";
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
  StudyBlockCreateInput,
  StudyBlockUpdatePatch,
  ScheduleOccurrenceOverride,
  BellScheduleTemplate,
  TaskTransitionSource,
} from "@/types";
import { createDefaultSemester, getSemesterWeek } from "@/lib/semester";
import { getLocalDDLDate, parseLocalDDL } from "@/lib/ddl";
import { normalizeAssignment, hasTaskDeadline, isAssignmentPlanningEligible } from "@/lib/tasks/taskSemantics";
import { isValidLocalDate, normalizeLocalDateTime } from "@/lib/time/localWallClock";
import {
  didAssignmentLosePlanningEligibility,
  releaseFutureStudyBlocksForAssignment,
  clearScheduledRemindersForReleasedBlocks,
  reconcileTerminalAssignmentStudyBlocks,
  isStudyBlockPlanningActive,
  validateStudyBlockPlanningWrite,
  validateStudyBlockLinkedCreate,
} from "@/lib/planning/studyBlockLifecycle";
import {
  sanitizeAssignmentMaterialIds,
  sanitizeAssignmentMaterialLinks,
} from "@/lib/tasks/taskMaterials";
import { TaskWorkspaceView } from "@/lib/tasks/taskViews";
import { deleteFileBlob, clearAllFileBlobs } from "@/lib/fileStorage";
import { isLegacyDDLMarkForAssignment, linkLegacyDDLMarks } from "@/lib/calendarMark";
import { createId } from "@/lib/utils";
import { validateScheduleOccurrenceOverride } from "@/lib/scheduleOccurrences";
import { calculateGroupProjectProgress, formatLocalDate, normalizeGroupProject } from "@/lib/groupProject";
import { DEFAULT_PREFERENCES, sanitizePreferences } from "@/lib/preferences";
import { buildNextRecurringAssignment, buildNextRecurringAssignmentV2 } from "@/lib/tasks/taskRecurrence";
import {
  buildTaskReopenPreview,
  buildTaskTransitionPreview,
  TaskFieldPatch,
  TaskReopenInput,
  TaskReopenPreview,
  TaskReopenResult,
  TaskTerminalStatus,
  TaskTransitionPreview,
  TaskTransitionRejected,
  TaskTransitionResult,
  TaskTransitionUndoResult,
} from "@/lib/tasks/taskTransitions";
import {
  cancelScheduledAssignmentReminders,
  cancelScheduledRemindersForReleasedBlocks,
  restoreCancelledRemindersForTask,
} from "@/lib/reminders/reminderCancellation";
import { timeToMinutes } from "@/lib/timeline/timelineGeometry";
import {
  canRestoreWithParentCourse,
  collectAssignmentDeleteSnapshot,
  collectCourseDeleteCascade,
  collectCourseMaterialDeleteSnapshot,
  removeAssignmentDeleteSnapshot,
  removeCourseDeleteCascade,
  restoreAssignmentDeleteSnapshot,
  AssignmentDeleteSnapshot,
  CourseMaterialDeleteSnapshot,
  removeCourseMaterialDeleteSnapshot,
  restoreCourseMaterialDeleteSnapshot,
} from "@/lib/dataDependencies";
import {
  FocusErrorCode,
  FocusMutationResult,
  completeFocusSessionRecord,
  deriveFocusClock,
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
import { reconcileStudyBlockCourseOverlapApprovals } from "@/lib/planning/courseOverlapPolicy";

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

/** Phase 0：transition source → Learning History source */
function historySourceForTransition(
  source: TaskTransitionSource
): ResolvedLearningMutationContext["source"] {
  switch (source) {
    case "kiro":
      return "kiro";
    case "ui":
    case "batch":
      return "manual";
    case "recurrence":
    case "migration":
      return "system";
  }
}

/** Phase 0：reopen 恢复前的简单硬冲突检查（同一天时间重叠） */
function studyBlocksOverlap(a: StudyBlock, b: StudyBlock): boolean {
  if (a.date !== b.date) return false;
  const startA = timeToMinutes(a.startTime);
  const endA = timeToMinutes(a.endTime);
  const startB = timeToMinutes(b.startTime);
  const endB = timeToMinutes(b.endTime);
  if (startA === null || endA === null || startB === null || endB === null) return false;
  return startA < endB && startB < endA;
}

/**
 * Task 7 Change Set V2：reserved-ID 创建任务（与 addAssignment 完全一致：linked DDL mark +
 * auto reminder reconcile + history；仅 ID 由事务层预留，保证 Preflight → Re-preflight → Commit 一致）
 */
function createAssignmentWithId(
  set: (partial: object) => void,
  assignmentData: Omit<Assignment, "id">,
  id: string,
  context?: LearningMutationContext
): string {
  const newAssignment: Assignment = normalizeAssignment({
    ...assignmentData,
    id,
  });
  // Task V2：仅当 Assignment 有合法 DDL 才创建 linked CalendarMark（无 DDL 不建空 date mark）
  const mark = buildAssignmentDDLMark(newAssignment);
  const marks: CalendarMark[] = mark ? [mark] : [];
  set((state: AppState) => {
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
  return id;
}

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
    // Workflow UX V15：released block 不再提供 reminder anchor（relative 创建被拒绝）
    if (!b || !isStudyBlockPlanningActive(b)) return null;
    return getReminderTargetAnchor("studyBlock", b);
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
export function buildAssignmentDDLMark(assignment: Assignment): CalendarMark | null {
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
  /** Bell Schedule：上课节次模板（旧数据可缺失 → []） */
  bellSchedules?: BellScheduleTemplate[];
  /** 当前启用的 Bell Schedule id（旧数据可缺失 → null） */
  activeBellScheduleId?: string | null;
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
  /** Task 7：Schedule Occurrence Override（一次性停课/调课/补课；旧数据可缺失 → []） */
  scheduleOccurrenceOverrides?: ScheduleOccurrenceOverride[];
  // V5A5：旧 persisted `sidebarCollapsed` 由 LegacyPersistedStateV0 兼容读入后忽略，不再输出
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
  scheduleOccurrenceOverrides?: unknown;
  bellSchedules?: unknown;
  activeBellScheduleId?: unknown;
  sidebarCollapsed?: unknown;
}

type ScheduleOccurrenceOverrideInput = {
  kind: "cancel" | "move" | "extra";
  courseId: string;
  baseScheduleId?: string;
  week: number;
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
  location?: string;
  source?: "manual" | "kiro";
};

/** Task 7：按 kind 构建 override（输入字段已在 validateScheduleOccurrenceOverride 校验） */
function buildScheduleOccurrenceOverride(
  input: ScheduleOccurrenceOverrideInput,
  id: string
): ScheduleOccurrenceOverride {
  const source = input.source ?? "manual";
  switch (input.kind) {
    case "cancel":
      return { kind: "cancel", id, courseId: input.courseId, baseScheduleId: input.baseScheduleId!, week: input.week, source };
    case "move":
      return {
        kind: "move",
        id,
        courseId: input.courseId,
        baseScheduleId: input.baseScheduleId!,
        week: input.week,
        dayOfWeek: input.dayOfWeek!,
        startTime: input.startTime!,
        endTime: input.endTime!,
        location: input.location ?? "",
        source,
      };
    case "extra":
      return {
        kind: "extra",
        id,
        courseId: input.courseId,
        week: input.week,
        dayOfWeek: input.dayOfWeek!,
        startTime: input.startTime!,
        endTime: input.endTime!,
        location: input.location ?? "",
        source,
      };
  }
}

const TIME_SLICES: TimeSliceFilter[] = ["all", "overdue", "today", "3days", "7days", "completed"];

const NAV_TABS: NavTab[] = ["today", "overview", "timetable", "assignments", "courses", "kiro", "analytics", "group"];

function isValidSemester(v: unknown): v is Semester {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as Semester).name === "string" &&
    typeof (v as Semester).startDate === "string" &&
    // totalWeeks 非正整数（0/NaN/负数/小数）会让 currentSemesterWeek 钳位异常 → 回落默认学期
    typeof (v as Semester).totalWeeks === "number" &&
    Number.isInteger((v as Semester).totalWeeks) &&
    (v as Semester).totalWeeks >= 1
  );
}

/** hydrate 用户资料归一（纯 cast 会让 name:null 之类透过，渲染层被迫处处判空） */
function normalizeHydratedUserProfile(raw: unknown): UserProfile {
  if (!raw || typeof raw !== "object") return EMPTY_USER_PROFILE;
  const p = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    name: str(p.name),
    avatarUrl: str(p.avatarUrl),
    avatarStorageKey: typeof p.avatarStorageKey === "string" ? p.avatarStorageKey : undefined,
    college: str(p.college),
    grade: str(p.grade),
    studentId: str(p.studentId),
    completedCredits: num(p.completedCredits),
    totalCredits: num(p.totalCredits),
  };
}

/** hydrate 学习计划归一（非法 date/time 整条丢弃——缺一半时间的块渲染必错位） */
function normalizeHydratedStudyBlock(raw: unknown): StudyBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.id !== "string") return null;
  if (typeof b.title !== "string") return null;
  if (typeof b.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return null;
  if (typeof b.startTime !== "string" || !/^\d{2}:\d{2}$/.test(b.startTime)) return null;
  if (typeof b.endTime !== "string" || !/^\d{2}:\d{2}$/.test(b.endTime)) return null;
  const source = b.source === "manual" || b.source === "kiro" ? b.source : undefined;
  const planningState = b.planningState === "released" ? ("released" as const) : undefined;
  // Phase 0：旧 released 无 provenance → legacy；reopen 不会自动恢复无法证明来源的旧计划。
  const releasedBy =
    planningState === "released"
      ? b.releasedBy === "task-submitted" ||
        b.releasedBy === "task-completed" ||
        b.releasedBy === "manual" ||
        b.releasedBy === "rebalance"
        ? b.releasedBy
        : "legacy"
      : undefined;
  const releasedAt = planningState === "released" ? normalizeLocalDateTime(b.releasedAt) : undefined;
  const releasedByTaskId =
    planningState === "released" && typeof b.releasedByTaskId === "string" && b.releasedByTaskId
      ? b.releasedByTaskId
      : undefined;
  return {
    id: b.id,
    title: b.title,
    date: b.date,
    startTime: b.startTime,
    endTime: b.endTime,
    assignmentId: typeof b.assignmentId === "string" ? b.assignmentId : undefined,
    courseId: typeof b.courseId === "string" ? b.courseId : undefined,
    ...(source ? { source } : {}),
    planningState,
    ...(releasedBy ? { releasedBy } : {}),
    ...(releasedAt ? { releasedAt } : {}),
    ...(releasedByTaskId ? { releasedByTaskId } : {}),
    courseOverlapApprovals: Array.isArray(b.courseOverlapApprovals) ? b.courseOverlapApprovals : undefined,
  } as StudyBlock;
}

/** hydrate 作息方案归一（periods 元素逐个校验——坏节次整表丢弃，不带病入库） */
function normalizeHydratedBellSchedule(raw: unknown): BellScheduleTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.id !== "string" || typeof b.name !== "string" || !Array.isArray(b.periods)) return null;
  const periods = (b.periods as unknown[]).filter(
    (p): p is { period: number; startTime: string; endTime: string } =>
      !!p &&
      typeof p === "object" &&
      typeof (p as { period?: unknown }).period === "number" &&
      Number.isInteger((p as { period?: unknown }).period) &&
      typeof (p as { startTime?: unknown }).startTime === "string" &&
      typeof (p as { endTime?: unknown }).endTime === "string"
  );
  if (periods.length === 0) return null;
  return { id: b.id, name: b.name, periods };
}

/**
 * hydrate 归一（courses / schedules / marks / overrides 此前 cast-only，
 * 脏数据缺 materials 等字段即崩渲染或级联删除）：id 系缺失 → 整条丢弃，
 * 其余缺失 → 默认值。行为对标 normalizeAssignment / normalizeReminder。
 */
function normalizeHydratedCourse(raw: unknown): Course | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== "string" || typeof c.name !== "string") return null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    id: c.id,
    name: c.name,
    code: str(c.code),
    teacher: str(c.teacher),
    classroom: str(c.classroom),
    credit: typeof c.credit === "number" && Number.isFinite(c.credit) ? c.credit : 0,
    bgHex: str(c.bgHex),
    borderHex: str(c.borderHex),
    textHex: str(c.textHex),
    description: str(c.description),
    materials: Array.isArray(c.materials)
      ? (c.materials as unknown[]).filter(
          (m): m is Material =>
            !!m && typeof m === "object" && typeof (m as Material).id === "string" && typeof (m as Material).title === "string"
        )
      : [],
  };
}

function normalizeHydratedSchedule(raw: unknown): CourseSchedule | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.id !== "string" || typeof s.courseId !== "string") return null;
  const day = typeof s.dayOfWeek === "number" && Number.isInteger(s.dayOfWeek) ? s.dayOfWeek : 1;
  const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
  return {
    id: s.id,
    courseId: s.courseId,
    dayOfWeek: Math.min(7, Math.max(1, day)),
    startTime: str(s.startTime, "08:00"),
    endTime: str(s.endTime, "09:40"),
    location: str(s.location),
    weeks: str(s.weeks),
    excludedWeeks: Array.isArray(s.excludedWeeks)
      ? (s.excludedWeeks as unknown[]).filter((w): w is number => typeof w === "number" && Number.isInteger(w))
      : undefined,
  };
}

function normalizeHydratedMark(raw: unknown): CalendarMark | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== "string" || typeof m.date !== "string" || typeof m.title !== "string") return null;
  const type = m.type === "course" || m.type === "ddl" || m.type === "exam" || m.type === "activity" ? m.type : "activity";
  return {
    id: m.id,
    date: m.date,
    type,
    title: m.title,
    sourceId: typeof m.sourceId === "string" ? m.sourceId : undefined,
    startTime: typeof m.startTime === "string" ? m.startTime : undefined,
    endTime: typeof m.endTime === "string" ? m.endTime : undefined,
    autoReminderDisabled: m.autoReminderDisabled === true ? true : undefined,
  };
}

function normalizeHydratedOverride(raw: unknown): ScheduleOccurrenceOverride | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.id !== "string" ||
    typeof o.courseId !== "string" ||
    typeof o.week !== "number" ||
    !Number.isInteger(o.week)
  )
    return null;
  const source = o.source === "manual" || o.source === "kiro" ? o.source : undefined;
  if (o.kind === "cancel") {
    if (typeof o.baseScheduleId !== "string") return null;
    return { id: o.id, kind: "cancel", courseId: o.courseId, baseScheduleId: o.baseScheduleId, week: o.week, ...(source ? { source } : {}) };
  }
  // move / extra：时间字段缺失即整条丢弃（缺一半时间的 occurrence 渲染必错位）
  const day = typeof o.dayOfWeek === "number" && Number.isInteger(o.dayOfWeek) ? Math.min(7, Math.max(1, o.dayOfWeek)) : null;
  if (
    typeof o.startTime !== "string" ||
    typeof o.endTime !== "string" ||
    typeof o.location !== "string" ||
    day === null
  )
    return null;
  if (o.kind === "move") {
    if (typeof o.baseScheduleId !== "string") return null;
    return { id: o.id, kind: "move", courseId: o.courseId, baseScheduleId: o.baseScheduleId, week: o.week, dayOfWeek: day, startTime: o.startTime, endTime: o.endTime, location: o.location, ...(source ? { source } : {}) };
  }
  if (o.kind === "extra") {
    return { id: o.id, kind: "extra", courseId: o.courseId, week: o.week, dayOfWeek: day, startTime: o.startTime, endTime: o.endTime, location: o.location, ...(source ? { source } : {}) };
  }
  return null;
}

/**
 * sanitizePersistedState 输入清洗（hydrate 熔断）：
 * 保守策略：业务数组缺失 → []；可选字段非法 → 默认值；UI 瞬时状态一律丢弃。
 */
function sanitizePersistedState(persisted: unknown): PersistedAppState {
  const legacy = (persisted ?? {}) as LegacyPersistedStateV0;
  const assignments = Array.isArray(legacy.assignments)
    ? (legacy.assignments as Assignment[]).map(normalizeAssignment)
    : [];
  const groupProjects = Array.isArray(legacy.groupProjects)
    ? (legacy.groupProjects as GroupProject[]).map(normalizeGroupProject)
    : [];
  // 作息表先归一化：active 必须指向归一化后仍存在的表（原表坏节次被丢弃后不再悬指）
  const bellSchedules = Array.isArray(legacy.bellSchedules)
    ? (legacy.bellSchedules as unknown[])
        .map(normalizeHydratedBellSchedule)
        .filter((b): b is BellScheduleTemplate => b !== null)
    : [];
  const result: PersistedAppState = {
    userProfile: normalizeHydratedUserProfile(legacy.userProfile),
    semester: isValidSemester(legacy.semester) ? legacy.semester : createDefaultSemester(),
    courses: Array.isArray(legacy.courses)
      ? (legacy.courses as unknown[]).map(normalizeHydratedCourse).filter((c): c is Course => c !== null)
      : [],
    schedules: Array.isArray(legacy.schedules)
      ? (legacy.schedules as unknown[]).map(normalizeHydratedSchedule).filter((s): s is CourseSchedule => s !== null)
      : [],
    assignments,
    // 安全位置自动修复：唯一可确定的 legacy mark 补 sourceId
    calendarMarks: linkLegacyDDLMarks(
      assignments,
      (Array.isArray(legacy.calendarMarks) ? legacy.calendarMarks as unknown[] : [])
        .map(normalizeHydratedMark)
        .filter((m): m is CalendarMark => m !== null)
    ),
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
    // v4：Timeline V1 学习计划（旧数据缺失 → []；非法条目丢弃）
    studyBlocks: Array.isArray(legacy.studyBlocks)
      ? (legacy.studyBlocks as unknown[])
          .map(normalizeHydratedStudyBlock)
          .filter((b): b is StudyBlock => b !== null)
      : [],
    // v5：Reminder（旧数据缺失 → []；非法条目丢弃）
    reminders: Array.isArray(legacy.reminders)
      ? (legacy.reminders as Reminder[]).map(normalizeReminder).filter((r): r is Reminder => r !== null)
      : [],
    // v6：Focus Session（旧数据缺失 → []；非法条目丢弃）
    focusSessions: Array.isArray(legacy.focusSessions)
      ? (legacy.focusSessions as FocusSession[]).map(normalizeFocusSession).filter((f): f is FocusSession => f !== null)
      : [],
    // v7：Schedule Occurrence Override（旧数据缺失 → []；非法条目丢弃，不触碰既有 schedules）
    scheduleOccurrenceOverrides: Array.isArray(legacy.scheduleOccurrenceOverrides)
      ? (legacy.scheduleOccurrenceOverrides as unknown[])
          .map(normalizeHydratedOverride)
          .filter((o): o is ScheduleOccurrenceOverride => o !== null)
      : [],
    // v8：Bell Schedule（旧数据缺失 → []；非法表/坏节次丢弃；active 悬指回落 null）
    bellSchedules,
    activeBellScheduleId:
      typeof legacy.activeBellScheduleId === "string" &&
      bellSchedules.some((b) => b.id === legacy.activeBellScheduleId)
        ? legacy.activeBellScheduleId
        : null,
  };

  // Workflow UX V15：Legacy Terminal Data Reconciliation（幂等）——
  // 旧数据允许「terminal Assignment + 未来 active StudyBlock + scheduled reminder」共存；
  // hydrate 时统一修复（past block 保持；active parent 不触碰；非法 planningState 视为 active）
  const reconciled = reconcileTerminalAssignmentStudyBlocks({
    assignments: result.assignments,
    studyBlocks: result.studyBlocks ?? [],
    reminders: result.reminders ?? [],
    now: Date.now(),
  });
  return { ...result, studyBlocks: reconciled.studyBlocks, reminders: reconciled.reminders };
}

/** deleteSchedule 的完整删除快照：schedule 本体 + 被级联删除的一次性 override
 *  （cancel/move 挂在 base schedule 上；不快照则撤销会静默丢失它们 —— BUG-032） */
export interface ScheduleDeleteSnapshot {
  schedule: CourseSchedule;
  removedOverrides: ScheduleOccurrenceOverride[];
}

export interface AppState {
  // Navigation & UI State
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  /** 上次使用的工作区 Tab（持久化；供 startupView=last 使用） */
  lastWorkspaceTab: NavTab;
  /** Overview compact AssignmentTable 的时间筛选（持久 view state；非 Assignment Workspace 偏好） */
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
  /** Workflow UX V4：Group Project Deep Link——transient UI selection（跨 Workspace 精确直达）。
   *  不持久化（不在 partialize 白名单）；GroupCollaborationView 统一经 resolved project 消费。 */
  selectedGroupProjectId: string | null;
  setSelectedGroupProjectId: (id: string | null) => void;
  /** Workflow UX V8：Assignment → Timeline ArrangeSheet 的一次性 navigation intent。
   *  pending 表达「待消费」语义；transient 不持久化；consume once 后即清 null。 */
  pendingTimelineArrangeAssignmentId: string | null;
  setPendingTimelineArrangeAssignmentId: (id: string | null) => void;
  /** Workflow UX V11：live timer 完成 → Assignment Drawer follow-up 的一次性 UI intent。
   *  跨 FocusRuntime（global）→ AssignmentDrawer（entity owner）持有事实目标；
   *  不是业务数据、不持久化（不在 partialize 白名单）；consume once 后即清 null。 */
  pendingFocusCompletionFollowUp: { assignmentId: string; sessionId: string } | null;
  setPendingFocusCompletionFollowUp: (intent: { assignmentId: string; sessionId: string } | null) => void;
  /** Workflow UX V12：GroupTask Deep Link intent——Timeline / Global Search → Group Workspace
   *  精确展示某一任务。完整 identity = projectId + taskId（Domain: GroupProject.tasks[]）；
   *  transient 不持久化；consume once（scroll/focus exact row 后清 null）。 */
  pendingGroupTaskTarget: { projectId: string; taskId: string } | null;
  setPendingGroupTaskTarget: (target: { projectId: string; taskId: string } | null) => void;
  isSearchModalOpen: boolean;
  setSearchModalOpen: (open: boolean) => void;
  /** 设置中心 Modal：侧边栏 / 底部导航 / 命令面板统一入口 */
  isSettingsModalOpen: boolean;
  setSettingsModalOpen: (open: boolean) => void;
  /** 外部请求打开的设置 section（如 Kiro「配置 AI 服务」）；SettingsView 消费后清空 */
  settingsTargetSection: SettingsSection | null;
  /** 可选目标设置行（复用搜索跳转的滚动 + 高亮；section 同时作为回退） */
  settingsTargetSettingId: string | null;
  setSettingsTargetSection: (section: SettingsSection | null, settingId?: string | null) => void;
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
  /** Task 7：一次性停课/调课/补课（recurring schedule 的周级例外；不改变 base schedule） */
  scheduleOccurrenceOverrides: ScheduleOccurrenceOverride[];
  /** Bell Schedule：上课节次模板（课表导入节次→时间解析的唯一来源） */
  bellSchedules: BellScheduleTemplate[];
  activeBellScheduleId: string | null;

  // Actions
  /** 新增/替换 Bell Schedule 模板 */
  upsertBellSchedule: (template: BellScheduleTemplate) => void;
  /** 删除 Bell Schedule；若为当前激活项则回落 */
  removeBellSchedule: (id: string) => void;
  /** 设置当前激活的 Bell Schedule */
  setActiveBellSchedule: (id: string | null) => void;
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
  ) => ScheduleDeleteSnapshot | null;
  /** 撤销删除：恢复原 Schedule（保留原 ID）+ 其被级联删除的一次性 override；
   *  幂等（重复调用 no-op，不产生重复 History）；parent Course 已删 → 拒绝 */
  restoreSchedule: (
    schedule: CourseSchedule,
    context?: LearningMutationContext,
    removedOverrides?: ScheduleOccurrenceOverride[]
  ) => void;
  excludeWeekFromSchedule: (
    scheduleId: string,
    week: number,
    context?: LearningMutationContext
  ) => void;

  // Task 7：Schedule Occurrence Override（一次性停课/调课/补课）
  /** 创建 override（先经 validateScheduleOccurrenceOverride：唯一性 + 该周 effective 冲突检查） */
  addScheduleOccurrenceOverride: (
    override: ScheduleOccurrenceOverrideInput
  ) => { ok: true; id: string } | { ok: false; code: string; message: string };
  /** Task 7 Change Set V2：reserved-ID 创建 override（仅事务层使用） */
  addScheduleOccurrenceOverrideWithId: (
    override: ScheduleOccurrenceOverrideInput,
    id: string
  ) => { ok: true; id: string } | { ok: false; code: string; message: string };
  /** 删除 override（返回被删对象供撤销） */
  deleteScheduleOccurrenceOverride: (overrideId: string) => ScheduleOccurrenceOverride | null;
  /** 撤销删除：恢复原 override（原 ID） */
  restoreScheduleOccurrenceOverride: (override: ScheduleOccurrenceOverride) => void;
  /** 原子替换：同 baseScheduleId+week 的 active override 先删后建（ID 新生成；Delete old + create replacement） */
  replaceScheduleOccurrenceOverride: (
    override: ScheduleOccurrenceOverrideInput
  ) => { ok: true; id: string } | { ok: false; code: string; message: string };
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
  deleteCourseMaterial: (
    courseId: string,
    materialId: string
  ) => CourseMaterialDeleteSnapshot | null;
  /**
   * 撤销删除（Workflow UX V6）：relation-level merge——
   * 恢复资料原 index + 补回被删 Assignment relation（不覆盖窗口内 concurrent edits）。
   * 目标 Course 已不存在 → false（不生成 orphan material）；调用方仍可清理 Blob。
   */
  restoreCourseMaterial: (snapshot: CourseMaterialDeleteSnapshot) => boolean;

  // Assignment Actions
  /** 创建任务，返回新任务 id（History context 可选；UI 默认 manual） */
  addAssignment: (assignment: Omit<Assignment, "id">, context?: LearningMutationContext) => string;
  /** Task 7 Change Set V2：reserved-ID 创建（仅事务层使用；Preflight → Re-preflight → Commit 同一实体 ID） */
  addAssignmentWithId: (
    assignment: Omit<Assignment, "id">,
    id: string,
    context?: LearningMutationContext
  ) => string;
  updateAssignment: (updatedAssignment: Assignment, context?: LearningMutationContext) => void;
  /** Task V2：字段级 patch（未来 Kiro update_task 的稳定 Domain API；DDL mark 三态同步内置） */
  updateAssignmentPatch: (
    id: string,
    patch: Partial<Omit<Assignment, "id">>,
    context?: LearningMutationContext
  ) => void;
  /** Phase 0：只写非生命周期字段；closed 任务限制 planning 字段 */
  updateTaskFields: (id: string, patch: TaskFieldPatch, context?: LearningMutationContext) => void;
  /** Phase 0：设置/清除 doDate（仅 active） */
  setTaskDoDate: (id: string, doDate: string | null, context?: LearningMutationContext) => void;
  /** Phase 0：terminal transition 预览（无副作用） */
  previewTaskTransition: (
    id: string,
    to: TaskTerminalStatus,
    transitionId?: string
  ) => TaskTransitionPreview | null;
  /** Phase 0：原子提交/完成（preview → apply） */
  transitionTask: (
    id: string,
    to: TaskTerminalStatus,
    input: { transitionId: string; source: TaskTransitionSource; batchId?: string }
  ) => TaskTransitionResult | TaskTransitionRejected;
  /** Phase 0：撤销最近一次 terminal transition */
  undoTaskTransition: (id: string, transitionId: string) => TaskTransitionUndoResult;
  /** Phase 0：重新打开预览（可恢复 blocks/reminders/child） */
  previewTaskReopen: (id: string) => TaskReopenPreview | null;
  /** Phase 0：重新打开并可选恢复 */
  reopenTask: (id: string, input: TaskReopenInput) => TaskReopenResult;
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
  /** 创建学习计划，返回新 id。
   *  Workflow UX V17：Store = Final Planning Authority——assignmentId 指向的 Assignment
   *  必须存在且 planning eligible（todo/doing），否则 reject 返回 null（0 side effect：
   *  不创建 block / 不写 History / 不写 Reminder；禁止静默降级 standalone）。
   *  standalone（无 assignmentId）正常允许。 */
  addStudyBlock: (
    block: StudyBlockCreateInput,
    context?: LearningMutationContext
  ) => string | null;
  /** Atomic Batch：一次性生成全部 ID，单次 set。
   *  Workflow UX V17：All-or-None fresh validation——任一项 linked Assignment missing /
   *  terminal → 整批 reject 返回 null（0 mutation）；空 batch 合法返回 []。 */
  addStudyBlocksBatch: (
    blocks: StudyBlockCreateInput[],
    context?: LearningMutationContext
  ) => StudyBlock[] | null;
  /** 更新学习计划。
   *  Workflow UX V17：released block 一律拒绝（historical plan 不可编辑，delete 允许）；
   *  active linked block 要求 parent 存在且 planning eligible（覆盖 drag→complete race
   *  与 terminal parent 的历史 block）。成功 true；target 不存在 / 被 boundary 拒绝 → false
   *  （0 side effect：不动 Reminder / 不写 History）。 */
  updateStudyBlock: (
    id: string,
    patch: StudyBlockUpdatePatch,
    context?: LearningMutationContext
  ) => boolean;
  /** Atomic Batch Update（Rebalance Apply / Undo）：单次 set；全部成功或全部不动（null）；只改 date/startTime/endTime。
   *  Workflow UX V17：preflight 增加每项 write-boundary gate——released / parent missing /
   *  parent terminal 任一命中 → null（0 mutation、0 History）。 */
  updateStudyBlocksBatch: (
    updates: {
      id: string;
      patch: {
        date: string;
        startTime: string;
        endTime: string;
        /**
         * Course Overlap Approval 显式值（Constraint V1.1）：
         * 缺省 → 按 mutation source 对账（manual 自动接受 / kiro 只保留仍有效项）；
         * 数组 → 直接使用（Rebalance Undo 恢复原 Approval）；null → 清空（Rebalance Apply 移到无重叠位置）。
         */
        courseOverlapApprovals?: import("@/lib/planning/courseOverlapPolicy").StudyBlockCourseOverlapApproval[] | null;
      };
    }[],
    context?: LearningMutationContext
  ) => { before: StudyBlock[]; after: StudyBlock[] } | null;
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
  /** 撤销删除：按原 id/位置恢复（不产生新 id，保持深链与引用稳定） */
  restoreGroupTask: (projectId: string, task: GroupTask, index?: number) => void;
  toggleGroupTask: (projectId: string, taskId: string) => void;
}

/**
 * Hydration 失败标记（模块级 transient，不持久化）。
 * true = 本次启动 persist rehydrate 失败（localStorage 损坏 / 读取异常），
 * Store 处于初始空态而非真实用户数据。启动 Blob 对账据此跳过 GC（fail-closed），
 * 防止把「看不见引用」误判为「没有引用」而清光课程附件。
 */
let mainStoreHydrationFailed = false;

export function didMainStoreHydrationFail(): boolean {
  return mainStoreHydrationFailed;
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

      // Transient selection（不持久化）：Search Deep Link / Group Workspace 共享
      selectedGroupProjectId: null,
      setSelectedGroupProjectId: (id) => set({ selectedGroupProjectId: id }),

      // Workflow UX V8：Arrange deep link intent（consume once）
      pendingTimelineArrangeAssignmentId: null,
      setPendingTimelineArrangeAssignmentId: (id) =>
        set({ pendingTimelineArrangeAssignmentId: id }),

      // Workflow UX V11：Focus timer 完成 → follow-up handoff intent（transient，consume once）
      pendingFocusCompletionFollowUp: null,
      setPendingFocusCompletionFollowUp: (intent) =>
        set({ pendingFocusCompletionFollowUp: intent }),

      // Workflow UX V12：GroupTask deep link intent（transient，consume once）
      pendingGroupTaskTarget: null,
      setPendingGroupTaskTarget: (target) =>
        set({ pendingGroupTaskTarget: target }),

      isSearchModalOpen: false,
      setSearchModalOpen: (open) => set({ isSearchModalOpen: open }),
      isSettingsModalOpen: false,
      setSettingsModalOpen: (open) => set({ isSettingsModalOpen: open }),
      settingsTargetSection: null,
      settingsTargetSettingId: null,
      setSettingsTargetSection: (section, settingId = null) =>
        set({
          settingsTargetSection: section,
          settingsTargetSettingId: section ? settingId : null,
        }),
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
      scheduleOccurrenceOverrides: [],
      bellSchedules: [],
      activeBellScheduleId: null,

      upsertBellSchedule: (template) =>
        set((state) => ({
          bellSchedules: state.bellSchedules.some((b) => b.id === template.id)
            ? state.bellSchedules.map((b) => (b.id === template.id ? template : b))
            : [...state.bellSchedules, template],
          activeBellScheduleId: state.activeBellScheduleId ?? template.id,
        })),
      removeBellSchedule: (id) =>
        set((state) => {
          const next = state.bellSchedules.filter((b) => b.id !== id);
          return {
            bellSchedules: next,
            activeBellScheduleId:
              state.activeBellScheduleId === id ? (next[0]?.id ?? null) : state.activeBellScheduleId,
          };
        }),
      setActiveBellSchedule: (id) =>
        set((state) => ({
          activeBellScheduleId:
            id === null || state.bellSchedules.some((b) => b.id === id) ? id : state.activeBellScheduleId,
        })),

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
        // 作息表属于学习数据域，一并清空避免旧方案残留
        set({
          courses: [],
          schedules: [],
          assignments: [],
          calendarMarks: [],
          groupProjects: [],
          studyBlocks: [],
          reminders: [],
          focusSessions: [],
          scheduleOccurrenceOverrides: [],
          bellSchedules: [],
          activeBellScheduleId: null,
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
          scheduleOccurrenceOverrides: [],
          bellSchedules: [],
          activeBellScheduleId: null,
          semester: createDefaultSemester(),
          activeTab: "overview",
          lastWorkspaceTab: "overview",
          currentSemesterWeek: 1,
          assignmentTimeSlice: "all",
          preferences: DEFAULT_PREFERENCES,
          selectedCourseId: null,
          selectedAssignmentId: null,
          selectedCalendarMarkId: null,
          selectedGroupProjectId: null,
          pendingTimelineArrangeAssignmentId: null,
          pendingFocusCompletionFollowUp: null,
          pendingGroupTaskTarget: null,
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
        // 归一丢条计数（恢复后 toast 明示；此前总数按清洗前计数，用户数着课程恢复完却少了）
        let droppedRestore = 0;
        const inputLen = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
        set((state) => {
          // 恢复与 hydrate 同一归一口径：脏备份（手改 JSON / 旧版本缺字段）不得直写入库
          const assignments = data.assignments.map(normalizeAssignment);
          const courses = Array.isArray(data.courses)
            ? (data.courses as unknown[])
                .map(normalizeHydratedCourse)
                .filter((c): c is Course => c !== null)
            : [];
          const schedules = Array.isArray(data.schedules)
            ? (data.schedules as unknown[])
                .map(normalizeHydratedSchedule)
                .filter((s): s is CourseSchedule => s !== null)
            : [];
          const calendarMarks = linkLegacyDDLMarks(
            assignments,
            (Array.isArray(data.calendarMarks) ? (data.calendarMarks as unknown[]) : [])
              .map(normalizeHydratedMark)
              .filter((m): m is CalendarMark => m !== null)
          );
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
          // Workflow UX V15：backup import 同样执行 legacy terminal reconciliation（幂等）
          const reconciledRestore = reconcileTerminalAssignmentStudyBlocks({
            assignments,
            studyBlocks: Array.isArray(data.studyBlocks)
              ? (data.studyBlocks as unknown[])
                  .map(normalizeHydratedStudyBlock)
                  .filter((b): b is StudyBlock => b !== null)
              : [],
            reminders,
            now: Date.now(),
          });
          // 作息方案：备份缺失 → 保留当前（旧备份不清空用户作息表）
          const bellSchedules = Array.isArray(data.bellSchedules)
            ? (data.bellSchedules as unknown[])
                .map(normalizeHydratedBellSchedule)
                .filter((b): b is BellScheduleTemplate => b !== null)
            : state.bellSchedules;
          const activeBellScheduleId =
            typeof data.activeBellScheduleId === "string" &&
            bellSchedules.some((b) => b.id === data.activeBellScheduleId)
              ? data.activeBellScheduleId
              : Array.isArray(data.bellSchedules)
                ? (bellSchedules[0]?.id ?? null)
                : state.activeBellScheduleId;
          // 学期非法（totalWeeks 非正整数等）→ 保留当前学期；周钳位用有效周数，防 NaN 污染
          const restoredSemester = isValidSemester(data.semester) ? data.semester : state.semester;
          const restoredTotalWeeks = restoredSemester.totalWeeks;
          // 归一丢条计数：输入条数 - 落库条数（提醒/计划经 reconcile 增补只多不少，不计入；
          // 日历 legacy 转换可能增补，单项钳零避免掩盖真实丢弃）
          const drop = (input: unknown, kept: number): number =>
            Math.max(0, inputLen(input) - kept);
          droppedRestore =
            drop(data.courses, courses.length) +
            drop(data.schedules, schedules.length) +
            drop(data.calendarMarks, calendarMarks.length) +
            drop(data.reminders, restoredReminders.length) +
            drop(data.studyBlocks, reconciledRestore.studyBlocks.length) +
            (Array.isArray(data.bellSchedules) ? drop(data.bellSchedules, bellSchedules.length) : 0) +
            (Array.isArray(data.scheduleOccurrenceOverrides)
              ? drop(
                  data.scheduleOccurrenceOverrides,
                  (data.scheduleOccurrenceOverrides as unknown[])
                    .map(normalizeHydratedOverride)
                    .filter((o) => o !== null).length
                )
              : 0);
          return {
            userProfile:
              data.userProfile && typeof data.userProfile === "object"
                ? normalizeHydratedUserProfile(data.userProfile)
                : state.userProfile,
            semester: restoredSemester,
            courses,
            schedules,
            assignments,
            calendarMarks,
            groupProjects: data.groupProjects.map(normalizeGroupProject),
            studyBlocks: reconciledRestore.studyBlocks,
            preferences,
            reminders: reconciledRestore.reminders,
            focusSessions: Array.isArray(data.focusSessions)
              ? data.focusSessions.map(normalizeFocusSession).filter((f): f is FocusSession => f !== null)
              : [],
            // Task 7：旧备份缺失 → []（不破坏旧数据恢复）；非法条目丢弃
            scheduleOccurrenceOverrides: Array.isArray(data.scheduleOccurrenceOverrides)
              ? (data.scheduleOccurrenceOverrides as unknown[])
                  .map(normalizeHydratedOverride)
                  .filter((o): o is ScheduleOccurrenceOverride => o !== null)
              : [],
            bellSchedules,
            activeBellScheduleId,
            // 恢复后教学周按恢复的学期重算（此前沿用恢复前周次，跨学期备份 timetable/outlook 全偏）
            currentSemesterWeek: Math.min(
              Math.max(getSemesterWeek(new Date(), restoredSemester), 1),
              restoredTotalWeeks
            ),
          };
        });
        if (droppedRestore > 0) {
          console.warn(`[restore] ${droppedRestore} 条非法数据已丢弃（脏备份/旧版本缺字段）`);
          try {
            useToastStore.getState().pushToast({
              message: `备份中有 ${droppedRestore} 条数据格式非法已跳过`,
              type: "warning",
            });
          } catch {
            /* toast 未就绪不阻塞恢复 */
          }
        }
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
        // 防御：部分持久化数据（cast-only hydration）可能缺 materials 数组 → 同步 TypeError 会打断级联删除
        const deletedMaterials = Array.isArray(cascade.course.materials) ? cascade.course.materials : [];
        deletedMaterials.forEach((m) => {
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
        //    DDL marks + course/assignment-owned StudyBlocks + 受影响 Reminder + Task 7 临时调整）
        set((state) => {
          const next = removeCourseDeleteCascade(state, cascade);
          const deletedAssignmentIds = new Set(cascade.assignments.map((a) => a.id));
          const deletedMarkIds = new Set(cascade.calendarMarks.map((m) => m.id));
          return {
            ...next,
            selectedCourseId: state.selectedCourseId === courseId ? null : state.selectedCourseId,
            selectedAssignmentId:
              state.selectedAssignmentId !== null && deletedAssignmentIds.has(state.selectedAssignmentId)
                ? null
                : state.selectedAssignmentId,
            // 级联删除的 DDL mark 若正被选中 → 一并清理（不留 stale id）
            selectedCalendarMarkId:
              state.selectedCalendarMarkId !== null && deletedMarkIds.has(state.selectedCalendarMarkId)
                ? null
                : state.selectedCalendarMarkId,
            assignmentPeekId:
              state.assignmentPeekId !== null && deletedAssignmentIds.has(state.assignmentPeekId)
                ? null
                : state.assignmentPeekId,
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
        if (!target) return null;
        enqueueLearningHistoryEvents([
          buildScheduleDeletedEvent({
            schedule: target,
            context: resolveLearningMutationContext(context),
            environment: historyEnvironment(current),
          }),
        ]);
        // BUG-032：cancel/move override 级联删除必须进入快照，撤销时一并恢复
        const removedOverrides = current.scheduleOccurrenceOverrides.filter(
          (o) => o.kind !== "extra" && o.baseScheduleId === scheduleId
        );
        set({
          schedules: current.schedules.filter((s) => s.id !== scheduleId),
          scheduleOccurrenceOverrides: current.scheduleOccurrenceOverrides.filter(
            (o) => o.kind === "extra" || o.baseScheduleId !== scheduleId
          ),
        });
        return { schedule: target, removedOverrides };
      },

      restoreSchedule: (schedule, context, removedOverrides) =>
        set((state) => {
          // 幂等：重复撤销（toast 双击）→ 已存在则整体 no-op（不重复插入、不重复 History）
          if (state.schedules.some((s) => s.id === schedule.id)) {
            return {};
          }
          // Undo 窗口并发防御：parent Course 已删除 → 拒绝恢复（不产生 dangling courseId）
          if (!canRestoreWithParentCourse(state, schedule.courseId)) {
            return {};
          }
          enqueueLearningHistoryEvents([
            buildScheduleCreatedEvent({
              schedule,
              context: resolveLearningMutationContext(context),
              environment: historyEnvironment(state),
              restored: true,
            }),
          ]);
          // 被级联删除的 cancel/move override 一并恢复（id 去重；baseScheduleId 必然重新存在）
          const restoredOverrides = (removedOverrides ?? []).filter(
            (o) => !state.scheduleOccurrenceOverrides.some((x) => x.id === o.id)
          );
          return {
            schedules: [...state.schedules, schedule],
            scheduleOccurrenceOverrides:
              restoredOverrides.length > 0
                ? [...state.scheduleOccurrenceOverrides, ...restoredOverrides]
                : state.scheduleOccurrenceOverrides,
          };
        }),

      // ---- Task 7：Schedule Occurrence Override ----
      addScheduleOccurrenceOverride: (input) => {
        const state = get();
        const validation = validateScheduleOccurrenceOverride(input, {
          schedules: state.schedules,
          overrides: state.scheduleOccurrenceOverrides,
          totalWeeks: state.semester.totalWeeks,
          courses: state.courses,
        });
        if (!validation.ok) return validation;
        const override = buildScheduleOccurrenceOverride(input, createId("occ"));
        set({ scheduleOccurrenceOverrides: [...state.scheduleOccurrenceOverrides, override] });
        return { ok: true, id: override.id };
      },

      addScheduleOccurrenceOverrideWithId: (input, id) => {
        const state = get();
        const validation = validateScheduleOccurrenceOverride(input, {
          schedules: state.schedules,
          overrides: state.scheduleOccurrenceOverrides,
          totalWeeks: state.semester.totalWeeks,
          courses: state.courses,
        });
        if (!validation.ok) return validation;
        const override = buildScheduleOccurrenceOverride(input, id);
        set({ scheduleOccurrenceOverrides: [...state.scheduleOccurrenceOverrides, override] });
        return { ok: true, id: override.id };
      },

      deleteScheduleOccurrenceOverride: (overrideId) => {
        const current = get();
        const target = current.scheduleOccurrenceOverrides.find((o) => o.id === overrideId) ?? null;
        if (target) {
          set({
            scheduleOccurrenceOverrides: current.scheduleOccurrenceOverrides.filter(
              (o) => o.id !== overrideId
            ),
          });
        }
        return target;
      },

      restoreScheduleOccurrenceOverride: (override) =>
        set((state) => {
          // Undo 窗口并发防御（BUG-033）：base schedule / course 已删 → 拒绝恢复，
          // 不插入 dangling baseScheduleId/courseId（与 assignment/schedule restore 同一契约）
          if (override.kind !== "extra") {
            const baseExists = state.schedules.some((s) => s.id === override.baseScheduleId);
            const courseExists = state.courses.some((c) => c.id === override.courseId);
            if (!baseExists || !courseExists) return {};
          }
          return {
            scheduleOccurrenceOverrides: state.scheduleOccurrenceOverrides.some((o) => o.id === override.id)
              ? state.scheduleOccurrenceOverrides
              : [...state.scheduleOccurrenceOverrides, override],
          };
        }),

      replaceScheduleOccurrenceOverride: (input) => {
        // 原子替换：删除同 baseScheduleId+week 的旧 active override，再创建新 override（单次 set）
        const state = get();
        const validation = validateScheduleOccurrenceOverride(input, {
          schedules: state.schedules,
          // 校验时不把将替换的旧 override 算作重复 → 先排除同 slot 的旧 override
          overrides: state.scheduleOccurrenceOverrides.filter(
            (o) =>
              o.kind === "extra" ||
              input.kind === "extra" ||
              !(o.week === input.week && (o as { baseScheduleId?: string }).baseScheduleId === input.baseScheduleId)
          ),
          totalWeeks: state.semester.totalWeeks,
          courses: state.courses,
        });
        if (!validation.ok) return validation;
        const override = buildScheduleOccurrenceOverride(input, createId("occ"));
        const replaced = state.scheduleOccurrenceOverrides.filter(
          (o) =>
            !(
              o.kind !== "extra" &&
              o.week === override.week &&
              (o as { baseScheduleId?: string }).baseScheduleId === (override as { baseScheduleId?: string }).baseScheduleId
            )
        );
        set({ scheduleOccurrenceOverrides: [...replaced, override] });
        return { ok: true, id: override.id };
      },

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
        // 仅移除 metadata；Blob 由调用方在撤销窗口结束后延迟删除。
        // Workflow UX V6：snapshot capture（material + 原 index + 受影响 assignment relations）
        const snapshot = collectCourseMaterialDeleteSnapshot(get(), courseId, materialId);
        if (!snapshot) return null;
        set((state) => {
          // 原子 mutation：Course material 删除 + Assignment relations 清理同一 set
          const next = removeCourseMaterialDeleteSnapshot(state, snapshot);
          return { courses: next.courses, assignments: next.assignments };
        });
        return snapshot;
      },

      restoreCourseMaterial: (snapshot) => {
        // 目标 Course 已不存在 → no-op / false（不凭空重建 Course，不生成 orphan material）；
        // 调用方据 false 仍执行 Blob cleanup。恢复为原子 set：material + relations 同一变换。
        const next = restoreCourseMaterialDeleteSnapshot(get(), snapshot);
        if (!next) return false;
        set({ courses: next.courses, assignments: next.assignments });
        return true;
      },

      addAssignment: (assignmentData, context) =>
        createAssignmentWithId(
          set,
          // Workflow UX V7：create boundary 同一 invariant（Resource → Task Promotion 安全前提）
          sanitizeAssignmentMaterialLinks(assignmentData, get().courses),
          createId("a"),
          context
        ),

      // Task 7 Change Set V2：reserved-ID 创建（仅事务层使用；Preflight → Re-preflight → Commit 同一实体 ID）
      addAssignmentWithId: (assignmentData, id, context) =>
        createAssignmentWithId(
          set,
          sanitizeAssignmentMaterialLinks(assignmentData, get().courses),
          id,
          context
        ),

      updateAssignment: (updatedAssignment, context) =>
        set((state) => {
          const normalized = normalizeAssignment(updatedAssignment);
          // Stale-writer 防御（BUG：MiniCalendar timeEdit 对已删除任务写回 →
          // map 是 no-op，但下方 mark 同步会为幻影 id 新建 DDL CalendarMark）。
          // 不存在的 assignment id → 整个 update no-op。
          if (!state.assignments.some((a) => a.id === normalized.id)) {
            return {};
          }
          // Workflow UX V7：Material relation invariant —— 写入边界统一按 next.courseId
          // 重新校验 materialIds（跨课程 / 已删资料清除；空 → undefined）。
          // 无论调用方是 updateAssignmentPatch / setAssignmentMaterialIds / 其它 Domain
          // action，都不可能写入 dangling relation。DDL mark / Reminder / History /
          // recurrence completion 的既有顺序全部保持不变。
          const next = sanitizeAssignmentMaterialLinks(
            normalized,
            state.courses
          );
          const oldAssignment = state.assignments.find((a) => a.id === next.id);
          const hasDdl = hasTaskDeadline(next);
          const newDdlDate = getLocalDDLDate(next.ddl);

          // Update assignment object in place, preserving ID
          let newAssignments = state.assignments.map((a) =>
            a.id === next.id ? next : a
          );
          let newReminders = state.reminders;
          let newStudyBlocks = state.studyBlocks;
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
          const removedLinkedMarkIds = new Set<string>();
          let newCalendarMarks = state.calendarMarks.map((m) => {
            if (m.sourceId === next.id) {
              if (!hasDdl) {
                removedLinkedMarkIds.add(m.id);
                return null; // C：删除
              }
              return {
                ...m,
                date: newDdlDate,
                title: next.title,
                sourceId: next.id,
              };
            }
            if (oldAssignment && isLegacyDDLMarkForAssignment(m, oldAssignment)) {
              if (!hasDdl) {
                removedLinkedMarkIds.add(m.id);
                return null; // C：删除
              }
              return {
                ...m,
                date: newDdlDate,
                title: next.title,
                sourceId: next.id,
              };
            }
            return m;
          }).filter((m): m is CalendarMark => m !== null);

          // BUG-051：case C 删除 linked mark 时，指向该 mark 的提醒必须级联移除
          //（与 deleteCalendarMark 同语义；此前 void matchedId 丢弃 → 提醒在死目标上照常触发）
          if (removedLinkedMarkIds.size > 0) {
            newReminders = newReminders.filter(
              (r) =>
                !(
                  r.targetType === "calendarMark" &&
                  r.targetId !== undefined &&
                  removedLinkedMarkIds.has(r.targetId)
                )
            );
          }

          // B：无关联 mark 且存在 DDL → 新建（避免重复：确认过滤后无同 id mark）
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

          // Workflow UX V15：eligible → terminal（submitted / completed，含 Full Editor 保存）→
          // 同一 set 内释放未来 StudyBlocks + 清理 scheduled reminder（无中间态）
          if (oldAssignment && didAssignmentLosePlanningEligibility(oldAssignment.status, next.status)) {
            const released = releaseFutureStudyBlocksForAssignment({
              studyBlocks: newStudyBlocks,
              assignmentId: next.id,
              now: Date.now(),
              releasedBy: next.status === "submitted" ? "task-submitted" : "task-completed",
              releasedAt: nowLocalString(),
            });
            newStudyBlocks = released.studyBlocks;
            newReminders = clearScheduledRemindersForReleasedBlocks(
              newReminders,
              new Set(released.releasedIds)
            );
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
            studyBlocks: newStudyBlocks,
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

      // ---- Phase 0：Task Lifecycle Commands ----

      updateTaskFields: (id, patch, context) => {
        const current = get().assignments.find((a) => a.id === id);
        if (!current) return;
        const safe: Record<string, unknown> = { ...patch };
        if (current.status === "submitted" || current.status === "completed") {
          // closed 任务不允许改 planning 字段；先 reopen 再编辑
          for (const field of [
            "ddl",
            "estimatedMinutes",
            "courseId",
            "recurrence",
            "submissionRequired",
            "doDate",
          ]) {
            delete safe[field];
          }
        }
        get().updateAssignment(
          {
            ...current,
            ...safe,
            id,
            // 运行时防御：即使 caller 传入 lifecycle 字段也不改
            status: current.status,
            progress: current.progress,
          } as Assignment,
          context
        );
      },

      setTaskDoDate: (id, doDate, context) => {
        const current = get().assignments.find((a) => a.id === id);
        if (!current) return;
        if (current.status === "submitted" || current.status === "completed") return;
        if (doDate !== null && !isValidLocalDate(doDate)) return;
        get().updateAssignment(
          { ...current, doDate: doDate ?? undefined },
          context
        );
      },

      previewTaskTransition: (id, to, transitionId) => {
        const state = get();
        const task = state.assignments.find((a) => a.id === id);
        if (!task) return null;
        return buildTaskTransitionPreview({
          task,
          studyBlocks: state.studyBlocks,
          reminders: state.reminders,
          focusSessions: state.focusSessions,
          assignments: state.assignments,
          now: new Date(),
          nowLocal: nowLocalString(),
          transitionId: transitionId ?? createId("tt"),
          toStatus: to,
        });
      },

      transitionTask: (id, to, input) => {
        const state = get();
        const task = state.assignments.find((a) => a.id === id);
        if (!task) return { ok: false, blocker: "not-found" };

        // idempotent：同一 transitionId 重试 → 直接返回上次结果，不重复副作用
        if (task.lastTerminalTransition?.id === input.transitionId) {
          return {
            ok: true,
            transitionId: input.transitionId,
            taskId: id,
            appliedStatus: task.lastTerminalTransition.toStatus,
            releasedStudyBlockIds: task.lastTerminalTransition.releasedStudyBlockIds,
            cancelledReminderIds: task.lastTerminalTransition.cancelledReminderIds,
            generatedRecurrenceId: task.lastTerminalTransition.generatedRecurrenceId,
          };
        }
        if (task.status === to) {
          return { ok: false, blocker: "already-completed" };
        }

        const now = new Date();
        const nowLocal = nowLocalString();
        const preview = buildTaskTransitionPreview({
          task,
          studyBlocks: state.studyBlocks,
          reminders: state.reminders,
          focusSessions: state.focusSessions,
          assignments: state.assignments,
          now,
          nowLocal,
          transitionId: input.transitionId,
          toStatus: to,
        });
        if (preview.blockers.includes("focus-running")) {
          return { ok: false, blocker: "focus-running" };
        }
        if (preview.blockers.includes("already-completed")) {
          return { ok: false, blocker: "already-completed" };
        }

        const released = releaseFutureStudyBlocksForAssignment({
          studyBlocks: state.studyBlocks,
          assignmentId: id,
          now: now.getTime(),
          releasedBy: to === "submitted" ? "task-submitted" : "task-completed",
          releasedAt: nowLocal,
        });
        const releasedSet = new Set(released.releasedIds);
        const blockTaskIds = new Map(
          state.studyBlocks.map((block) => [block.id, block.assignmentId])
        );
        const cancelAssignment = cancelScheduledAssignmentReminders(
          state.reminders,
          id,
          to === "submitted" ? "task-submitted" : "task-completed",
          nowLocal
        );
        const cancelBlocks = cancelScheduledRemindersForReleasedBlocks(
          cancelAssignment.reminders,
          releasedSet,
          blockTaskIds,
          nowLocal
        );
        const cancelledReminderIds = [
          ...cancelAssignment.cancelledIds,
          ...cancelBlocks.cancelledIds,
        ];

        const terminalTask: Assignment = {
          ...task,
          status: to,
          submittedAt: to === "submitted" ? nowLocal : task.submittedAt,
          completedAt: to === "completed" ? nowLocal : task.completedAt,
        };
        const hasExistingChild = state.assignments.some(
          (candidate) => candidate.recurrenceParentId === id
        );
        const shouldSpawn =
          isAssignmentPlanningEligible(task) &&
          !!task.recurrence &&
          !!task.ddl &&
          !task.recurrenceSpawnedAt &&
          !hasExistingChild;
        const childDraft = shouldSpawn
          ? buildNextRecurringAssignmentV2(terminalTask, now)
          : null;
        const child = childDraft
          ? normalizeAssignment({ ...childDraft, id: createId("a") })
          : null;
        const childMark = child ? buildAssignmentDDLMark(child) : null;

        const previous = task.lastTerminalTransition;
        const generatedRecurrenceId = previous?.generatedRecurrenceId ?? child?.id;
        const lastTerminalTransition: NonNullable<Assignment["lastTerminalTransition"]> = {
          id: input.transitionId,
          at: nowLocal,
          fromStatus: task.status,
          toStatus: to,
          activeStatusBeforeTerminal:
            task.status === "todo" || task.status === "doing"
              ? task.status
              : (previous?.activeStatusBeforeTerminal ?? "doing"),
          releasedStudyBlockIds: [
            ...new Set([...(previous?.releasedStudyBlockIds ?? []), ...released.releasedIds]),
          ],
          cancelledReminderIds: [
            ...new Set([...(previous?.cancelledReminderIds ?? []), ...cancelledReminderIds]),
          ],
          ...(generatedRecurrenceId ? { generatedRecurrenceId } : {}),
          ...(input.batchId ? { batchId: input.batchId } : {}),
          source: input.source,
        };

        const updatedTask: Assignment = {
          ...terminalTask,
          lastTerminalTransition,
          ...(child ? { recurrenceSpawnedAt: nowLocal } : {}),
        };

        const assignments = state.assignments.map((candidate) =>
          candidate.id === id ? updatedTask : candidate
        );
        if (child) assignments.push(child);
        const calendarMarks = childMark
          ? [...state.calendarMarks, childMark]
          : state.calendarMarks;
        const reminders = reconcileAllAuto({
          assignments,
          calendarMarks,
          reminders: cancelBlocks.reminders,
          preferences: state.preferences,
        });

        set({
          assignments,
          calendarMarks,
          reminders,
          studyBlocks: released.studyBlocks,
        });

        const resolved = resolveLearningMutationContext({
          source: historySourceForTransition(input.source),
        });
        const events = deriveAssignmentTransitionEvents({
          before: task,
          after: updatedTask,
          context: resolved,
          completionTrigger: "status",
          environment: historyEnvironment(state),
        });
        if (child) {
          events.push(
            buildAssignmentCreatedEvent({
              assignment: child,
              context: { ...resolved, source: "system" },
              environment: historyEnvironment(state),
            })
          );
        }
        enqueueLearningHistoryEvents(events);

        return {
          ok: true,
          transitionId: input.transitionId,
          taskId: id,
          appliedStatus: to,
          releasedStudyBlockIds: released.releasedIds,
          cancelledReminderIds,
          ...(child ? { generatedRecurrenceId: child.id } : {}),
        };
      },

      undoTaskTransition: (id, transitionId) => {
        const state = get();
        const task = state.assignments.find((a) => a.id === id);
        if (!task || task.lastTerminalTransition?.id !== transitionId) {
          return {
            ok: false,
            restoredStatus: task?.status ?? "todo",
            restoredStudyBlockIds: [],
            restoredReminderIds: [],
            skipped: [{ kind: "recurrence", id: transitionId, reason: "transition-not-found" }],
          };
        }
        const source = task.lastTerminalTransition.source;
        const result = get().reopenTask(id, {
          restoreStudyBlocks: true,
          restoreReminders: true,
          deletePristineRecurrence: true,
          transitionId,
          source,
        });
        const restored = get().assignments.find((a) => a.id === id);
        return {
          ok: result.ok,
          restoredStatus: restored?.status ?? task.status,
          restoredStudyBlockIds: result.restoredStudyBlockIds,
          restoredReminderIds: result.restoredReminderIds,
          ...(result.deletedRecurrenceId
            ? { deletedRecurrenceId: result.deletedRecurrenceId }
            : {}),
          skipped: result.skipped,
        };
      },

      previewTaskReopen: (id) => {
        const state = get();
        const task = state.assignments.find((a) => a.id === id);
        if (!task) return null;
        return buildTaskReopenPreview({
          task,
          studyBlocks: state.studyBlocks,
          reminders: state.reminders,
          assignments: state.assignments,
          now: new Date(),
          nowLocal: nowLocalString(),
        });
      },

      reopenTask: (id, input) => {
        const state = get();
        const task = state.assignments.find((a) => a.id === id);
        if (!task || (task.status !== "submitted" && task.status !== "completed")) {
          return {
            ok: false,
            taskId: id,
            appliedStatus: "doing",
            restoredStudyBlockIds: [],
            restoredReminderIds: [],
            skipped: [{ kind: "recurrence", id, reason: "not-closed" }],
          };
        }

        const now = new Date();
        const nowLocal = nowLocalString();
        const preview = buildTaskReopenPreview({
          task,
          studyBlocks: state.studyBlocks,
          reminders: state.reminders,
          assignments: state.assignments,
          now,
          nowLocal,
        });
        if (!preview) {
          return {
            ok: false,
            taskId: id,
            appliedStatus: "doing",
            restoredStudyBlockIds: [],
            restoredReminderIds: [],
            skipped: [{ kind: "recurrence", id, reason: "preview-failed" }],
          };
        }

        const skipped: TaskReopenResult["skipped"] = [];
        const restorableBlockIds = new Set(
          preview.restorableStudyBlocks.map((block) => block.id)
        );
        const activeBlocksBefore = state.studyBlocks.filter(
          (block) => block.planningState !== "released"
        );
        const restoredStudyBlockIds: string[] = [];
        let studyBlocks = state.studyBlocks;
        if (input.restoreStudyBlocks) {
          studyBlocks = state.studyBlocks.map((block) => {
            if (!restorableBlockIds.has(block.id)) return block;
            const conflict = activeBlocksBefore.some(
              (active) => active.id !== block.id && studyBlocksOverlap(active, block)
            );
            if (conflict) {
              skipped.push({ kind: "study-block", id: block.id, reason: "conflict" });
              return block;
            }
            restoredStudyBlockIds.push(block.id);
            return {
              ...block,
              planningState: undefined,
              releasedAt: undefined,
              releasedBy: undefined,
              releasedByTaskId: undefined,
            };
          });
        }

        const restoredReminderIds: string[] = [];
        let reminders = state.reminders;
        if (input.restoreReminders) {
          const validAssignmentIds = new Set(
            state.assignments
              .filter((assignment) => isAssignmentPlanningEligible(assignment))
              .map((assignment) => assignment.id)
          );
          validAssignmentIds.add(id);
          const validStudyBlockIds = new Set(
            studyBlocks
              .filter(
                (block) =>
                  block.planningState !== "released" &&
                  (block.assignmentId === id || restoredStudyBlockIds.includes(block.id))
              )
              .map((block) => block.id)
          );
          const restored = restoreCancelledRemindersForTask({
            reminders,
            taskId: id,
            transitionAt: task.lastTerminalTransition?.at ?? nowLocal,
            now: nowLocal,
            validAssignmentIds,
            validStudyBlockIds,
            validCalendarMarkIds: new Set(state.calendarMarks.map((mark) => mark.id)),
          });
          reminders = restored.reminders;
          restoredReminderIds.push(...restored.restoredIds);
          for (const skippedId of restored.skippedIds) {
            skipped.push({ kind: "reminder", id: skippedId, reason: "not-restorable" });
          }
        }

        let assignments = state.assignments;
        let calendarMarks = state.calendarMarks;
        let deletedRecurrenceId: string | undefined;
        const child = preview.recurrenceChild;
        const childAssignment = child
          ? state.assignments.find((candidate) => candidate.id === child.id)
          : undefined;
        if (input.deletePristineRecurrence && child?.pristine) {
          const snapshot = collectAssignmentDeleteSnapshot(state, child.id);
          if (snapshot) {
            const removed = removeAssignmentDeleteSnapshot(
              { ...state, studyBlocks, reminders },
              snapshot
            );
            assignments = removed.assignments;
            calendarMarks = removed.calendarMarks;
            studyBlocks = removed.studyBlocks;
            reminders = removed.reminders;
            deletedRecurrenceId = child.id;
          }
        }

        const updatedTask: Assignment = {
          ...task,
          status: preview.toStatus,
          submittedAt: undefined,
          completedAt: undefined,
          lastTerminalTransition: undefined,
          ...(deletedRecurrenceId ? { recurrenceSpawnedAt: undefined } : {}),
        };
        assignments = assignments.map((candidate) =>
          candidate.id === id ? updatedTask : candidate
        );
        reminders = reconcileAllAuto({
          assignments,
          calendarMarks,
          reminders,
          preferences: state.preferences,
        });

        set({ assignments, calendarMarks, reminders, studyBlocks });

        const resolved = resolveLearningMutationContext({
          source: historySourceForTransition(input.source),
        });
        const events = deriveAssignmentTransitionEvents({
          before: task,
          after: updatedTask,
          context: resolved,
          completionTrigger: "status",
          environment: historyEnvironment(state),
        });
        if (deletedRecurrenceId && childAssignment) {
          events.push(
            buildAssignmentLifecycleEvent(
              "assignment.deleted",
              childAssignment,
              resolved,
              state
            )
          );
        }
        enqueueLearningHistoryEvents(events);

        return {
          ok: true,
          taskId: id,
          appliedStatus: preview.toStatus,
          restoredStudyBlockIds,
          restoredReminderIds,
          ...(deletedRecurrenceId ? { deletedRecurrenceId } : {}),
          skipped,
        };
      },

      /**
       * Task 6A：设置任务关联的课程资料 ID。
       * Workflow UX V7：invariant 由 updateAssignment 写入边界统一保证——
       * 此处不再 pre-sanitize（避免第二套校验）；跨课程 / 已删 ID 在边界被清除，
       * 空结果 → undefined。DDL mark 同步为 no-op（relation-only change）。
       */
      setAssignmentMaterialIds: (assignmentId, materialIds) => {
        const current = get().assignments.find((a) => a.id === assignmentId);
        if (!current) return;
        get().updateAssignment({ ...current, materialIds });
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
          let studyBlocks = state.studyBlocks;
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
          // Workflow UX V15：eligible → terminal（submitted / completed）→
          // 同一 set 内释放未来 StudyBlocks 并清理其 scheduled reminder（无中间态）
          if (target && didAssignmentLosePlanningEligibility(target.status, status)) {
            const released = releaseFutureStudyBlocksForAssignment({
              studyBlocks,
              assignmentId: id,
              now: Date.now(),
              releasedBy: status === "submitted" ? "task-submitted" : "task-completed",
              releasedAt: nowLocalString(),
            });
            studyBlocks = released.studyBlocks;
            reminders = clearScheduledRemindersForReleasedBlocks(
              reminders,
              new Set(released.releasedIds)
            );
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
          return { assignments, calendarMarks, reminders, studyBlocks };
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
          let studyBlocks = state.studyBlocks;
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
          // Workflow UX V15：progress 驱动的 eligible → terminal → release future blocks（原子）
          if (target && updated && didAssignmentLosePlanningEligibility(target.status, updated.status)) {
            const released = releaseFutureStudyBlocksForAssignment({
              studyBlocks,
              assignmentId: id,
              now: Date.now(),
              releasedBy: updated.status === "submitted" ? "task-submitted" : "task-completed",
              releasedAt: nowLocalString(),
            });
            studyBlocks = released.studyBlocks;
            reminders = clearScheduledRemindersForReleasedBlocks(
              reminders,
              new Set(released.releasedIds)
            );
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
          return { assignments, calendarMarks, reminders, studyBlocks };
        }),

      /**
       * Phase 0：子任务只改变自身 completed 状态。
       * - 不写 status / progress
       * - 不触发 terminal side effects / recurrence
       * - closed 任务只读（先 reopen）
       */
      toggleSubtask: (assignmentId, subtaskId) =>
        set((state) => {
          const target = state.assignments.find((a) => a.id === assignmentId);
          if (!target || !isAssignmentPlanningEligible(target) || !target.subtasks) return {};
          const assignments = state.assignments.map((a) => {
            if (a.id !== assignmentId || !a.subtasks) return a;
            return {
              ...a,
              subtasks: a.subtasks.map((st) =>
                st.id === subtaskId ? { ...st, completed: !st.completed } : st
              ),
            };
          });
          return { assignments };
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
          // Undo 窗口并发防御：parent Course 已删除 → 拒绝恢复（不产生 orphan 引用）
          if (!canRestoreWithParentCourse(state, snapshot.assignment.courseId)) {
            return {};
          }
          // 幂等：重复撤销（toast 双击 140ms 退出窗口）→ 已存在则整体 no-op，
          // 不产生重复 History（BUG-035：enqueue 曾先于 dedupe 执行）
          if (state.assignments.some((a) => a.id === snapshot.assignment.id)) {
            return {};
          }
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
            ...restoreAssignmentDeleteSnapshot(state, snapshot)!,
          };
        }),

      // ---- Timeline V1：StudyBlock（学习计划）----
      addStudyBlock: (blockData, context) => {
        // Workflow UX V17：write boundary——validation 成功后才生成 id / 触发任何 side effect。
        // linked Assignment missing / terminal → reject（null）：0 Store mutation、0 History、0 Reminder；
        // 禁止静默降级 standalone、禁止为 terminal parent 自动创建 released block。
        const gate = validateStudyBlockLinkedCreate(blockData.assignmentId, get().assignments);
        if (!gate.ok) return null;
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
        // Workflow UX V17：空 batch = 合法空 mutation（区别于 reject 的 null）；
        // 任一项 linked Assignment missing / terminal → 整批 reject 返回 null（All-or-None，0 mutation）
        if (blocksData.length === 0) return [];
        const gate = get().assignments;
        for (const b of blocksData) {
          const check = validateStudyBlockLinkedCreate(b.assignmentId, gate);
          if (!check.ok) return null;
        }
        const created: StudyBlock[] = blocksData.map((b) => ({
          id: createId("sb"),
          title: b.title,
          date: b.date,
          startTime: b.startTime,
          endTime: b.endTime,
          assignmentId: b.assignmentId,
          courseId: b.courseId,
          source: b.source ?? "manual",
          // V1.1：Approval Gate 显式批准的课程重叠（Block × Schedule 版本级别；无则 undefined）
          courseOverlapApprovals: b.courseOverlapApprovals,
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
      updateStudyBlock: (id, patch, context) => {
        // Workflow UX V17：write boundary——fresh 读取 current block + linked parent：
        // released / parent missing / parent terminal → 拒绝（false；0 side effect，
        // 不动 Reminder / 不写 History）；standalone active 与 eligible parent 正常放行
        const current = get();
        const prev = current.studyBlocks.find((b) => b.id === id);
        if (!prev) return false;
        const gate = validateStudyBlockPlanningWrite(prev, current.assignments);
        if (!gate.ok) return false;
        set((state) => {
          const blocks = state.studyBlocks.map((b) => (b.id === id ? { ...b, ...patch } : b));
          let reminders = state.reminders;
          // Task 7G-A1：date / startTime 变化 → 同步 relative reminders（absolute 不动）
          const next = blocks.find((b) => b.id === id);
          if (prev && next && (prev.date !== next.date || prev.startTime !== next.startTime)) {
            reminders = reconcileTargetReminders(
              reminders,
              "studyBlock",
              id,
              getReminderTargetAnchor("studyBlock", next),
              nowLocalString()
            );
          }
          // Course Overlap Approval 对账（Constraint Semantics V1.1）：
          // manual 拖动 → 当前 overlaps 记为明确接受；kiro/system/import → 不创造新 Approval，只保留仍有效项
          if (prev && next) {
            const resolved = resolveLearningMutationContext(context);
            const approvals = reconcileStudyBlockCourseOverlapApprovals({
              before: prev,
              after: next,
              schedules: state.schedules,
              semester: state.semester,
              mutationSource: resolved.source,
              occurredAt: resolved.occurredAt,
            });
            const idx = blocks.findIndex((b) => b.id === id);
            if (idx >= 0) blocks[idx] = { ...blocks[idx], courseOverlapApprovals: approvals };
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
        });
        return true;
      },
      updateStudyBlocksBatch: (updates, context) => {
        const current = get();
        // All-or-None：重复 ID、任何 ID 不存在、或任一 write-boundary 命中
        //（released / parent missing / parent terminal）→ 0 mutation
        const seen = new Set<string>();
        for (const u of updates) {
          if (seen.has(u.id)) return null;
          seen.add(u.id);
          const block = current.studyBlocks.find((b) => b.id === u.id);
          if (!block) return null;
          // Workflow UX V17：Rebalance race 封口——preview 后 block released 或
          // parent terminal，旧 proposal Apply/Undo 都不得移动历史计划
          const gate = validateStudyBlockPlanningWrite(block, current.assignments);
          if (!gate.ok) return null;
        }
        const before: StudyBlock[] = [];
        const after: StudyBlock[] = [];
        set((state) => {
          // 先计算 before/after + 真实变化（供 History 与返回值）
          for (const u of updates) {
            const prev = state.studyBlocks.find((b) => b.id === u.id)!;
            before.push({ ...prev });
            const next = { ...prev, date: u.patch.date, startTime: u.patch.startTime, endTime: u.patch.endTime };
            // Course Overlap Approval：显式值优先；否则按 mutation source 对账
            if (Object.prototype.hasOwnProperty.call(u.patch, "courseOverlapApprovals")) {
              const explicit = u.patch.courseOverlapApprovals;
              next.courseOverlapApprovals = explicit && explicit.length > 0 ? explicit : undefined;
            } else {
              const resolved = resolveLearningMutationContext(context);
              next.courseOverlapApprovals = reconcileStudyBlockCourseOverlapApprovals({
                before: prev,
                after: next,
                schedules: state.schedules,
                semester: state.semester,
                mutationSource: resolved.source,
                occurredAt: resolved.occurredAt,
              });
            }
            after.push(next);
          }
          // History（best-effort）：只记录真实变化；同一 batch 共享 resolved context
          const resolved = resolveLearningMutationContext(context);
          const env = historyEnvironment(state);
          const events = before
            .map((prev, i) => {
              const next = after[i];
              return buildStudyBlockUpdatedEvent({ before: prev, after: next, context: resolved, environment: env });
            })
            .filter((e): e is NonNullable<typeof e> => e !== null);
          if (events.length > 0) enqueueLearningHistoryEvents(events);
          // Reminder：date/startTime 变化 → relative reminders 同步到新锚点（同一次 state 计算）
          let reminders = state.reminders;
          for (const u of updates) {
            const prev = before.find((b) => b.id === u.id)!;
            const next = after.find((b) => b.id === u.id)!;
            if (prev.date !== next.date || prev.startTime !== next.startTime) {
              reminders = reconcileTargetReminders(
                reminders,
                "studyBlock",
                u.id,
                getReminderTargetAnchor("studyBlock", next),
                nowLocalString()
              );
            }
          }
          const byId = new Map(after.map((b) => [b.id, b]));
          return {
            studyBlocks: state.studyBlocks.map((b) => byId.get(b.id) ?? b),
            reminders,
          };
        });
        return { before, after };
      },
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
        // Workflow UX V15：released StudyBlock 一律不得新建 scheduled reminder
        //（absolute 与 relative 同拒——不只挡 relative）
        if (input.targetType === "studyBlock") {
          const targetBlock = state.studyBlocks.find(
            (b) => b.id === (input.targetId ?? "")
          );
          if (targetBlock && !isStudyBlockPlanningActive(targetBlock)) return null;
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
          // Undo 窗口并发防御（BUG-034）：target 已删除 → 拒绝恢复 orphan reminder
          //（Kiro delete_reminder undo 路径；UI 用户删除无 undo，不受影响）
          const targetAlive = (() => {
            switch (reminder.targetType) {
              case "assignment":
                return state.assignments.some((a) => a.id === reminder.targetId);
              case "studyBlock":
                return state.studyBlocks.some((b) => b.id === reminder.targetId);
              case "calendarMark":
                return state.calendarMarks.some((m) => m.id === reminder.targetId);
              case "standalone":
                return true;
              default:
                return false;
            }
          })();
          if (!targetAlive) return {};
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
        // paused 仅允许在 remaining=0 的到点边界被 runtime 结算（见 getFocusRuntimeDecision）；
        // 其余 paused 会话保持冻结，等待用户继续或手动结束，避免提前完成被记为 timer。
        if (
          !target ||
          (target.status !== "running" &&
            (target.status !== "paused" || deriveFocusClock(target, t).remainingMs > 0))
        ) {
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

      updateGroupMember: (projectId, member) => {
        const project = get().groupProjects.find((p) => p.id === projectId);
        const existing = project?.members.find((m) => m.id === member.id);
        // Leader 规则：与删除同口径——不允许把唯一 leader 降级，避免项目零负责人
        if (
          existing?.role === "leader" &&
          member.role !== "leader" &&
          project!.members.filter((m) => m.role === "leader").length <= 1
        ) {
          return;
        }
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
        }));
      },

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

      restoreGroupTask: (projectId, task, index) =>
        set((state) => ({
          groupProjects: state.groupProjects.map((p) => {
            if (p.id !== projectId || p.tasks.some((t) => t.id === task.id)) return p;
            const tasks = [...p.tasks];
            const at = Math.max(0, Math.min(index ?? tasks.length, tasks.length));
            tasks.splice(at, 0, task);
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
      // v6 → v7：Task 7 —— Schedule Occurrence Override（旧数据缺失 → []；backward compatible）
      // v7 → v8：Bell Schedule（旧数据缺失 → []；backward compatible）
      version: 8,
      storage: createGuardedStorage(() =>
        useToastStore.getState().pushToast({
          message: "本地存储空间已满，最新更改可能无法保存，请备份后清理空间。",
          type: "error",
        })
      ),
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
        scheduleOccurrenceOverrides: state.scheduleOccurrenceOverrides,
        bellSchedules: state.bellSchedules,
        activeBellScheduleId: state.activeBellScheduleId,
      }),
      migrate: (persistedState, version) => {
        // 未来版本降级保护：v8 之后的结构旧代码读不懂，静默整形会永久丢字段；
        // 拒载并保留当前初始态（merge 遇 undefined 即保留），提示用户升级应用
        if (typeof version === "number" && version > 8) {
          console.warn(`[useAppStore] unsupported persist version v${version}，已跳过载入，请升级应用`);
          try {
            useToastStore.getState().pushToast({
              message: "本地数据来自更新的版本，已跳过载入以保护数据。请升级应用后重启。",
              type: "error",
            });
          } catch {
            /* toast 未就绪不阻塞水合 */
          }
          return undefined as never;
        }
        return sanitizePersistedState(persistedState);
      },
      // Hydration 结果监控：localStorage 损坏（JSON.parse 失败 / getItem 抛错）时
      // zustand 会静默吞掉错误并把 Store 留在初始空态。若不记录，启动 Blob 对账会把
      // 「引用集合为空」当成真实状态，删除全部课程附件 Blob（不可逆数据放大损失）。
      // didMainStoreHydrationFail() 供启动 reconcile 做 fail-closed 门禁。
      onRehydrateStorage: () => (state, error) => {
        mainStoreHydrationFailed = !!error;
        if (error) {
          // 显式诊断：损坏的持久化数据不再无声丢失
          console.error(
            "[useAppStore] persist rehydration failed；启动 Blob 对账将跳过 GC（fail-closed）。",
            error
          );
          // P0：损坏启动给横幅（此前仅 console）：用户看到空库时知道是损坏保护而非数据丢失，
          // 新建写入前先备份，避免空快照覆盖最后一份好数据
          try {
            useToastStore.getState().pushToast({
              message: "本地数据读取失败，已进入保护模式（附件不会被清理）。请先备份，再新建或恢复数据。",
              type: "error",
            });
          } catch {
            /* toast 未就绪不阻塞水合 */
          }
        }
        // P1 水合收敛：week/视图 seed/自动提醒 reconcile 等水合后一次性初始化
        //（此前模块尾 import 时抢跑，覆盖水合值并重复生成 auto Reminder；
        // zustand v4 无 onFinishHydration，用 onRehydrateStorage 回调承载，成功/失败都收敛一次）
        try {
          applyStartupCalibration();
        } catch {
          /* 启动校正失败不阻塞主流程 */
        }
      },
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
// P1：水合后执行（onFinishHydration 主路径；此处保留同步兜底，供 persist 不可用/测试环境）。
let startupCalibrated = false;
function applyStartupCalibration(): void {
  if (startupCalibrated) return;
  startupCalibrated = true;
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
{
  // persist 可用时等 onFinishHydration；不可用（测试/SSR）时同步兜底一次
  try {
    const persist = (useAppStore as unknown as { persist?: { hasHydrated?: () => boolean } }).persist;
    if (!persist || persist.hasHydrated?.()) {
      applyStartupCalibration();
    }
    // 未水合：onFinishHydration 回调负责；此处不抢跑
  } catch {
    applyStartupCalibration();
  }
}

// 跨窗口收敛：他窗写入同 key 后去抖 rehydrate（单窗口写时无 storage 事件，零开销）
subscribeCrossWindowSync(useAppStore, "classflow-storage-v2");
