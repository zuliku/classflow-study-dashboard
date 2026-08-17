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
  return COURSE_COLOR_OPTIONS[0];
}
