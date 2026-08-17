/**
 * Task 6A：Assignment ↔ Course Material Links（纯函数，无 React / 无 Store）。
 * Assignment.materialIds 只保存 ID；Course.materials 是 Material Source of Truth。
 * 强约束：Assignment 只能关联其所属 Course.materials（跨课程引用一律拒绝/忽略）。
 */

import { Assignment, Course, Material } from "@/types";

/**
 * 按 assignment.materialIds 原顺序解析出真实 Material：
 * 1. 只在 Assignment 所属 Course.materials 中查找
 * 2. 顺序保持 materialIds 原序
 * 3. Missing ID / 跨课程 ID 自动忽略
 * 4. 不 throw（课程不存在、materialIds 缺失均返回 []）
 */
export function resolveAssignmentMaterials(
  assignment: Pick<Assignment, "courseId" | "materialIds">,
  courses: Course[]
): Material[] {
  const course = courses.find((c) => c.id === assignment.courseId);
  if (!course || !assignment.materialIds || assignment.materialIds.length === 0) return [];
  const byId = new Map(course.materials.map((m) => [m.id, m]));
  const resolved: Material[] = [];
  const seen = new Set<string>();
  for (const id of assignment.materialIds) {
    if (seen.has(id)) continue;
    const m = byId.get(id);
    if (m) {
      resolved.push(m);
      seen.add(id);
    }
  }
  return resolved;
}

/**
 * Domain 写入校验：只保留 candidateIds 中「Assignment 所属课程真实存在」的 ID（去重）。
 * 跨课程引用被拒绝；空结果返回 []（调用方决定存 undefined）。
 */
export function sanitizeAssignmentMaterialIds(
  assignment: Pick<Assignment, "courseId">,
  courses: Course[],
  candidateIds: string[]
): string[] {
  const course = courses.find((c) => c.id === assignment.courseId);
  if (!course) return [];
  const valid = new Set(course.materials.map((m) => m.id));
  const out: string[] = [];
  for (const id of candidateIds) {
    if (typeof id === "string" && valid.has(id) && !out.includes(id)) {
      out.push(id);
    }
  }
  return out;
}
