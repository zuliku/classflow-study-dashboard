import { KiroBaseContext } from "@/lib/ai/context/types";
import { useAppStore } from "@/store/useAppStore";

/**
 * 从当前 Zustand Store 构建安全 Base Context。
 * 只读、确定性；不含 studentId / avatarUrl / API Key / Blob / 完整业务实体。
 * 完整实体一律通过 Read Tools 按需读取。
 */
export function buildBaseContext(): KiroBaseContext {
  const state = useAppStore.getState();
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";

  return {
    version: 1,
    now: now.toISOString(),
    timezone,
    activeTab: state.activeTab,
    semester: {
      id: state.semester.id,
      name: state.semester.name,
      startDate: state.semester.startDate,
      totalWeeks: state.semester.totalWeeks,
      currentWeek: state.currentSemesterWeek,
    },
    // 安全个人资料：studentId / avatarUrl 明确排除
    profile: {
      name: state.userProfile.name,
      college: state.userProfile.college,
      grade: state.userProfile.grade,
      completedCredits: state.userProfile.completedCredits,
      totalCredits: state.userProfile.totalCredits,
    },
    ui: {
      selectedCourseId: state.selectedCourseId,
      selectedAssignmentId: state.selectedAssignmentId,
      highlightedAssignmentId: state.highlightedAssignmentId,
      assignmentWorkspaceView: state.assignmentWorkspaceView,
    },
    summary: {
      courseCount: state.courses.length,
      scheduleCount: state.schedules.length,
      assignmentCount: state.assignments.length,
      groupProjectCount: state.groupProjects.length,
      studyBlockCount: state.studyBlocks.length,
    },
  };
}
