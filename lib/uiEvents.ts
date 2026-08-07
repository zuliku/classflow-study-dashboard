import { Material } from "@/types";

/** 打开新建/编辑任务弹窗：assignmentId 存在 → 编辑；否则新增（可携带上下文预填） */
export interface OpenAssignmentEditorDetail {
  assignmentId?: string;
  courseId?: string;
  ddlDate?: string;
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
