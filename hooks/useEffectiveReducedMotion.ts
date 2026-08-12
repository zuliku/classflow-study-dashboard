"use client";

import { useEffect, useState } from "react";
import { resolveEffectiveReducedMotion } from "@/lib/motionPreference";
import { useAppStore } from "@/store/useAppStore";

const MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

export function useEffectiveReducedMotion(): boolean {
  const preference = useAppStore((state) => state.preferences.motionPreference);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
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
