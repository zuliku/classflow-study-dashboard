"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToastStore } from "@/store/useToastStore";
import { useAppStore } from "@/store/useAppStore";
import {
  KiroAttachment,
  KiroLocalAttachment,
  KiroMaterialAttachment,
  KiroAttachmentView,
  KiroAttachmentKind,
} from "@/lib/ai/attachments/types";
import { routeAttachment, kindToMaterialType, formatAttachmentLimit } from "@/lib/ai/attachments/router";
import { extractAttachment } from "@/lib/ai/attachments";
import { extractCacheKey, hashBlobFingerprint } from "@/lib/ai/attachments/cache";
import { MAX_ATTACHMENTS_PER_TURN } from "@/lib/ai/attachments/limits";
import { createImageThumbnail } from "@/lib/ai/attachments/image";
import { createStorageKey, saveFileBlob, getFileBlob, isQuotaExceededError } from "@/lib/fileStorage";
import {
  registerLiveImageSource,
  unregisterLiveImageSource,
  updateLiveImageSourceThumbnail,
} from "@/lib/ai/attachments/liveImageRegistry";

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
  // 上限计算经 ref 读最新列表（addFiles 回调身份稳定，不 stale）
  const attachmentsRef = useRef<KiroAttachment[]>([]);
  attachmentsRef.current = attachments;
  // 在途解析取消：误选大文件后 remove/clear 可立即中断后台解析
  const controllersRef = useRef(new Map<string, AbortController>());
  const isAbortError = (err: unknown) =>
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError");
  const isAlive = (id: string, signal?: AbortSignal) =>
    !signal?.aborted &&
    // 初次 addFiles 的 setState 可能尚未 commit（快速缩略图/缓存命中）：
    // 在途 controller 是同一附件仍存活的同步事实，避免误判为“已移除”而永久停在 processing。
    (controllersRef.current.has(id) || attachmentsRef.current.some((a) => a.id === id));

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
      // 上限按「已有 + 新增」合并计算（此前只截新增，超额静默丢弃）
      const remaining = Math.max(0, MAX_ATTACHMENTS_PER_TURN - attachmentsRef.current.length);
      if (remaining <= 0) {
        pushToast({ message: `附件已达上限（${MAX_ATTACHMENTS_PER_TURN} 个），请先移除再添加。`, type: "warning" });
        return;
      }
      const accepted = files.slice(0, remaining);
      if (accepted.length < files.length) {
        pushToast({ message: `附件最多 ${MAX_ATTACHMENTS_PER_TURN} 个，已忽略多余的 ${files.length - accepted.length} 个。`, type: "warning" });
      }
      // 先追加（processing 状态），随后逐项更新，避免状态更新丢失
      const pending: { id: string; base: KiroLocalAttachment; routed: ReturnType<typeof routeAttachment> }[] = [];
      for (const file of accepted) {
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
          // P0：失败给数字+下一步（此前“超过限制”无数字、“不支持”无列表，删了重加同样失败）
          error: routed.ok
            ? undefined
            : routed.reason === "too_large"
              ? `文件过大（${(file.size / 1048576).toFixed(1)}MB），${routed.kind}上限 ${formatAttachmentLimit(routed.limit)}，请压缩或拆分后重试。`
              : routed.reason === "too_small"
                ? "文件为空，无法读取。"
                : routed.reason === "legacy"
                  ? "暂不支持旧版 Office 格式（.doc/.ppt），请另存为 .docx/.pptx 后重试。"
                  : "暂不支持这种文件类型（支持 PDF/Word/Excel/PPT/纯文本/图片）。",
        };
        pending.push({ id: base.id, base, routed });
      }
      setAttachments((prev) => [...prev, ...pending.map((p) => p.base)]);

      // V1.5.1：所有 image File 必须在任何 image await 之前完成 initial registration
      //（注册只发生在「该附件确实已进入本 Turn 列表」之后；Remove → unregister / Conversation
      //  clear → clearLiveImageSources 之后，async thumbnail 的 update 只会 no-op，
      //  不可能让被移除 / 旧会话的图片重新进入 Registry）
      for (const { id, base, routed } of pending) {
        if (!routed.ok || routed.kind !== "image") continue;
        registerLiveImageSource({ id, file: base.file, name: base.name });
      }

      for (const { id, base, routed } of pending) {
        if (!routed.ok) continue;
        const controller = new AbortController();
        controllersRef.current.set(id, controller);
        const signal = controller.signal;
        const patch = (partial: Partial<KiroLocalAttachment>) =>
          setAttachments((prev) =>
            prev.map((a) => (a.id === id ? { ...(a as KiroLocalAttachment), ...partial } : a))
          );
        // 图片：只生成缩略图（vision 由模型处理）；文档：本地提取文本
        if (routed.kind === "image") {
          try {
            const thumb = await createImageThumbnail(base.file, 96, signal);
            if (!isAlive(id, signal)) continue;
            // 只更新已存在 entry；被移除 / 会话已切换 → no-op（绝不复活 ghost source）
            updateLiveImageSourceThumbnail(id, thumb || undefined);
            patch({ status: "ready", thumbnail: thumb || undefined });
          } catch (err) {
            if (isAbortError(err) || !isAlive(id, signal)) continue;
            // thumbnail 失败 → 从 runtime registry 移除（不留无图来源）
            unregisterLiveImageSource(id);
            patch({ status: "error", error: "无法生成预览。" });
          } finally {
            controllersRef.current.delete(id);
          }
          continue;
        }
        try {
          const contentHash = await hashBlobFingerprint(base.file);
          if (!isAlive(id, signal)) continue;
          const result = await extractAttachment(base.file, {
            kind: routed.kind,
            signal,
            cacheKey: extractCacheKey({
              name: base.file.name,
              size: base.file.size,
              lastModified: base.file.lastModified,
              contentHash,
            }),
          });
          if (!isAlive(id, signal)) continue;
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
        } catch (err) {
          if (isAbortError(err) || !isAlive(id, signal)) continue;
          patch({ status: "error", error: "无法读取该文件，请确认格式与内容。" });
        } finally {
          controllersRef.current.delete(id);
        }
      }
    },
    [pushToast]
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
        void inspectMaterialPdf(id, ref.courseId, ref.materialId);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /** 课程资料 PDF inspection（添加与重试共用：读 Blob → 提取 → 标记扫描件/页数） */
  const inspectMaterialPdf = useCallback(async (id: string, courseId: string, materialId: string) => {
    controllersRef.current.get(id)?.abort();
    const controller = new AbortController();
    controllersRef.current.set(id, controller);
    const signal = controller.signal;
    const storageKey = useAppStore
      .getState()
      .courses.find((c) => c.id === courseId)
      ?.materials.find((m) => m.id === materialId)?.storageKey;
    if (!storageKey) {
      controllersRef.current.delete(id);
      return; // 外部链接资料：不尝试下载，保持 ready
    }
    const patch = (partial: Partial<KiroMaterialAttachment>) =>
      setAttachments((prev) => prev.map((a) => (a.id === id ? { ...(a as KiroMaterialAttachment), ...partial } : a)));
    patch({ status: "processing" });
    try {
      const blob = await getFileBlob(storageKey);
      if (!isAlive(id, signal)) return;
      if (!blob) {
        patch({ status: "error", error: "本地文件已丢失，请重新上传。" });
        return;
      }
      const result = await extractAttachment(blob as Blob & { name?: string }, {
        kind: "pdf",
        signal,
        cacheKey: extractCacheKey({ storageKey }),
      });
      if (!isAlive(id, signal)) return;
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
    } catch (err) {
      if (isAbortError(err) || !isAlive(id, signal)) return;
      patch({ status: "error", error: "资料读取失败。" });
    } finally {
      controllersRef.current.delete(id);
    }
  }, []);

  const remove = useCallback((id: string) => {
    controllersRef.current.get(id)?.abort();
    controllersRef.current.delete(id);
    unregisterLiveImageSource(id);
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // 卸载时中断全部在途解析，避免后台白耗 + 迟到 patch
  const abortAll = useCallback(() => {
    for (const c of controllersRef.current.values()) {
      try {
        c.abort();
      } catch {
        /* 忽略 */
      }
    }
    controllersRef.current.clear();
  }, []);

  useEffect(() => () => abortAll(), [abortAll]);

  const retry = useCallback(
    async (id: string) => {
      const att = attachmentsRef.current.find((a) => a.id === id);
      if (!att || att.status !== "error") return;
      controllersRef.current.get(id)?.abort();
      const controller = new AbortController();
      controllersRef.current.set(id, controller);
      const signal = controller.signal;
      // 图片：重生成缩略图（与 addFiles 同一路径；registry 已有 entry 则更新）
      if (att.source === "local" && att.kind === "image") {
        setAttachments((prev) =>
          prev.map((a) => (a.id === id ? { ...(a as KiroLocalAttachment), status: "processing", error: undefined } : a))
        );
        try {
          const thumb = await createImageThumbnail(att.file, 96, signal);
          if (!isAlive(id, signal)) return;
          updateLiveImageSourceThumbnail(id, thumb || undefined);
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === id ? { ...(a as KiroLocalAttachment), status: "ready", thumbnail: thumb || undefined } : a
            )
          );
        } catch (err) {
          if (isAbortError(err) || !isAlive(id, signal)) return;
          unregisterLiveImageSource(id);
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === id ? { ...(a as KiroLocalAttachment), status: "error", error: "无法生成预览。" } : a
            )
          );
        } finally {
          controllersRef.current.delete(id);
        }
        return;
      }
      // 课程资料 PDF：重跑 inspection（文件恢复后可自愈）
      if (att.source === "material" && att.kind === "pdf") {
        controllersRef.current.delete(id);
        await inspectMaterialPdf(id, att.courseId, att.materialId);
        return;
      }
      if (att.source !== "local") {
        controllersRef.current.delete(id);
        return;
      }
      setAttachments((prev) =>
        prev.map((a) => (a.id === id ? { ...(a as KiroLocalAttachment), status: "processing", error: undefined } : a))
      );
      try {
        const result = await extractAttachment(att.file, { kind: att.kind, signal });
        if (!isAlive(id, signal)) return;
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === id
              ? result.ok
                ? { ...(a as KiroLocalAttachment), status: "ready", extracted: result.extracted }
                : { ...(a as KiroLocalAttachment), status: "error", error: result.message }
              : a
          )
        );
      } catch (err) {
        if (isAbortError(err) || !isAlive(id, signal)) return;
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === id
              ? { ...(a as KiroLocalAttachment), status: "error", error: "无法读取该文件，请确认格式与内容。" }
              : a
          )
        );
      } finally {
        controllersRef.current.delete(id);
      }
    },
    [inspectMaterialPdf]
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
      } catch (err) {
        pushToast({
          message: isQuotaExceededError(err)
            ? "本地存储空间已满，清理课程资料或备份后重试。"
            : "保存失败，请重试。",
          type: "error",
        });
      }
    },
    [attachments, pushToast]
  );

  /** 发送后清空（附件已绑定到该 User Turn） */
  const clear = useCallback(() => {
    for (const c of controllersRef.current.values()) {
      try {
        c.abort();
      } catch {
        /* 忽略 */
      }
    }
    controllersRef.current.clear();
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
