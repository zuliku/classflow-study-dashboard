import { NavTab } from "@/types";

/**
 * Kiro Base Context：每次请求携带的最小上下文。
 * 只含安全字段（不含 studentId / avatarUrl / 完整业务实体）。
 */
export interface KiroBaseContext {
  version: 1;
  /** 客户端真实当前时间（ISO，本地墙钟） */
  now: string;
  /** 客户端时区（Intl 动态读取，不硬编码） */
  timezone: string;
  activeTab: NavTab;
  semester: {
    id: string;
    name: string;
    startDate: string;
    totalWeeks: number;
    currentWeek: number;
  };
  /** 安全个人资料（studentId / avatarUrl 明确排除） */
  profile: {
    name: string;
    college: string;
    grade: string;
    completedCredits: number;
    totalCredits: number;
  };
  ui: {
    selectedCourseId: string | null;
    selectedAssignmentId: string | null;
    highlightedAssignmentId: string | null;
    /** Task V2：Assignment Workspace 当前视图（focus/today/upcoming/unscheduled/all/archive） */
    assignmentWorkspaceView: "focus" | "today" | "upcoming" | "unscheduled" | "all" | "archive";
  };
  summary: {
    courseCount: number;
    scheduleCount: number;
    assignmentCount: number;
    groupProjectCount: number;
    /** Task V2：已安排的 StudyBlock 总数（不包含任务明细） */
    studyBlockCount: number;
  };
}

/** 显式 Context 引用（自动 + 手动 + 入口；传给模型的只有 kind/id/label） */
export interface KiroContextRef {
  key: string;
  kind: "course" | "assignment" | "group-project" | "material" | "week";
  entityId?: string;
  label: string;
  /** auto：Store 选中实体；manual：用户 @；entry：从业务实体打开 Kiro */
  source: "auto" | "manual" | "entry";
}
