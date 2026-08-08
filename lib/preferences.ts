import { AppPreferences } from "@/types";

/** 第一版默认偏好 */
export const DEFAULT_PREFERENCES: AppPreferences = {
  showWeekends: true,
  ddlWarningDays: 3,
  defaultDDLTime: "23:59",
  enableScheduleDirectManipulation: true,
  enableDDLDirectManipulation: true,
  motionPreference: "system",
};

export const DDL_WARNING_DAYS: readonly AppPreferences["ddlWarningDays"][] = [1, 3, 7];
export const MOTION_PREFERENCES: readonly AppPreferences["motionPreference"][] = [
  "system",
  "full",
  "reduced",
];

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
  };
}

/** 偏好 → 所属设置 section（用于导航 modified dot 与已修改分组） */
export const PREFERENCE_SECTIONS: Record<keyof AppPreferences, "semester" | "tasks" | "interaction"> = {
  showWeekends: "semester",
  ddlWarningDays: "tasks",
  defaultDDLTime: "tasks",
  enableScheduleDirectManipulation: "interaction",
  enableDDLDirectManipulation: "interaction",
  motionPreference: "interaction",
};

/** 当前与默认不同的偏好键（纯函数，UI 不自行比较） */
export function getModifiedPreferenceKeys(preferences: AppPreferences): (keyof AppPreferences)[] {
  return (Object.keys(DEFAULT_PREFERENCES) as (keyof AppPreferences)[]).filter(
    (k) => preferences[k] !== DEFAULT_PREFERENCES[k]
  );
}

/** 存在非默认偏好的 section 集合（导航 modified dot / 已修改分组） */
export function getModifiedSections(preferences: AppPreferences): Set<"semester" | "tasks" | "interaction"> {
  const sections = new Set<"semester" | "tasks" | "interaction">();
  for (const key of getModifiedPreferenceKeys(preferences)) {
    const sec = PREFERENCE_SECTIONS[key];
    if (sec) sections.add(sec);
  }
  return sections;
}

/** 单项恢复默认的 patch（纯函数；调用方 updatePreferences(patch) 即可） */
export function resetPreferencePatch(key: keyof AppPreferences): Partial<AppPreferences> {
  return { [key]: DEFAULT_PREFERENCES[key] };
}
