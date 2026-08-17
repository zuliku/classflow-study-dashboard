/**
 * Profile 本地头像（Settings V4 / V4.1）：
 * - 只接受图片（MIME 前缀预过滤 + 解码层权威校验）
 * - 大小上限 5 MB
 * - 读取后降采样（最长边 ≤ 512px）再写入 IndexedDB（独立 DB，不进入课程资料
 *   classflow-files，避免被课程附件的孤儿 Blob 对账清理）
 * - 持久化的是 Blob，不是 blob: URL
 * - 完整备份（ZIP）可选携带头像 Blob（avatar/ 目录）；恢复时按签名重建 MIME
 */

export const AVATAR_STORAGE_KEY = "profile-avatar";
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_MAX_DIMENSION = 512;

const DB_NAME = "classflow-profile-avatars";
const STORE_NAME = "avatars";
const DB_VERSION = 1;

type AvatarValidation =
  | { ok: true }
  | { ok: false; reason: "type" | "size" };

/**
 * 快速前置校验：MIME 前缀 + 大小上限。
 * 注意：MIME 前缀只是预过滤，伪装成 image/* 的无效字节由 validateAvatarDecodable 在解码层拦截。
 */
export function validateAvatarFile(file: Blob & { type?: string; name?: string }): AvatarValidation {
  if (!file.type.startsWith("image/")) return { ok: false, reason: "type" };
  if (file.size > AVATAR_MAX_BYTES) return { ok: false, reason: "size" };
  return { ok: true };
}

/** 真实解码校验：伪装成 image/* 的无效字节在此被拒绝（浏览器环境） */
export async function validateAvatarDecodable(file: Blob): Promise<boolean> {
  try {
    await decodeImage(file);
    return true;
  } catch {
    return false;
  }
}

/** 从字节签名识别图片 MIME（备份恢复时重建 Blob 类型；纯函数可单测） */
export function detectImageMime(bytes: Uint8Array): string {
  if (bytes.length >= 12) {
    const head = new TextDecoder().decode(bytes.slice(0, 12));
    if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return "image/webp";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return "application/octet-stream";
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 保存头像 Blob（覆盖写入固定 key） */
export async function saveAvatarBlob(blob: Blob): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(blob, AVATAR_STORAGE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 读取头像 Blob；不存在时返回 null */
export async function loadAvatarBlob(): Promise<Blob | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(AVATAR_STORAGE_KEY);
    request.onsuccess = () => resolve((request.result as Blob) || null);
    request.onerror = () => reject(request.error);
  });
}

/** 删除头像 Blob（移除头像时清理本地存储） */
export async function deleteAvatarBlob(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(AVATAR_STORAGE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function decodeImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image decode failed"));
    };
    img.src = url;
  });
}

/**
 * 头像处理：降采样到最长边 ≤ 512px（保持宽高比），转 WebP（不支持时 PNG）。
 * 浏览器环境专用；返回可写入 IndexedDB 的 Blob。
 */
export async function processAvatarFile(file: Blob): Promise<Blob> {
  const img = await decodeImage(file);
  const scale = Math.min(1, AVATAR_MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.drawImage(img, 0, 0, width, height);

  const supportsWebp =
    typeof HTMLCanvasElement !== "undefined" && "toBlob" in canvas && canvas.toBlob !== undefined;
  const mime = supportsWebp ? "image/webp" : "image/png";
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("image encode failed"))),
      mime,
      0.85
    );
  });
  return blob;
}
