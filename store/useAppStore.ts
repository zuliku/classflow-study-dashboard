import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  Course,
  CourseSchedule,
  Assignment,
  CalendarMark,
  UserProfile,
  GroupProject,
  NavTab,
  ScheduleConflict,
  Semester,
  ClassFlowBackupData,
  Material,
  TimeSliceFilter,
} from "@/types";
import {
  initialUserProfile,
  initialCourses,
  initialSchedules,
  initialAssignments,
  initialCalendarMarks,
  initialGroupProjects,
} from "@/lib/mockData";
import { createDefaultSemester, getSemesterWeek } from "@/lib/semester";
import { getLocalDDLDate } from "@/lib/ddl";
import { deleteFileBlob, clearAllFileBlobs } from "@/lib/fileStorage";

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
}

const TIME_SLICES: TimeSliceFilter[] = ["all", "overdue", "today", "3days", "7days", "completed"];

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
  return {
    userProfile:
      legacy.userProfile && typeof legacy.userProfile === "object"
        ? (legacy.userProfile as UserProfile)
        : initialUserProfile,
    semester: isValidSemester(legacy.semester) ? legacy.semester : createDefaultSemester(),
    courses: Array.isArray(legacy.courses) ? (legacy.courses as Course[]) : [],
    schedules: Array.isArray(legacy.schedules) ? (legacy.schedules as CourseSchedule[]) : [],
    assignments: Array.isArray(legacy.assignments) ? (legacy.assignments as Assignment[]) : [],
    calendarMarks: Array.isArray(legacy.calendarMarks)
      ? (legacy.calendarMarks as CalendarMark[])
      : [],
    groupProjects: Array.isArray(legacy.groupProjects)
      ? (legacy.groupProjects as GroupProject[])
      : [],
    assignmentTimeSlice: TIME_SLICES.includes(legacy.assignmentTimeSlice as TimeSliceFilter)
      ? (legacy.assignmentTimeSlice as TimeSliceFilter)
      : "all",
  };
}

interface AppState {
  // Navigation & UI State
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  /** 任务列表时间筛选（全局共享，跨页保留） */
  assignmentTimeSlice: TimeSliceFilter;
  setAssignmentTimeSlice: (slice: TimeSliceFilter) => void;
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
  schedules: CourseSchedule[];
  assignments: Assignment[];
  calendarMarks: CalendarMark[];
  groupProjects: GroupProject[];

  // Actions
  updateUserProfile: (profile: Partial<UserProfile>) => void;
  resetAllDataToDefault: () => void;
  /** 从备份原子恢复全部业务数据（整体替换，而非追加） */
  restoreAppData: (data: ClassFlowBackupData) => void;

  // Course & Schedule Actions
  addCourseWithSchedule: (
    course: Omit<Course, "id" | "materials">,
    scheduleSlots: Omit<CourseSchedule, "id" | "courseId">[]
  ) => void;
  updateCourse: (course: Course) => void;
  deleteCourse: (courseId: string) => void;
  addScheduleSlot: (schedule: Omit<CourseSchedule, "id">) => void;
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
  addAssignment: (assignment: Omit<Assignment, "id">) => void;
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
  addGroupProject: (project: Omit<GroupProject, "id" | "progress" | "updatedAt">) => void;
  toggleGroupTask: (projectId: string, taskId: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      activeTab: "overview",
      setActiveTab: (tab) => set({ activeTab: tab }),
      assignmentTimeSlice: "all",
      setAssignmentTimeSlice: (slice) => set({ assignmentTimeSlice: slice }),
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

      userProfile: initialUserProfile,
      courses: initialCourses,
      schedules: initialSchedules,
      assignments: initialAssignments,
      calendarMarks: initialCalendarMarks,
      groupProjects: initialGroupProjects,

      updateUserProfile: (profile) =>
        set((state) => ({
          userProfile: { ...state.userProfile, ...profile },
        })),

      resetAllDataToDefault: () => {
        // 同步清空 IndexedDB 中保存的文件 Blob（fire-and-forget）
        clearAllFileBlobs().catch(() => {});

        set({
          userProfile: initialUserProfile,
          courses: initialCourses,
          schedules: initialSchedules,
          assignments: initialAssignments,
          calendarMarks: initialCalendarMarks,
          groupProjects: initialGroupProjects,
          semester: createDefaultSemester(),
          currentSemesterWeek: 1,
        });
      },

      restoreAppData: (data) =>
        set((state) => ({
          userProfile: data.userProfile,
          semester: data.semester,
          courses: data.courses,
          schedules: data.schedules,
          assignments: data.assignments,
          calendarMarks: data.calendarMarks,
          groupProjects: data.groupProjects,
          currentSemesterWeek: Math.min(
            Math.max(state.currentSemesterWeek, 1),
            data.semester.totalWeeks
          ),
        })),

      addCourseWithSchedule: (courseData, scheduleSlots) => {
        const courseId = `c_${Date.now()}`;
        const newCourse: Course = {
          ...courseData,
          id: courseId,
          materials: [],
        };

        const newSchedules: CourseSchedule[] = scheduleSlots.map((slot, idx) => ({
          ...slot,
          id: `s_${Date.now()}_${idx}`,
          courseId,
        }));

        set((state) => ({
          courses: [...state.courses, newCourse],
          schedules: [...state.schedules, ...newSchedules],
        }));
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
          // 历史遗留无 sourceId 的 DDL 标记：按 title / DDL date 兼容匹配
          if (!mark.sourceId) {
            return deletedAssignments.some(
              (a) => a.title === mark.title || getLocalDDLDate(a.ddl) === mark.date
            );
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
          id: `s_${Date.now()}`,
        };
        set((state) => ({ schedules: [...state.schedules, newSchedule] }));
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
                    id: `m_${Date.now()}`,
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
        const newId = `a_${Date.now()}`;
        const newAssignment: Assignment = {
          ...assignmentData,
          id: newId,
        };

        const ddlDateStr = getLocalDDLDate(assignmentData.ddl);
        const newMark: CalendarMark = {
          id: `cm_${Date.now()}`,
          date: ddlDateStr,
          type: "ddl",
          title: assignmentData.title,
          sourceId: newId,
        };

        set((state) => ({
          assignments: [newAssignment, ...state.assignments],
          calendarMarks: [...state.calendarMarks, newMark],
        }));
      },

      updateAssignment: (updatedAssignment) =>
        set((state) => {
          const newDdlDate = getLocalDDLDate(updatedAssignment.ddl);
          const oldAssignment = state.assignments.find((a) => a.id === updatedAssignment.id);
          const oldDdlDate = oldAssignment ? getLocalDDLDate(oldAssignment.ddl) : "";
          const oldTitle = oldAssignment ? oldAssignment.title : "";

          // Update assignment object in place, preserving ID
          const newAssignments = state.assignments.map((a) =>
            a.id === updatedAssignment.id ? updatedAssignment : a
          );

          // Update linked CalendarMark cleanly with fallback for legacy marks
          let markUpdated = false;
          const newCalendarMarks = state.calendarMarks.map((m) => {
            // Match by sourceId OR fallback by legacy match (type === ddl AND (title or date matched))
            if (
              m.sourceId === updatedAssignment.id ||
              (!m.sourceId && m.type === "ddl" && (m.title === oldTitle || m.date === oldDdlDate))
            ) {
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
              id: `cm_${Date.now()}`,
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

        const targetDate = getLocalDDLDate(target.ddl);
        const targetTitle = target.title;

        // 记录被删除的 DDL CalendarMark（sourceId 精确匹配 + 无 sourceId 的兼容匹配），供撤销恢复
        const removedMarks: CalendarMark[] = [];
        const nextMarks = current.calendarMarks.filter((m) => {
          if (m.sourceId === id) {
            removedMarks.push(m);
            return false;
          }
          if (!m.sourceId && m.type === "ddl" && (m.title === targetTitle || m.date === targetDate)) {
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
        const newProject: GroupProject = {
          ...projectData,
          id: `gp_${Date.now()}`,
          progress: 0,
          updatedAt: new Date().toISOString().split("T")[0],
        };
        set((state) => ({
          groupProjects: [newProject, ...state.groupProjects],
        }));
      },

      toggleGroupTask: (projectId, taskId) =>
        set((state) => ({
          groupProjects: state.groupProjects.map((p) => {
            if (p.id !== projectId) return p;
            const updatedTasks = p.tasks.map((t) =>
              t.id === taskId ? { ...t, completed: !t.completed } : t
            );
            const compCount = updatedTasks.filter((t) => t.completed).length;
            const newProgress =
              updatedTasks.length > 0 ? Math.round((compCount / updatedTasks.length) * 100) : 0;
            return { ...p, tasks: updatedTasks, progress: newProgress };
          }),
        })),
    }),
    {
      name: "classflow-storage-v2",
      version: 1,
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
      }),
      migrate: (persistedState) => sanitizePersistedState(persistedState),
      // 旧数据可能没有 version 键（zustand 不会触发 migrate），
      // 用 merge 兜底：只合并白名单字段，历史 UI 瞬时状态绝不进入 state。
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...sanitizePersistedState(persistedState),
      }),
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
