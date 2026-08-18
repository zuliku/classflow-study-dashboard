/**
 * Visual Timetable Import — 领域类型。
 *
 * 业务边界独立于 Visual Action Intake：
 * - Visual Intake：根据截图修改已有 ClassFlow 实体（作业/DDL/停课调课补课）
 * - Timetable Import：根据完整课表截图初始化一批全新 Course + CourseSchedule
 *
 * Runtime 拥有：sourceAttachmentIds / preview / fingerprint / apply lifecycle。
 * 模型只描述"从图片读到了什么"（节次/周次表达式），绝不提供真实 ID 与具体时间。
 */
import { BellScheduleTemplate } from "@/types";
import { ScheduleImportPreflightResult } from "@/lib/scheduleImport/preflight";

/** 模型输出：课程草稿（draftKey 仅本次 Proposal 内部关联；无真实 courseId） */
export interface TimetableImportCourseDraft {
  draftKey: string;
  name: string;
  code?: string;
  teacher?: string;
  classroom?: string;
  credit?: number;
  slots: Array<{
    dayOfWeek: number; // 1-7
    /** 节次（如 1、3、7）；最终时间由 Bell Schedule 解析，模型绝不猜时间 */
    periodStart?: number;
    periodEnd?: number;
    /** 周次表达式（如 "1-5,7-17"；空 → 默认全学期） */
    weekExpression?: string;
    location?: string;
    /** 促成该识别结果的最短必要事实（不保存整张 OCR transcript） */
    evidence?: string;
  }>;
}

export interface TimetableImportPendingItem {
  reason: "ambiguous-cell" | "missing-information";
  description: string;
  evidence?: string;
}

/** 模型输出契约（propose_timetable_import 的 input） */
export interface TimetableImportDraft {
  summary: string;
  courses: TimetableImportCourseDraft[];
  pendingItems?: TimetableImportPendingItem[];
}

/** Runtime 生成的 Proposal（UI/Apply 使用） */
export interface TimetableImportProposal {
  id: string;
  /** 来源图片（当前 Turn frozen attachment snapshot；模型不能伪造） */
  sourceAttachmentIds: string[];
  summary: string;
  draft: TimetableImportDraft;
  /** Runtime preflight 结果（含 fingerprint / issues / counts） */
  preview: ScheduleImportPreflightResult;
  createdAt: number;
}

/** Apply 依赖注入（便于测试；生产 = useAppStore） */
export interface TimetableImportStoreDeps {
  getState: () => {
    courses: Array<{ id: string; name: string; code?: string | null; teacher?: string | null }>;
    schedules: Array<{
      id: string;
      courseId: string;
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      location?: string;
      weeks: string;
    }>;
    bellSchedules: BellScheduleTemplate[];
    activeBellScheduleId: string | null;
  };
  importSchedules: (
    courses: unknown[],
    schedules: unknown[],
    context?: { source: "import" | "kiro" }
  ) => void;
}
