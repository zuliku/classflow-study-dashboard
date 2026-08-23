import { Assignment, Material } from "@/types";

/**
 * Quick Add → Full Editor 的草稿 prefill（Workflow UX V5）：
 * 仅表单可编辑字段的轻量子集——这是"新建草稿 prefill"，不是 Assignment snapshot。
 * 刻意不携带 id / materialIds / recurrenceSeriesId / recurrenceParentId /
 * autoReminderDisabled 等 Domain metadata。
 */
export type AssignmentEditorDraft = Partial<
  Pick<
    Assignment,
    | "title"
    | "courseId"
    | "ddl"
    | "estimatedMinutes"
    | "priority"
    | "status"
    | "description"
  >
>;

/** 打开新建/编辑任务弹窗：assignmentId 存在 → 编辑（忽略 draft / materialId）；否则新增 */
export interface OpenAssignmentEditorDetail {
  assignmentId?: string;
  courseId?: string;
  ddlDate?: string;
  /** Capture Continuity：Quick Add → Full Editor 的草稿移交 */
  draft?: AssignmentEditorDraft;
  /**
   * Workflow UX V7：Resource → Task Promotion——create-only 关联资料 context。
   * 编辑模式（assignmentId 存在）必须忽略；不携带任何 Domain metadata。
   */
  materialId?: string;
}

export interface PreviewMaterialDetail {
  material: Material;
}

/** 跨组件事件集中定义（避免魔法字符串散落） */
export const UI_EVENT = {
  openAssignmentEditor: "classflow:open-assignment-editor",
  previewMaterial: "classflow:preview-material",
} as const;

export function openAssignmentEditor(detail: OpenAssignmentEditorDetail): void {
  window.dispatchEvent(
    new CustomEvent<OpenAssignmentEditorDetail>(UI_EVENT.openAssignmentEditor, { detail })
  );
}

export function onOpenAssignmentEditor(
  handler: (detail: OpenAssignmentEditorDetail) => void
): () => void {
  const listener = (e: Event) => {
    handler((e as CustomEvent<OpenAssignmentEditorDetail>).detail ?? {});
  };
  window.addEventListener(UI_EVENT.openAssignmentEditor, listener);
  return () => window.removeEventListener(UI_EVENT.openAssignmentEditor, listener);
}

export function previewMaterial(material: Material): void {
  window.dispatchEvent(
    new CustomEvent<PreviewMaterialDetail>(UI_EVENT.previewMaterial, { detail: { material } })
  );
}

export function onPreviewMaterial(
  handler: (material: Material) => void
): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<PreviewMaterialDetail>).detail;
    if (detail?.material) handler(detail.material);
  };
  window.addEventListener(UI_EVENT.previewMaterial, listener);
  return () => window.removeEventListener(UI_EVENT.previewMaterial, listener);
}
