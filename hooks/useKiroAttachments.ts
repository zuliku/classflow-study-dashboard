"use client";

import { useCallback, useRef, useState } from "react";
import { useToastStore } from "@/store/useToastStore";
import { useAppStore } from "@/store/useAppStore";
import {
  KiroAttachment,
  KiroLocalAttachment,
  KiroMaterialAttachment,
  KiroAttachmentView,
} from "@/lib/ai/attachments/types";
import { routeAttachment, kindToMaterialType } from "@/lib/ai/attachments/router";
import { extractAttachment } from "@/lib/ai/attachments";
import { extractCacheKey } from "@/lib/ai/attachments/cache";
import { MAX_ATTACHMENTS_PER_TURN } from "@/lib/ai/attachments/limits";
import { createImageThumbnail } from "@/lib/ai/attachments/image";
import { createStorageKey, saveFileBlob } from "@/lib/fileStorage";

let seq = 0;
const nextId = () => `att_${++seq}_${Date.now().toString(36)}`;

/**
 * Kiro 聊天附件状态（Task 4）：
 * 临时附件只存在当前 Chat runtime（不进入 useAppStore）；已有课程资料以引用形式加入。
 * 选择/解析都在本地；只有点击 Send 之后才发送给 Provider。
 */
export function useKiroAttachments() {
  const [attachments, setAttachments] = useState<KiroAttachment[]>([]);
  const pushToast = useToastStore((s) => s.pushToast);
  const seqRef = useRef(0);

  const toView = useCallback((a: KiroAttachment): KiroAttachmentView => {
    if (a.source === "local") {
      return {
        id: a.id,
        source: "local",
        kind: a.kind,
        name: a.name,
        size: a.size,
        status: a.status,
        error: a.error,
        thumbnail: a.kind === "image" ? undefined : undefined,
      };
    }
    return {
      id: a.id,
      source: "material",
      kind: a.kind,
      name: a.name,
      status: "ready",
      courseName: a.courseName,
    };
  }, []);

  /** 添加本地文件（选择 / 拖拽 / 粘贴统一入口） */
  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      // 先追加（processing 状态），随后逐项更新，避免状态更新丢失
      const pending: { id: string; base: KiroLocalAttachment; routed: ReturnType<typeof routeAttachment> }[] = [];
      for (const file of files.slice(0, MAX_ATTACHMENTS_PER_TURN)) {
        const routed = routeAttachment(file);
        const base: KiroLocalAttachment = {
          id: nextId(),
          source: "local",
          file,
          name: file.name,
          mimeType: file.type,
          size: file.size,
          kind: routed.ok ? routed.kind : "text",
          status: routed.ok ? "processing" : "unsupported",
          error: routed.ok ? undefined : routed.reason === "too_large" ? "文件超过大小限制。" : "暂不支持这种文件类型。",
        };
        pending.push({ id: base.id, base, routed });
      }
      setAttachments((prev) => [...prev, ...pending.map((p) => p.base)]);

      for (const { id, base, routed } of pending) {
        if (!routed.ok) continue;
        const patch = (partial: Partial<KiroLocalAttachment>) =>
          setAttachments((prev) =>
            prev.map((a) => (a.id === id ? { ...(a as KiroLocalAttachment), ...partial } : a))
          );
        // 图片：只生成缩略图（vision 由模型处理）；文档：本地提取文本
        if (routed.kind === "image") {
          try {
            const thumb = await createImageThumbnail(base.file);
            patch({ status: "ready", thumbnail: thumb || undefined });
          } catch {
            patch({ status: "error", error: "无法生成预览。" });
          }
          continue;
        }
        const result = await extractAttachment(base.file, {
          kind: routed.kind,
          cacheKey: extractCacheKey({ name: base.file.name, size: base.file.size, lastModified: base.file.lastModified }),
        });
        if (result.ok) {
          // 扫描型 PDF：明确 unsupported（不是损坏文件；OCR 属于后续 Task）
          const possiblyScanned = (result.extracted as { possiblyScanned?: boolean }).possiblyScanned === true;
          patch(
            possiblyScanned
              ? { status: "error", error: "这是扫描型 PDF，当前暂不支持读取正文。" }
              : { status: "ready", extracted: result.extracted }
          );
        } else {
          patch({ status: "error", error: result.message });
        }
      }
    },
    []
  );

  /** 添加已有课程资料（引用；正文由 read_material 工具读取） */
  const addMaterial = useCallback(
    (ref: { courseId: string; courseName: string; materialId: string; title: string; type: string }) => {
      const att: KiroMaterialAttachment = {
        id: nextId(),
        source: "material",
        materialId: ref.materialId,
        courseId: ref.courseId,
        courseName: ref.courseName,
        name: ref.title,
        kind: ref.type === "pdf" ? "pdf" : ref.type === "image" ? "image" : ref.type === "doc" ? "docx" : "text",
        status: "ready",
      };
      setAttachments((prev) => [...prev, att]);
    },
    []
  );

  const remove = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const retry = useCallback(
    async (id: string) => {
      const att = attachments.find((a) => a.id === id);
      if (!att || att.source !== "local" || att.kind === "image") return;
      setAttachments((prev) =>
        prev.map((a) => (a.id === id ? { ...(a as KiroLocalAttachment), status: "processing", error: undefined } : a))
      );
      const result = await extractAttachment(att.file, { kind: att.kind });
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === id
            ? result.ok
              ? { ...(a as KiroLocalAttachment), status: "ready", extracted: result.extracted }
              : { ...(a as KiroLocalAttachment), status: "error", error: result.message }
            : a
        )
      );
    },
    [attachments]
  );

  /** 保存临时附件为某课程资料（saveFileBlob + addCourseMaterial） */
  const saveToCourse = useCallback(
    async (attachmentId: string, courseId: string) => {
      const att = attachments.find((a) => a.id === attachmentId);
      if (!att || att.source !== "local") return;
      const course = useAppStore.getState().courses.find((c) => c.id === courseId);
      if (!course) return;
      try {
        const storageKey = createStorageKey();
        await saveFileBlob(storageKey, att.file);
        useAppStore.getState().addCourseMaterial(courseId, {
          title: att.name,
          type: kindToMaterialType(att.kind),
          size: `${(att.size / (1024 * 1024)).toFixed(1)} MB`,
          storageKey,
        });
        pushToast({ message: `已保存到《${course.name}》课程资料` });
      } catch {
        pushToast({ message: "保存失败，请重试。", type: "error" });
      }
    },
    [attachments, pushToast]
  );

  /** 发送后清空（附件已绑定到该 User Turn） */
  const clear = useCallback(() => {
    setAttachments([]);
  }, []);

  const hasProcessing = attachments.some((a) => a.status === "processing");
  const views = attachments.map(toView);

  return {
    attachments,
    views,
    hasProcessing,
    addFiles,
    addMaterial,
    remove,
    retry,
    saveToCourse,
    clear,
  };
}

export type { KiroAttachment, KiroLocalAttachment, KiroMaterialAttachment };
