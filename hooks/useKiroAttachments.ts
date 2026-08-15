"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useToastStore } from "@/store/useToastStore";
import { useAppStore } from "@/store/useAppStore";
import {
  KiroAttachment,
  KiroLocalAttachment,
  KiroMaterialAttachment,
  KiroAttachmentView,
  KiroAttachmentKind,
} from "@/lib/ai/attachments/types";
import { routeAttachment, kindToMaterialType } from "@/lib/ai/attachments/router";
import { extractAttachment } from "@/lib/ai/attachments";
import { extractCacheKey } from "@/lib/ai/attachments/cache";
import { MAX_ATTACHMENTS_PER_TURN } from "@/lib/ai/attachments/limits";
import { createImageThumbnail } from "@/lib/ai/attachments/image";
import { createStorageKey, saveFileBlob, getFileBlob } from "@/lib/fileStorage";

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
      const scanned = a.extracted?.possiblyScanned === true;
      return {
        id: a.id,
        source: "local",
        kind: a.kind,
        name: a.name,
        size: a.size,
        status: a.status,
        error: a.error,
        // Task B：local image ready 后透出真实缩略图（KiroAttachmentChip 已支持渲染）
        thumbnail: a.kind === "image" ? a.thumbnail : undefined,
        visionRequired: scanned,
        pageCount: scanned ? a.extracted?.pageCount : undefined,
      };
    }
    return {
      id: a.id,
      source: "material",
      kind: a.kind,
      name: a.name,
      status: a.status,
      error: a.error,
      courseName: a.courseName,
      visionRequired: a.pdfVision?.scanned === true,
      pageCount: a.pdfVision?.scanned === true ? a.pdfVision.pageCount : undefined,
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
          // 扫描型 PDF（Task 12）：不再是 error —— ready + Vision metadata（发送时渲染页面图）
          const possiblyScanned = result.extracted.possiblyScanned === true;
          patch(
            possiblyScanned
              ? { status: "ready", extracted: result.extracted }
              : { status: "ready", extracted: result.extracted }
          );
        } else {
          patch({ status: "error", error: result.message });
        }
      }
    },
    []
  );

  /** 添加已有课程资料（引用；正文由 read_material 工具读取；PDF 异步 inspection 检测扫描件） */
  const addMaterial = useCallback(
    (ref: { courseId: string; courseName: string; materialId: string; title: string; type: string }) => {
      const id = nextId();
      const kind: KiroAttachmentKind =
        ref.type === "pdf" ? "pdf" : ref.type === "image" ? "image" : ref.type === "doc" ? "docx" : "text";
      const att: KiroMaterialAttachment = {
        id,
        source: "material",
        materialId: ref.materialId,
        courseId: ref.courseId,
        courseName: ref.courseName,
        name: ref.title,
        kind,
        status: "ready",
      };
      setAttachments((prev) => [...prev, att]);

      // PDF：异步 inspection（只存 possiblyScanned/pageCount，不复制正文）
      if (kind === "pdf") {
        const storageKey = useAppStore
          .getState()
          .courses.find((c) => c.id === ref.courseId)
          ?.materials.find((m) => m.id === ref.materialId)?.storageKey;
        if (!storageKey) return; // 外部链接资料：不尝试下载，保持 ready
        const patch = (partial: Partial<KiroMaterialAttachment>) =>
          setAttachments((prev) => prev.map((a) => (a.id === id ? { ...(a as KiroMaterialAttachment), ...partial } : a)));
        patch({ status: "processing" });
        void (async () => {
          try {
            const blob = await getFileBlob(storageKey);
            if (!blob) {
              patch({ status: "error", error: "本地文件已丢失，请重新上传。" });
              return;
            }
            const result = await extractAttachment(blob as Blob & { name?: string }, {
              kind: "pdf",
              cacheKey: extractCacheKey({ storageKey }),
            });
            if (!result.ok) {
              patch({ status: "error", error: result.message });
              return;
            }
            if (result.extracted.possiblyScanned === true) {
              patch({
                status: "ready",
                pdfVision: { scanned: true, pageCount: result.extracted.pageCount ?? 1 },
              });
            } else {
              patch({ status: "ready" });
            }
          } catch {
            patch({ status: "error", error: "资料读取失败。" });
          }
        })();
      }
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

  // 派生视图 memo：附件数组不变时不重建（避免无关 Chat token 触发）
  const views = useMemo(() => attachments.map(toView), [attachments, toView]);
  const hasProcessing = useMemo(() => attachments.some((a) => a.status === "processing"), [attachments]);

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
