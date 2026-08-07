import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  Course,
  CourseSchedule,
  Assignment,
  CalendarMark,
  UserProfile,
  AssignmentStatus,
  Priority,
} from "@/types";
import {
  initialCourses,
  initialSchedules,
  initialAssignments,
  initialCalendarMarks,
  initialUserProfile,
} from "@/lib/mockData";

export type NavTab = "overview" | "timetable" | "assignments" | "courses" | "analytics" | "settings";
export type ViewMode = "day" | "week" | "month";
export type TaskFilter = "all" | "doing" | "todo" | "completed";

interface AppState {
  // Navigation & View
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;

  weekOffset: number;
  setWeekOffset: (offset: number | ((prev: number) => number)) => void;
  resetToCurrentWeek: () => void;

  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  // Drawers & Modals
  selectedCourseId: string | null;
  setSelectedCourseId: (id: string | null) => void;

  selectedAssignmentId: string | null;
  setSelectedAssignmentId: (id: string | null) => void;

  isSearchModalOpen: boolean;
  setSearchModalOpen: (open: boolean) => void;

  searchQuery: string;
  setSearchQuery: (query: string) => void;

  // Filters
  taskFilter: TaskFilter;
  setTaskFilter: (filter: TaskFilter) => void;

  // Data State
  userProfile: UserProfile;
  courses: Course[];
  schedules: CourseSchedule[];
  assignments: Assignment[];
  calendarMarks: CalendarMark[];

  // Actions
  updateAssignmentStatus: (id: string, status: AssignmentStatus) => void;
  updateAssignmentProgress: (id: string, progress: number) => void;
  updateAssignmentPriority: (id: string, priority: Priority) => void;
  toggleSubtask: (assignmentId: string, subtaskId: string) => void;
  addAssignment: (assignment: Omit<Assignment, "id">) => void;
  deleteAssignment: (id: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      activeTab: "overview",
      setActiveTab: (tab) => set({ activeTab: tab }),

      weekOffset: 0,
      setWeekOffset: (offset) =>
        set((state) => ({
          weekOffset: typeof offset === "function" ? offset(state.weekOffset) : offset,
        })),
      resetToCurrentWeek: () => set({ weekOffset: 0 }),

      viewMode: "week",
      setViewMode: (mode) => set({ viewMode: mode }),

      selectedCourseId: null,
      setSelectedCourseId: (id) => set({ selectedCourseId: id }),

      selectedAssignmentId: null,
      setSelectedAssignmentId: (id) => set({ selectedAssignmentId: id }),

      isSearchModalOpen: false,
      setSearchModalOpen: (open) => set({ isSearchModalOpen: open }),

      searchQuery: "",
      setSearchQuery: (query) => set({ searchQuery: query }),

      taskFilter: "all",
      setTaskFilter: (filter) => set({ taskFilter: filter }),

      userProfile: initialUserProfile,
      courses: initialCourses,
      schedules: initialSchedules,
      assignments: initialAssignments,
      calendarMarks: initialCalendarMarks,

      updateAssignmentStatus: (id, status) => {
        set((state) => ({
          assignments: state.assignments.map((item) => {
            if (item.id === id) {
              let newProgress = item.progress;
              if (status === "completed") newProgress = 100;
              if (status === "todo" && item.progress === 100) newProgress = 0;
              return { ...item, status, progress: newProgress };
            }
            return item;
          }),
        }));
      },

      updateAssignmentProgress: (id, progress) => {
        set((state) => ({
          assignments: state.assignments.map((item) => {
            if (item.id === id) {
              let newStatus = item.status;
              if (progress === 100) newStatus = "completed";
              else if (progress > 0 && item.status === "todo") newStatus = "doing";
              return { ...item, progress, status: newStatus };
            }
            return item;
          }),
        }));
      },

      updateAssignmentPriority: (id, priority) => {
        set((state) => ({
          assignments: state.assignments.map((item) =>
            item.id === id ? { ...item, priority } : item
          ),
        }));
      },

      toggleSubtask: (assignmentId, subtaskId) => {
        set((state) => ({
          assignments: state.assignments.map((item) => {
            if (item.id === assignmentId && item.subtasks) {
              const updatedSubtasks = item.subtasks.map((st) =>
                st.id === subtaskId ? { ...st, completed: !st.completed } : st
              );
              const completedCount = updatedSubtasks.filter((st) => st.completed).length;
              const calcProgress = Math.round((completedCount / updatedSubtasks.length) * 100);
              const newStatus = calcProgress === 100 ? "completed" : calcProgress > 0 ? "doing" : "todo";
              return {
                ...item,
                subtasks: updatedSubtasks,
                progress: calcProgress,
                status: newStatus,
              };
            }
            return item;
          }),
        }));
      },

      addAssignment: (newAssignmentData) => {
        const newAssignment: Assignment = {
          ...newAssignmentData,
          id: `a_${Date.now()}`,
        };
        set((state) => ({
          assignments: [newAssignment, ...state.assignments],
        }));
      },

      deleteAssignment: (id) => {
        set((state) => ({
          assignments: state.assignments.filter((item) => item.id !== id),
          selectedAssignmentId:
            state.selectedAssignmentId === id ? null : state.selectedAssignmentId,
        }));
      },
    }),
    {
      name: "classflow-store-v1",
      partialize: (state) => ({
        assignments: state.assignments,
        courses: state.courses,
        schedules: state.schedules,
      }),
    }
  )
);
