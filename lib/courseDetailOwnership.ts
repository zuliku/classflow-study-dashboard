/**
 * Course Floating Hub Entity Ownership（V1 closure）—— 纯判定，供 UI 与测试共用。
 * 不建 Framework：只有两个最小函数。
 *
 * Selection Entity（currentId）只负责 open/close / swap 驱动 / focus restore；
 * Displayed Entity（displayedId）负责所有可见内容与 mutation target。
 * 任何稳定 render frame 上两者必须通过 swap 状态机收敛，见 isCourseEntityInteractive。
 */

export type CourseSwapPhase = "in" | "out";

/**
 * 实体可交互判定：
 * 仅当「当前选中的 Course === 已完成视觉 swap 的 Course」时才允许 entity mutation。
 * - swap-out（A→B 的 60ms fade-out）：旧 A 内容仅视觉退场，non-interactive
 * - close presence（currentId === null）：内容仅供退场，non-interactive
 * - reduced motion：displayedId 立即 = currentId + phase=in → 立即 interactive
 */
export function isCourseEntityInteractive(
  currentId: string | null,
  displayedId: string | null,
  swapPhase: CourseSwapPhase
): boolean {
  return currentId !== null && displayedId === currentId && swapPhase === "in";
}

/**
 * 上传目标解析（async 生命周期固定 target）：
 * 点击「上传资料」时 capture 的 courseId 优先；缺失时回落当前 displayed entity。
 * 即使 async upload resolve 时 displayedCourse 已切到 B，target 仍为点击时的 A。
 */
export function resolveMaterialUploadTarget(
  capturedCourseId: string | null,
  fallbackDisplayedCourseId: string | null
): string | null {
  return capturedCourseId ?? fallbackDisplayedCourseId;
}
