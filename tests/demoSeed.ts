import {
  initialUserProfile,
  initialCourses,
  initialSchedules,
  initialAssignments,
  initialCalendarMarks,
  initialGroupProjects,
} from "@/lib/mockData";
import { createDefaultSemester } from "@/lib/semester";
import { useAppStore } from "@/store/useAppStore";

/**
 * 测试 fixture：把演示数据注入 store。
 * 生产 runtime 不引用 mockData（First Run 为空工作区），仅测试需要种子数据。
 */
export function seedDemoData(): void {
  useAppStore.setState({
    userProfile: initialUserProfile,
    courses: initialCourses,
    schedules: initialSchedules,
    assignments: initialAssignments,
    calendarMarks: initialCalendarMarks,
    groupProjects: initialGroupProjects,
    semester: createDefaultSemester(),
    currentSemesterWeek: 1,
    assignmentTimeSlice: "all",
    selectedCourseId: null,
    selectedAssignmentId: null,
    selectedConflict: null,
    assignmentSelection: [],
    assignmentPeekId: null,
    highlightedAssignmentId: null,
  });
}

/** 回到干净空状态（等价 resetEntireApp 的最小 setState，供不需要完整持久化的测试使用） */
export function seedEmptyState(): void {
  useAppStore.setState({
    userProfile: { name: "", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
    courses: [],
    schedules: [],
    assignments: [],
    calendarMarks: [],
    groupProjects: [],
    currentSemesterWeek: 1,
    assignmentTimeSlice: "all",
  });
}
