"use client";

import { useEffect, useState } from "react";
import { readEffectiveMotionDataset, resolveEffectiveReducedMotion } from "@/lib/motionPreference";
import { useAppStore } from "@/store/useAppStore";

const MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

function readBootstrappedReducedMotion(): boolean {
  return typeof document !== "undefined"
    && readEffectiveMotionDataset(document.documentElement.dataset.motionEffective);
}

export function useEffectiveReducedMotion(): boolean {
  const preference = useAppStore((state) => state.preferences.motionPreference);
  const [reducedMotion, setReducedMotion] = useState(readBootstrappedReducedMotion);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      // jsdom / node 环境兜底：按偏好推导，不监听媒体查询
      const reduced = resolveEffectiveReducedMotion(preference, false);
      document.documentElement.dataset.motionPreference = preference;
      document.documentElement.dataset.motionEffective = reduced ? "reduced" : "full";
      setReducedMotion(reduced);
      return;
    }
    const mediaQuery = window.matchMedia(MEDIA_QUERY);
    const update = () => {
      const reduced = resolveEffectiveReducedMotion(preference, mediaQuery.matches);
      document.documentElement.dataset.motionPreference = preference;
      document.documentElement.dataset.motionEffective = reduced ? "reduced" : "full";
      setReducedMotion(reduced);
    };

    update();
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", update);
      return () => mediaQuery.removeEventListener("change", update);
    }

    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, [preference]);

  return reducedMotion;
}
