"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";

/**
 * TypographyRuntime — 极轻量 Runtime
 * 职责：订阅 uiFont 偏好并同步至 html dataset
 * first paint 由 src/renderer/index.html 的 pre-paint 脚本负责；本运行时负责后续偏好更新，无需重启。
 * 仅订阅 uiFont 字段，避免 Home 因字体变化订阅完整 preferences。
 */
export function TypographyRuntime() {
  const uiFont = useAppStore((s) => s.preferences.uiFont);
  useEffect(() => {
    try {
      document.documentElement.dataset.uiFont = uiFont;
    } catch {}
  }, [uiFont]);
  return null;
}

/** 同步 helper（可测试）—— 不依赖 React，仅操作 dataset */
export function applyUIFontDataset(value: string) {
  const normalized = (["harmonyos-sans-sc", "source-han-sans-sc", "misan"] as const).includes(
    value as never
  )
    ? value
    : "harmonyos-sans-sc";
  try {
    document.documentElement.dataset.uiFont = normalized;
  } catch {}
  return normalized;
}
