"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { loadAvatarBlob } from "@/lib/profileAvatar";

/**
 * 头像展示 URL 解析（Settings 与 Sidebar 共用）：
 * avatarStorageKey → IndexedDB Blob → object URL（加载失败回落 avatarUrl → 空）
 * 兼容旧 avatarUrl（外部 URL）。
 */
export function useProfileAvatar(): string {
  const avatarStorageKey = useAppStore((s) => s.userProfile.avatarStorageKey);
  const avatarUrl = useAppStore((s) => s.userProfile.avatarUrl);

  const [blobUrl, setBlobUrl] = useState<string>("");

  useEffect(() => {
    let alive = true;
    let url = "";
    if (!avatarStorageKey) {
      setBlobUrl("");
      return;
    }
    void loadAvatarBlob()
      .then((blob) => {
        if (!alive) return;
        if (blob) {
          url = URL.createObjectURL(blob);
          setBlobUrl(url);
        } else {
          setBlobUrl("");
        }
      })
      .catch(() => {
        if (alive) setBlobUrl("");
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [avatarStorageKey]);

  if (blobUrl) return blobUrl;
  return avatarUrl || "";
}
