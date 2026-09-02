import { AppPreferences, Priority, ContentDensity, StartupView } from "@/types";
import { TASK_WORKSPACE_VIEWS, TaskWorkspaceView } from "@/lib/tasks/taskViews";

/** P1：自动 DDL 提醒默认提前分钟数固定档位（7天 / 3天 / 1天 / 1小时） */
export const DEADLINE_REMINDER_MINUTES: readonly AppPreferences["defaultDeadlineReminderMinutes"][] = [
  10080,
  4320,
  1440,
  60,
];
export const DEFAULT_DEADLINE_REMINDER_MINUTES = 1440;

/** P3：设置项中文文案（提前 X） */
export const DEADLINE_REMINDER_LABELS: Record<AppPreferences["defaultDeadlineReminderMinutes"], string> = {
  10080: "提前 7 天",
  4320: "提前 3 天",
  1440: "提前 1 天",
  60: "提前 1 小时",
};

export const FOCUS_DEFAULT_MINUTES: readonly AppPreferences["focusDefaultMinutes"][] = [15, 25, 45, 60];

export const DEFAULT_FOCUS_SOUND_VOLUME = 70;

/** 第一版默认偏好 */
export const DEFAULT_PREFERENCES: AppPreferences = {
  showWeekends: true,
  ddlWarningDays: 3,
  defaultDDLTime: "23:59",
  enableScheduleDirectManipulation: true,
  enableDDLDirectManipulation: true,
  motionPreference: "system",
  startupView: "overview",
  defaultTaskPriority: "medium",
  defaultTaskStatus: "todo",
  enableSingleKeyShortcuts: true,
  contentDensity: "comfortable",
  // Settings V3：任务工作区默认视图 = 当前初始值（focus）
  defaultTaskWorkspaceView: "focus",
  // P1：自动 DDL 提醒默认提前 1 天（1440 分钟）
  defaultDeadlineReminderMinutes: DEFAULT_DEADLINE_REMINDER_MINUTES,
  focusDefaultMinutes: 25,
  focusSoundEnabled: true,
  focusSoundVolume: DEFAULT_FOCUS_SOUND_VOLUME,
};

export const DDL_WARNING_DAYS: readonly AppPreferences["ddlWarningDays"][] = [1, 3, 7];
export const MOTION_PREFERENCES: readonly AppPreferences["motionPreference"][] = [
  "system",
  "full",
  "reduced",
];
export const STARTUP_VIEWS: readonly StartupView[] = ["overview", "timetable", "assignments", "last"];
export const TASK_PRIORITIES: readonly Priority[] = ["low", "medium", "high", "urgent"];
export const TASK_STATUSES: readonly AppPreferences["defaultTaskStatus"][] = ["todo", "doing"];
export const CONTENT_DENSITIES: readonly ContentDensity[] = ["comfortable", "compact"];

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isBool(v: unknown): v is boolean {
  return typeof v === "boolean";
}

/**
 * 逐字段安全回落：preferences missing / partial / invalid 都收敛为合法值。
 * 任何非法输入（如 motionPreference = "hello"、ddlWarningDays = 4、
 * defaultDDLTime 非 HH:mm）都回落到默认值，绝不抛错。
 */
export function sanitizePreferences(v: unknown): AppPreferences {
  const src = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  return {
    showWeekends: isBool(src.showWeekends) ? src.showWeekends : DEFAULT_PREFERENCES.showWeekends,
    ddlWarningDays: (DDL_WARNING_DAYS as readonly unknown[]).includes(src.ddlWarningDays)
      ? (src.ddlWarningDays as AppPreferences["ddlWarningDays"])
      : DEFAULT_PREFERENCES.ddlWarningDays,
    defaultDDLTime:
      typeof src.defaultDDLTime === "string" && HHMM_RE.test(src.defaultDDLTime)
        ? src.defaultDDLTime
        : DEFAULT_PREFERENCES.defaultDDLTime,
    enableScheduleDirectManipulation: isBool(src.enableScheduleDirectManipulation)
      ? src.enableScheduleDirectManipulation
      : DEFAULT_PREFERENCES.enableScheduleDirectManipulation,
    enableDDLDirectManipulation: isBool(src.enableDDLDirectManipulation)
      ? src.enableDDLDirectManipulation
      : DEFAULT_PREFERENCES.enableDDLDirectManipulation,
    motionPreference: (MOTION_PREFERENCES as readonly unknown[]).includes(src.motionPreference)
      ? (src.motionPreference as AppPreferences["motionPreference"])
      : DEFAULT_PREFERENCES.motionPreference,
    startupView: (STARTUP_VIEWS as readonly unknown[]).includes(src.startupView)
      ? (src.startupView as StartupView)
      : DEFAULT_PREFERENCES.startupView,
    defaultTaskPriority: (TASK_PRIORITIES as readonly unknown[]).includes(src.defaultTaskPriority)
      ? (src.defaultTaskPriority as Priority)
      : DEFAULT_PREFERENCES.defaultTaskPriority,
    defaultTaskStatus: (TASK_STATUSES as readonly unknown[]).includes(src.defaultTaskStatus)
      ? (src.defaultTaskStatus as AppPreferences["defaultTaskStatus"])
      : DEFAULT_PREFERENCES.defaultTaskStatus,
    enableSingleKeyShortcuts: isBool(src.enableSingleKeyShortcuts)
      ? src.enableSingleKeyShortcuts
      : DEFAULT_PREFERENCES.enableSingleKeyShortcuts,
    contentDensity: (CONTENT_DENSITIES as readonly unknown[]).includes(src.contentDensity)
      ? (src.contentDensity as ContentDensity)
      : DEFAULT_PREFERENCES.contentDensity,
    defaultTaskWorkspaceView: (TASK_WORKSPACE_VIEWS as readonly { id: TaskWorkspaceView }[])
      .some((v) => v.id === src.defaultTaskWorkspaceView)
      ? (src.defaultTaskWorkspaceView as TaskWorkspaceView)
      : DEFAULT_PREFERENCES.defaultTaskWorkspaceView,
    // P1：自动 DDL 提醒默认提前分钟数——旧数据缺失 / 非法档位安全回落 1440
    defaultDeadlineReminderMinutes: (
      DEADLINE_REMINDER_MINUTES as readonly unknown[]
    ).includes(src.defaultDeadlineReminderMinutes)
      ? (src.defaultDeadlineReminderMinutes as AppPreferences["defaultDeadlineReminderMinutes"])
      : DEFAULT_PREFERENCES.defaultDeadlineReminderMinutes,
    focusDefaultMinutes: (FOCUS_DEFAULT_MINUTES as readonly unknown[]).includes(src.focusDefaultMinutes)
      ? (src.focusDefaultMinutes as AppPreferences["focusDefaultMinutes"])
      : DEFAULT_PREFERENCES.focusDefaultMinutes,
    focusSoundEnabled: isBool(src.focusSoundEnabled)
      ? src.focusSoundEnabled
      : DEFAULT_PREFERENCES.focusSoundEnabled,
    focusSoundVolume:
      typeof src.focusSoundVolume === "number" &&
      Number.isFinite(src.focusSoundVolume) &&
      src.focusSoundVolume >= 0 &&
      src.focusSoundVolume <= 100
        ? Math.round(src.focusSoundVolume)
        : DEFAULT_PREFERENCES.focusSoundVolume,
  };
}

/** 偏好 → 所属设置 section（Settings V4：交互偏好已并入通用） */
export const PREFERENCE_SECTIONS: Record<
  keyof AppPreferences,
  "general" | "semester" | "tasks" | "focus"
> = {
  showWeekends: "semester",
  ddlWarningDays: "tasks",
  defaultDDLTime: "tasks",
  enableScheduleDirectManipulation: "general",
  enableDDLDirectManipulation: "general",
  // Settings V3 IA：全局产品行为（界面密度/动效）归入通用
  motionPreference: "general",
  startupView: "general",
  defaultTaskPriority: "tasks",
  defaultTaskStatus: "tasks",
  enableSingleKeyShortcuts: "general",
  contentDensity: "general",
  defaultTaskWorkspaceView: "tasks",
  defaultDeadlineReminderMinutes: "tasks",
  focusDefaultMinutes: "focus",
  focusSoundEnabled: "focus",
  focusSoundVolume: "focus",
};

/** 当前与默认不同的偏好键（纯函数，UI 不自行比较） */
export function getModifiedPreferenceKeys(preferences: AppPreferences): (keyof AppPreferences)[] {
  return (Object.keys(DEFAULT_PREFERENCES) as (keyof AppPreferences)[]).filter(
    (k) => preferences[k] !== DEFAULT_PREFERENCES[k]
  );
}

/** 单项恢复默认的 patch（纯函数；调用方 updatePreferences(patch) 即可） */
export function resetPreferencePatch(key: keyof AppPreferences): Partial<AppPreferences> {
  return { [key]: DEFAULT_PREFERENCES[key] };
}
