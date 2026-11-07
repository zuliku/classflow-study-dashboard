import type { PlanSelection } from "./planTypes";
import { planTimeToMinutes } from "./canvasLayout";

/** 画布/Inspector 共用的选中态 key。 */
export function planSelectionKey(selection: PlanSelection | null): string | null {
  if (!selection) return null;
  switch (selection.kind) {
    case "assignment":
      return `assignment-${selection.assignmentId}`;
    case "block":
      return `block-${selection.blockId}`;
    case "mark":
      return `mark-${selection.markId}`;
    case "course": {
      const start = planTimeToMinutes(selection.startTime) ?? 0;
      return `course-${selection.courseId}-${selection.date}-${start}`;
    }
  }
}
