import {
  Assignment,
  CalendarMark,
  ClassFlowBackupData,
  Course,
  CourseSchedule,
  GroupProject,
  Reminder,
  Semester,
  UserProfile,
  StudyBlock,
} from "@/types";

export type BackupValidationResult =
  | { ok: true; data: ClassFlowBackupData }
  | { ok: false; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

const BACKUP_VERSION = 1;

const ARRAY_FIELDS: { key: keyof ClassFlowBackupData; label: string }[] = [
  { key: "courses", label: "课程 (courses)" },
  { key: "schedules", label: "排课 (schedules)" },
  { key: "assignments", label: "作业 (assignments)" },
  { key: "calendarMarks", label: "日历标记 (calendarMarks)" },
  { key: "groupProjects", label: "小组项目 (groupProjects)" },
];

/** Task 7G-A1：Reminder（旧备份可缺失 → 恢复 []）；非法条目在 restore 时经 normalizeReminder 丢弃 */
function validateReminders(v: unknown): v is Reminder[] {
  return (
    Array.isArray(v) &&
    v.every(
      (r) =>
        isPlainObject(r) &&
        isNonEmptyString(r.id) &&
        isNonEmptyString(r.title) &&
        (r.targetType === "assignment" ||
          r.targetType === "studyBlock" ||
          r.targetType === "calendarMark" ||
          r.targetType === "standalone") &&
        (r.timingMode === "relative" || r.timingMode === "absolute") &&
        isNonEmptyString(r.triggerAt)
    )
  );
}

/** Timeline V1：学习计划（旧备份可缺失 → 恢复时回落 []） */
function validateStudyBlocks(v: unknown): v is StudyBlock[] {
  return (
    Array.isArray(v) &&
    v.every(
      (b) =>
        isPlainObject(b) &&
        isNonEmptyString(b.id) &&
        isNonEmptyString(b.title) &&
        isNonEmptyString(b.date) &&
        isNonEmptyString(b.startTime) &&
        isNonEmptyString(b.endTime)
    )
  );
}

function validateSemester(v: unknown): v is Semester {
  return (
    isPlainObject(v) &&
    isNonEmptyString(v.name) &&
    isNonEmptyString(v.startDate) &&
    typeof v.totalWeeks === "number" &&
    Number.isInteger(v.totalWeeks) &&
    v.totalWeeks > 0
  );
}

function validateUserProfile(v: unknown): v is UserProfile {
  return isPlainObject(v) && isNonEmptyString(v.name);
}

function validateCourses(v: unknown): v is Course[] {
  return Array.isArray(v) && v.every((c) => isPlainObject(c) && isNonEmptyString(c.id) && isNonEmptyString(c.name));
}

function validateSchedules(v: unknown): v is CourseSchedule[] {
  return (
    Array.isArray(v) &&
    v.every(
      (s) =>
        isPlainObject(s) &&
        isNonEmptyString(s.id) &&
        isNonEmptyString(s.courseId) &&
        typeof s.dayOfWeek === "number" &&
        Number.isInteger(s.dayOfWeek) &&
        s.dayOfWeek >= 1 &&
        s.dayOfWeek <= 7
    )
  );
}

function validateAssignments(v: unknown): v is Assignment[] {
  return (
    Array.isArray(v) &&
    v.every(
      (a) =>
        isPlainObject(a) &&
        isNonEmptyString(a.id) &&
        // Task V2：ddl 可选（缺失合法）；estimatedMinutes 若存在必须为正数
        (a.ddl === undefined || isNonEmptyString(a.ddl)) &&
        (a.estimatedMinutes === undefined || (typeof a.estimatedMinutes === "number" && a.estimatedMinutes > 0))
    )
  );
}

function validateCalendarMarks(v: unknown): v is CalendarMark[] {
  return (
    Array.isArray(v) &&
    v.every((m) => isPlainObject(m) && isNonEmptyString(m.id) && isNonEmptyString(m.date))
  );
}

function validateGroupProjects(v: unknown): v is GroupProject[] {
  return Array.isArray(v) && v.every((g) => isPlainObject(g) && isNonEmptyString(g.id));
}

/**
 * 解析并校验备份文件。校验失败时返回错误信息，绝不修改现有数据。
 * 支持 v1 结构 { version: 1, exportedAt, data: {...} }，
 * 并兼容旧版无 version 的扁平结构（仅当关键字段齐全时）。
 */
export function validateBackup(raw: unknown): BackupValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, error: "备份文件内容不是有效的 JSON 对象" };
  }

  // 旧版扁平结构（无 version 字段）直接当作数据区
  const data: unknown = raw.version === undefined ? raw : raw.data;
  if (!isPlainObject(data)) {
    return { ok: false, error: "备份文件缺少 data 数据区，无法恢复" };
  }

  if (raw.version !== undefined && raw.version !== BACKUP_VERSION) {
    return {
      ok: false,
      error: `不支持的备份版本 (v${String(raw.version)})，请使用当前版本重新导出后导入`,
    };
  }

  for (const { key, label } of ARRAY_FIELDS) {
    if (!Array.isArray(data[key])) {
      return { ok: false, error: `备份数据缺少 ${label}，无法恢复` };
    }
  }

  if (!validateSemester(data.semester)) {
    return { ok: false, error: "备份数据中的学期信息 (semester) 不完整或格式异常，无法恢复" };
  }
  if (!validateUserProfile(data.userProfile)) {
    return { ok: false, error: "备份数据中的用户资料 (userProfile) 不完整或格式异常，无法恢复" };
  }
  if (!validateCourses(data.courses)) {
    return { ok: false, error: "课程数据 (courses) 格式异常，无法恢复" };
  }
  if (!validateSchedules(data.schedules)) {
    return { ok: false, error: "排课数据 (schedules) 格式异常（星期应为 1-7），无法恢复" };
  }
  if (!validateAssignments(data.assignments)) {
    return { ok: false, error: "作业数据 (assignments) 格式异常，无法恢复" };
  }
  if (!validateCalendarMarks(data.calendarMarks)) {
    return { ok: false, error: "日历标记数据 (calendarMarks) 格式异常，无法恢复" };
  }
  if (!validateGroupProjects(data.groupProjects)) {
    return { ok: false, error: "小组项目数据 (groupProjects) 格式异常，无法恢复" };
  }
  // Timeline V1：学习计划可选（旧备份缺失合法；存在则必须合法）
  if (data.studyBlocks !== undefined && !validateStudyBlocks(data.studyBlocks)) {
    return { ok: false, error: "学习计划数据 (studyBlocks) 格式异常，无法恢复" };
  }
  // Task 7G-A1：Reminder 可选（旧备份缺失合法 → 恢复 []；存在则必须合法）
  if (data.reminders !== undefined && !validateReminders(data.reminders)) {
    return { ok: false, error: "提醒数据 (reminders) 格式异常，无法恢复" };
  }

  return {
    ok: true,
    data: data as unknown as ClassFlowBackupData,
  };
}

/** 解析 JSON 文本并校验备份结构 */
export function parseBackupJSON(text: string): BackupValidationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "备份文件不是有效的 JSON，导入已取消" };
  }
  return validateBackup(raw);
}

/** 是否存在依赖 IndexedDB 文件（storageKey）的课程资料 */
export function hasMaterialStorageKeys(courses: Course[]): boolean {
  return courses.some((c) => c.materials.some((m) => !!m.storageKey));
}
