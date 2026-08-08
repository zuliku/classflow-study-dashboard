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
  ScheduleConflict,
  Semester,
  ClassFlowBackupData,
  Material,
  TimeSliceFilter,
  AppPreferences,
  SettingsSection,
} from "@/types";
import { createDefaultSemester, getSemesterWeek } from "@/lib/semester";
import { getLocalDDLDate } from "@/lib/ddl";
import { deleteFileBlob, clearAllFileBlobs } from "@/lib/fileStorage";
import { isDDLMarkForAssignment, isLegacyDDLMarkForAssignment, linkLegacyDDLMarks } from "@/lib/calendarMark";
import { createId } from "@/lib/utils";
import { calculateGroupProjectProgress, formatLocalDate, normalizeGroupProject } from "@/lib/groupProject";
import { DEFAULT_PREFERENCES, sanitizePreferences } from "@/lib/preferences";

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
  /** 任务列表时间筛选：用户偏好，保留并在缺失时回落 "all" */
  assignmentTimeSlice?: TimeSliceFilter;
  /** 上次使用的工作区 Tab（仅记录 workspace，设置不是 Tab） */
  lastWorkspaceTab?: NavTab;
  /** 应用偏好：v2 旧数据可缺失，sanitize 逐字段补默认值 */
  preferences?: AppPreferences;
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
    ? (legacy.assignments as Assignment[])
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

  // App Preferences（稳定用户偏好，持久化）
  preferences: AppPreferences;
  updatePreferences: (patch: Partial<AppPreferences>) => void;

  semester: Semester;
  setSemester: (semester: Semester) => void;
  currentSemesterWeek: number;
  setCurrentSemesterWeek: (week: number) => void;
  resetToCurrentWeek: () => void;

  // Selected Entities for Drawers & Modals
  selectedCourseId: string | null;
  setSelectedCourseId: (id: string | null) => void;
  selectedAssignmentId: string | null;
  setSelectedAssignmentId: (id: string | null) => void;
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
    scheduleSlots: Omit<CourseSchedule, "id" | "courseId">[]
  ) => string;
  updateCourse: (course: Course) => void;
  deleteCourse: (courseId: string) => void;
  /** 创建单个排课，返回新排课 id */
  addScheduleSlot: (schedule: Omit<CourseSchedule, "id">) => string;
  updateSchedule: (schedule: CourseSchedule) => void;
  deleteSchedule: (scheduleId: string) => CourseSchedule | null;
  /** 撤销删除：恢复原 Schedule（保留原 ID） */
  restoreSchedule: (schedule: CourseSchedule) => void;
  excludeWeekFromSchedule: (scheduleId: string, week: number) => void;
  importSchedules: (
    newCourses: Course[],
    newSchedules: CourseSchedule[]
  ) => void;

  // Material Actions
  addCourseMaterial: (
    courseId: string,
    material: { title: string; type: Material["type"]; size?: string; url?: string; storageKey?: string }
  ) => void;
  /** 删除资料：仅移除 Zustand metadata；Blob 由调用方在撤销窗口结束后延迟删除 */
  deleteCourseMaterial: (courseId: string, materialId: string) => Material | null;
  /** 撤销删除：恢复资料 metadata（Blob 未被删除） */
  restoreCourseMaterial: (courseId: string, material: Material) => void;

  // Assignment Actions
  /** 创建任务，返回新任务 id */
  addAssignment: (assignment: Omit<Assignment, "id">) => string;
  updateAssignment: (updatedAssignment: Assignment) => void;
  updateAssignmentStatus: (
    id: string,
    status: Assignment["status"]
  ) => void;
  updateAssignmentPriority: (
    id: string,
    priority: Assignment["priority"]
  ) => void;
  updateAssignmentProgress: (id: string, progress: number) => void;
  toggleSubtask: (assignmentId: string, subtaskId: string) => void;
  /** 删除任务：返回被删任务与对应的 DDL CalendarMark（含兼容匹配），供撤销恢复 */
  deleteAssignment: (id: string) => { assignment: Assignment; marks: CalendarMark[] } | null;
  /** 撤销删除：恢复任务及对应 CalendarMark（保留原始 ID 与全部字段） */
  restoreAssignment: (assignment: Assignment, marks: CalendarMark[]) => void;

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
      preferences: DEFAULT_PREFERENCES,
      updatePreferences: (patch) =>
        set((state) => ({
          // immutable merge；patch 字段先经 sanitize 逐字段回落，防非法值入库
          preferences: sanitizePreferences({ ...state.preferences, ...patch }),
        })),
      semester: createDefaultSemester(),
      setSemester: (semester) =>
        set((state) => ({
          semester,
          currentSemesterWeek: Math.min(
            Math.max(state.currentSemesterWeek, 1),
            semester.totalWeeks
          ),
        })),
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
      setSelectedAssignmentId: (id) => set({ selectedAssignmentId: id }),

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

      updateUserProfile: (profile) =>
        set((state) => ({
          userProfile: { ...state.userProfile, ...profile },
        })),

      resetPreferences: () => {
        // 只恢复偏好，不影响课程/任务/个人资料/学期
        set({ preferences: DEFAULT_PREFERENCES });
      },

      clearLearningData: () => {
        // 同步清空 IndexedDB 附件 Blob（fire-and-forget）
        clearAllFileBlobs().catch(() => {});
        // 清空业务数据；保留 userProfile / semester / preferences
        set({
          courses: [],
          schedules: [],
          assignments: [],
          calendarMarks: [],
          groupProjects: [],
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
        // 真正 First Run State：空白个人资料 + 空业务数据 + 默认偏好，无任何演示数据
        set({
          userProfile: EMPTY_USER_PROFILE,
          courses: [],
          schedules: [],
          assignments: [],
          calendarMarks: [],
          groupProjects: [],
          semester: createDefaultSemester(),
          currentSemesterWeek: 1,
          assignmentTimeSlice: "all",
          preferences: DEFAULT_PREFERENCES,
          selectedCourseId: null,
          selectedAssignmentId: null,
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

      restoreAppData: (data) =>
        set((state) => ({
          userProfile: data.userProfile,
          semester: data.semester,
          courses: data.courses,
          schedules: data.schedules,
          assignments: data.assignments,
          // 备份恢复为安全位置：唯一可确定的 legacy mark 自动补 sourceId
          calendarMarks: linkLegacyDDLMarks(data.assignments, data.calendarMarks),
          // 备份恢复同样归一 GroupProject（v1 备份 → v2 schema）
          groupProjects: data.groupProjects.map(normalizeGroupProject),
          // preferences：旧备份（v1 data 无该字段）缺失时保留当前偏好，不做覆盖
          preferences: data.preferences
            ? sanitizePreferences(data.preferences)
            : state.preferences,
          currentSemesterWeek: Math.min(
            Math.max(state.currentSemesterWeek, 1),
            data.semester.totalWeeks
          ),
        })),

      addCourseWithSchedule: (courseData, scheduleSlots) => {
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

        set((state) => ({
          courses: [...state.courses, newCourse],
          schedules: [...state.schedules, ...newSchedules],
        }));
        return courseId;
      },

      updateCourse: (updatedCourse) =>
        set((state) => ({
          courses: state.courses.map((c) => (c.id === updatedCourse.id ? updatedCourse : c)),
        })),

      deleteCourse: (courseId) => {
        const current = get();
        const targetCourse = current.courses.find((c) => c.id === courseId);

        // 1. 同步清理该课程关联资料的 Blob（fire-and-forget，失败不阻塞）
        targetCourse?.materials.forEach((m) => {
          if (m.storageKey) deleteFileBlob(m.storageKey).catch(() => {});
        });

        // 2. 收集被删除课程的关联 Assignment，级联清理其 DDL CalendarMark
        const deletedAssignments = current.assignments.filter((a) => a.courseId === courseId);
        const deletedAssignmentIds = new Set(deletedAssignments.map((a) => a.id));

        const isOrphanDDLMark = (mark: CalendarMark): boolean => {
          if (mark.type !== "ddl") return false; // 严格限定 ddl，绝不误删 exam/activity
          if (mark.sourceId && deletedAssignmentIds.has(mark.sourceId)) return true;
          // 历史遗留无 sourceId 的 DDL 标记：仅允许 title AND date 同时匹配
          if (!mark.sourceId) {
            return deletedAssignments.some((a) => isLegacyDDLMarkForAssignment(mark, a));
          }
          return false;
        };

        set({
          courses: current.courses.filter((c) => c.id !== courseId),
          schedules: current.schedules.filter((s) => s.courseId !== courseId),
          assignments: current.assignments.filter((a) => a.courseId !== courseId),
          groupProjects: current.groupProjects.filter((gp) => gp.courseId !== courseId),
          calendarMarks: current.calendarMarks.filter((m) => !isOrphanDDLMark(m)),
          selectedCourseId: current.selectedCourseId === courseId ? null : current.selectedCourseId,
        });
      },

      addScheduleSlot: (scheduleData) => {
        const newSchedule: CourseSchedule = {
          ...scheduleData,
          id: createId("s"),
        };
        set((state) => ({ schedules: [...state.schedules, newSchedule] }));
        return newSchedule.id;
      },

      updateSchedule: (updatedSchedule) =>
        set((state) => ({
          schedules: state.schedules.map((s) => (s.id === updatedSchedule.id ? updatedSchedule : s)),
        })),

      deleteSchedule: (scheduleId) => {
        const current = get();
        const target = current.schedules.find((s) => s.id === scheduleId) || null;
        set({ schedules: current.schedules.filter((s) => s.id !== scheduleId) });
        return target;
      },

      restoreSchedule: (schedule) =>
        set((state) => ({ schedules: [...state.schedules, schedule] })),

      excludeWeekFromSchedule: (scheduleId, week) =>
        set((state) => ({
          schedules: state.schedules.map((s) => {
            if (s.id !== scheduleId) return s;
            const currentEx = s.excludedWeeks || [];
            if (currentEx.includes(week)) return s;
            return { ...s, excludedWeeks: [...currentEx, week] };
          }),
        })),

      importSchedules: (newCourses, newSchedules) =>
        set((state) => ({
          courses: [...state.courses, ...newCourses],
          schedules: [...state.schedules, ...newSchedules],
        })),

      addCourseMaterial: (courseId, materialData) =>
        set((state) => {
          const today = new Date();
          const pad2 = (n: number) => String(n).padStart(2, "0");
          const uploadDate = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;

          return {
            courses: state.courses.map((c) => {
              if (c.id !== courseId) return c;
              return {
                ...c,
                materials: [
                  ...c.materials,
                  {
                    id: createId("m"),
                    title: materialData.title,
                    type: materialData.type,
                    size: materialData.size || "1.5 MB",
                    uploadDate,
                    storageKey: materialData.storageKey,
                    url: materialData.url,
                  },
                ],
              };
            }),
          };
        }),

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

      addAssignment: (assignmentData) => {
        const newId = createId("a");
        const newAssignment: Assignment = {
          ...assignmentData,
          id: newId,
        };

        const ddlDateStr = getLocalDDLDate(assignmentData.ddl);
        const newMark: CalendarMark = {
          id: createId("cm"),
          date: ddlDateStr,
          type: "ddl",
          title: assignmentData.title,
          sourceId: newId,
        };

        set((state) => ({
          assignments: [newAssignment, ...state.assignments],
          calendarMarks: [...state.calendarMarks, newMark],
        }));
        return newId;
      },

      updateAssignment: (updatedAssignment) =>
        set((state) => {
          const newDdlDate = getLocalDDLDate(updatedAssignment.ddl);
          const oldAssignment = state.assignments.find((a) => a.id === updatedAssignment.id);

          // Update assignment object in place, preserving ID
          const newAssignments = state.assignments.map((a) =>
            a.id === updatedAssignment.id ? updatedAssignment : a
          );

          // 关联 mark：Level 1 sourceId 精确匹配；Level 2 旧数据按 title AND date 匹配。
          // 一旦匹配到历史 mark，写入 sourceId 完成结构升级。
          let markUpdated = false;
          const newCalendarMarks = state.calendarMarks.map((m) => {
            if (m.sourceId === updatedAssignment.id) {
              markUpdated = true;
              return {
                ...m,
                date: newDdlDate,
                title: updatedAssignment.title,
                sourceId: updatedAssignment.id,
              };
            }
            if (oldAssignment && isLegacyDDLMarkForAssignment(m, oldAssignment)) {
              markUpdated = true;
              return {
                ...m,
                date: newDdlDate,
                title: updatedAssignment.title,
                sourceId: updatedAssignment.id,
              };
            }
            return m;
          });

          // If no mark existed, append a new linked mark
          if (!markUpdated) {
            newCalendarMarks.push({
              id: createId("cm"),
              date: newDdlDate,
              type: "ddl",
              title: updatedAssignment.title,
              sourceId: updatedAssignment.id,
            });
          }

          return {
            assignments: newAssignments,
            calendarMarks: newCalendarMarks,
          };
        }),

      updateAssignmentStatus: (id, status) =>
        set((state) => ({
          assignments: state.assignments.map((a) => {
            if (a.id !== id) return a;
            const isComp = status === "completed";
            return { ...a, status, progress: isComp ? 100 : a.progress };
          }),
        })),

      updateAssignmentPriority: (id, priority) =>
        set((state) => ({
          assignments: state.assignments.map((a) =>
            a.id === id ? { ...a, priority } : a
          ),
        })),

      updateAssignmentProgress: (id, progress) =>
        set((state) => ({
          assignments: state.assignments.map((a) => {
            if (a.id !== id) return a;
            const status = progress === 100 ? "completed" : progress > 0 ? "doing" : "todo";
            return { ...a, progress, status };
          }),
        })),

      toggleSubtask: (assignmentId, subtaskId) =>
        set((state) => ({
          assignments: state.assignments.map((a) => {
            if (a.id !== assignmentId || !a.subtasks) return a;
            const updatedSub = a.subtasks.map((st) =>
              st.id === subtaskId ? { ...st, completed: !st.completed } : st
            );
            const compCount = updatedSub.filter((st) => st.completed).length;
            const newProgress = Math.round((compCount / updatedSub.length) * 100);
            const newStatus = newProgress === 100 ? "completed" : newProgress > 0 ? "doing" : "todo";
            return { ...a, subtasks: updatedSub, progress: newProgress, status: newStatus };
          }),
        })),

      deleteAssignment: (id) => {
        const current = get();
        const target = current.assignments.find((a) => a.id === id);
        if (!target) return null;

        // 记录被删除的 DDL CalendarMark（sourceId 精确匹配 + legacy title AND date），供撤销恢复
        const removedMarks: CalendarMark[] = [];
        const nextMarks = current.calendarMarks.filter((m) => {
          if (isDDLMarkForAssignment(m, target)) {
            removedMarks.push(m);
            return false;
          }
          return true;
        });

        set({
          assignments: current.assignments.filter((a) => a.id !== id),
          calendarMarks: nextMarks,
          selectedAssignmentId: current.selectedAssignmentId === id ? null : current.selectedAssignmentId,
        });

        return { assignment: target, marks: removedMarks };
      },

      restoreAssignment: (assignment, marks) =>
        set((state) => ({
          assignments: [assignment, ...state.assignments],
          calendarMarks: [
            ...state.calendarMarks,
            ...marks.filter((m) => !state.calendarMarks.some((x) => x.id === m.id)),
          ],
        })),

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
      version: 3,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): PersistedAppState => ({
        userProfile: state.userProfile,
        semester: state.semester,
        courses: state.courses,
        schedules: state.schedules,
        assignments: state.assignments,
        calendarMarks: state.calendarMarks,
        groupProjects: state.groupProjects,
        assignmentTimeSlice: state.assignmentTimeSlice,
        lastWorkspaceTab: state.lastWorkspaceTab,
        preferences: state.preferences,
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
{
  const state = useAppStore.getState();
  const week = Math.min(
    Math.max(getSemesterWeek(new Date(), state.semester), 1),
    state.semester.totalWeeks
  );
  useAppStore.setState({ currentSemesterWeek: week });
}
