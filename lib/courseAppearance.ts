/** 课程配色唯一来源：AddCourseModal 与 Kiro 创建课程共用，避免两套默认值 */

export interface CourseAppearance {
  name: string;
  bgHex: string;
  borderHex: string;
  textHex: string;
}

export const COURSE_COLOR_OPTIONS: CourseAppearance[] = [
  { name: "薄荷灰绿", bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032" },
  { name: "象牙浅米", bgHex: "#F0EBE1", borderHex: "#CDB9AB", textHex: "#313032" },
  { name: "灰米暖调", bgHex: "#CCCBC4", borderHex: "#B8B7B0", textHex: "#313032" },
  { name: "石褐沙土", bgHex: "#CDB9AB", borderHex: "#A48F82", textHex: "#313032" },
  { name: "深砂棕", bgHex: "#A48F82", borderHex: "#8D786B", textHex: "#FFFFFF" },
];

/** 默认课程外观（Kiro 创建课程使用；UI 默认选中第一项） */
export function getDefaultCourseAppearance(): CourseAppearance {
  try {
    const { useAppStore } = require("@/store/useAppStore") as typeof import("@/store/useAppStore");
    const state = useAppStore.getState();
    if (state.preferences.courseAutoPalette && state.preferences.coursePalette.length > 0) {
      const idx = state.courses.length % state.preferences.coursePalette.length;
      const hex = state.preferences.coursePalette[idx];
      // 从调色板生成完整外观：bg 为选中色，border 略深，text 自动对比
      const isLight = (() => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return (r * 299 + g * 587 + b * 114) / 1000 > 128;
      })();
      return { name: `自定义 ${idx + 1}`, bgHex: hex, borderHex: hex, textHex: isLight ? "#313032" : "#FFFFFF" };
    }
  } catch {}
  return COURSE_COLOR_OPTIONS[0];
}
