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
  ViewMode,
  ScheduleConflict,
} from "@/types";
import {
  initialUserProfile,
  initialCourses,
  initialSchedules,
  initialAssignments,
  initialCalendarMarks,
  initialGroupProjects,
} from "@/lib/mockData";

export function isScheduleActive(schedule: CourseSchedule, week: number): boolean {
  if (schedule.excludedWeeks && schedule.excludedWeeks.includes(week)) {
    return false;
  }

  const weeksStr = schedule.weeks || "1-16周";

  if (weeksStr.includes("单周")) {
    return week % 2 !== 0;
  }
  if (weeksStr.includes("双周")) {
    return week % 2 === 0;
  }

  const match = weeksStr.match(/(\d+)-(\d+)/);
  if (match) {
    const start = parseInt(match[1], 10);
    const end = parseInt(match[2], 10);
    return week >= start && week <= end;
  }

  return true;
}

interface AppState {
  // Navigation & UI State
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  weekOffset: number;
  setWeekOffset: (offset: number) => void;
  resetToCurrentWeek: () => void;
  currentSemesterWeek: number;
  setCurrentSemesterWeek: (week: number) => void;

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
  resetAllDataToDefault: () => void;

  // Course & Schedule Actions
  addCourseWithSchedule: (
    course: Omit<Course, "id" | "materials">,
    scheduleSlots: Omit<CourseSchedule, "id" | "courseId">[]
  ) => void;
  updateCourse: (course: Course) => void;
  deleteCourse: (courseId: string) => void;
  addScheduleSlot: (schedule: Omit<CourseSchedule, "id">) => void;
  updateSchedule: (schedule: CourseSchedule) => void;
  deleteSchedule: (scheduleId: string) => void;
  excludeWeekFromSchedule: (scheduleId: string, week: number) => void;
  importSchedules: (
    newCourses: Course[],
    newSchedules: CourseSchedule[]
  ) => void;

  // Material Actions
  addCourseMaterial: (
    courseId: string,
    material: { title: string; type: "pdf" | "ppt" | "doc" | "link"; size?: string; url?: string }
  ) => void;

  // Assignment Actions
  addAssignment: (assignment: Omit<Assignment, "id">) => void;
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
  deleteAssignment: (id: string) => void;

  // Group Project Actions
  addGroupProject: (project: Omit<GroupProject, "id" | "progress" | "updatedAt">) => void;
  toggleGroupTask: (projectId: string, taskId: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      activeTab: "overview",
      setActiveTab: (tab) => set({ activeTab: tab }),
      viewMode: "week",
      setViewMode: (mode) => set({ viewMode: mode }),
      weekOffset: 0,
      setWeekOffset: (offset) => set({ weekOffset: offset }),
      resetToCurrentWeek: () => set({ weekOffset: 0 }),
      currentSemesterWeek: 1,
      setCurrentSemesterWeek: (week) => set({ currentSemesterWeek: week }),

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
      selectedConflict: null,
      setSelectedConflict: (conflict) => set({ selectedConflict: conflict }),

      userProfile: initialUserProfile,
      courses: initialCourses,
      schedules: initialSchedules,
      assignments: initialAssignments,
      calendarMarks: initialCalendarMarks,
      groupProjects: initialGroupProjects,

      resetAllDataToDefault: () =>
        set({
          userProfile: initialUserProfile,
          courses: initialCourses,
          schedules: initialSchedules,
          assignments: initialAssignments,
          calendarMarks: initialCalendarMarks,
          groupProjects: initialGroupProjects,
        }),

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

      deleteCourse: (courseId) =>
        set((state) => ({
          courses: state.courses.filter((c) => c.id !== courseId),
          schedules: state.schedules.filter((s) => s.courseId !== courseId),
          assignments: state.assignments.filter((a) => a.courseId !== courseId),
          groupProjects: state.groupProjects.filter((gp) => gp.courseId !== courseId),
          selectedCourseId: state.selectedCourseId === courseId ? null : state.selectedCourseId,
        })),

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

      deleteSchedule: (scheduleId) =>
        set((state) => ({
          schedules: state.schedules.filter((s) => s.id !== scheduleId),
        })),

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
        set((state) => ({
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
                  uploadDate: new Date().toISOString().split("T")[0],
                  url: materialData.url,
                },
              ],
            };
          }),
        })),

      addAssignment: (assignmentData) => {
        const newId = `a_${Date.now()}`;
        const newAssignment: Assignment = {
          ...assignmentData,
          id: newId,
        };

        const ddlDateStr = assignmentData.ddl.split("T")[0];
        const newMark: CalendarMark = {
          id: `cm_${Date.now()}`,
          date: ddlDateStr,
          type: "ddl",
          title: assignmentData.title,
        };

        set((state) => ({
          assignments: [newAssignment, ...state.assignments],
          calendarMarks: [...state.calendarMarks, newMark],
        }));
      },

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

      deleteAssignment: (id) =>
        set((state) => {
          const target = state.assignments.find((a) => a.id === id);
          const targetDate = target ? target.ddl.split("T")[0] : "";

          return {
            assignments: state.assignments.filter((a) => a.id !== id),
            calendarMarks: state.calendarMarks.filter(
              (m) => !(m.type === "ddl" && m.date === targetDate && m.title === target?.title)
            ),
            selectedAssignmentId: state.selectedAssignmentId === id ? null : state.selectedAssignmentId,
          };
        }),

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
      storage: createJSONStorage(() => localStorage),
    }
  )
);
