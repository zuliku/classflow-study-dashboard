import {
  Assignment,
  CalendarMark,
  ClassFlowBackupData,
  Course,
  CourseSchedule,
  GroupProject,
  Reminder,
  ScheduleOccurrenceOverride,
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
  { key: "courses", label: "课程" },
  { key: "schedules", label: "排课" },
  { key: "assignments", label: "作业" },
  { key: "calendarMarks", label: "日历标记" },
  { key: "groupProjects", label: "小组项目" },
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
    return { ok: false, error: "这个备份文件打不开了，请确认选的是 ClassFlow 导出的备份文件。" };
  }

  // 旧版扁平结构（无 version 字段）直接当作数据区
  const data: unknown = raw.version === undefined ? raw : raw.data;
  if (!isPlainObject(data)) {
    return { ok: false, error: "这个备份文件打不开了，请确认选的是 ClassFlow 导出的备份文件。" };
  }

  if (raw.version !== undefined && raw.version !== BACKUP_VERSION) {
    // 未来版本备份（降级导入）与旧版本区别提示：前者升级应用可解，后者需重导
    const newer = typeof raw.version === "number" && raw.version > BACKUP_VERSION;
    return {
      ok: false,
      error: newer
        ? `这个备份来自更新的版本（v${raw.version}），请先升级应用后再导入`
        : `备份版本太旧，打不开，请用当前版本重新导出后再导入`,
    };
  }

  for (const { key, label } of ARRAY_FIELDS) {
    if (!Array.isArray(data[key])) {
      return { ok: false, error: `这个备份里${label}缺失，恢复不了，请换用最新导出的备份文件。` };
    }
  }

  if (!validateSemester(data.semester)) {
    return { ok: false, error: "这个备份里学期信息不完整，恢复不了，请换用最新导出的备份文件。" };
  }
  if (!validateUserProfile(data.userProfile)) {
    return { ok: false, error: "这个备份里用户资料不完整，恢复不了，请换用最新导出的备份文件。" };
  }
  if (!validateCourses(data.courses)) {
    return { ok: false, error: "这个备份里课程数据有问题，恢复不了，请换用最新导出的备份文件。" };
  }
  if (!validateSchedules(data.schedules)) {
    return { ok: false, error: "这个备份里排课数据有问题，恢复不了，请换用最新导出的备份文件。" };
  }
  if (!validateAssignments(data.assignments)) {
    return { ok: false, error: "这个备份里作业数据有问题，恢复不了，请换用最新导出的备份文件。" };
  }
  if (!validateCalendarMarks(data.calendarMarks)) {
    return { ok: false, error: "这个备份里日历标记有问题，恢复不了，请换用最新导出的备份文件。" };
  }
  if (!validateGroupProjects(data.groupProjects)) {
    return { ok: false, error: "这个备份里小组项目有问题，恢复不了，请换用最新导出的备份文件。" };
  }
  // Timeline V1：学习计划可选（旧备份缺失合法；存在则必须合法）
  if (data.studyBlocks !== undefined && !validateStudyBlocks(data.studyBlocks)) {
    return { ok: false, error: "这个备份里学习计划有问题，恢复不了，请换用最新导出的备份文件。" };
  }
  // Task 7G-A1：Reminder 可选（旧备份缺失合法 → 恢复 []；存在则必须合法）
  if (data.reminders !== undefined && !validateReminders(data.reminders)) {
    return { ok: false, error: "这个备份里提醒数据有问题，恢复不了，请换用最新导出的备份文件。" };
  }
  // Task 7：Schedule Occurrence Override 可选（旧备份缺失合法 → 恢复 []；存在则必须合法）
  if (
    data.scheduleOccurrenceOverrides !== undefined &&
    !validateScheduleOccurrenceOverrides(data.scheduleOccurrenceOverrides)
  ) {
    return { ok: false, error: "这个备份里临时调整数据有问题，恢复不了，请换用最新导出的备份文件。" };
  }

  return {
    ok: true,
    data: data as unknown as ClassFlowBackupData,
  };
}

function validateScheduleOccurrenceOverrides(v: unknown): v is ScheduleOccurrenceOverride[] {
  return (
    Array.isArray(v) &&
    v.every(
      (o) =>
        isPlainObject(o) &&
        isNonEmptyString(o.id) &&
        (o.kind === "cancel" || o.kind === "move" || o.kind === "extra") &&
        isNonEmptyString(o.courseId) &&
        typeof o.week === "number"
    )
  );
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
