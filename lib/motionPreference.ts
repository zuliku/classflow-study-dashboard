export type MotionPreference = "system" | "full" | "reduced";

export const APP_STORAGE_KEY = "classflow-storage-v2";

export function resolveEffectiveReducedMotion(
  preference: MotionPreference,
  systemReduced: boolean
): boolean {
  if (preference === "reduced") return true;
  if (preference === "full") return false;
  return systemReduced;
}

export function readPersistedMotionPreference(raw: string | null): MotionPreference {
  if (!raw) return "system";

  try {
    const parsed = JSON.parse(raw) as {
      state?: { preferences?: { motionPreference?: unknown } };
      preferences?: { motionPreference?: unknown };
    };
    const preference = parsed.state?.preferences?.motionPreference
      ?? parsed.preferences?.motionPreference;
    return preference === "full" || preference === "reduced" || preference === "system"
      ? preference
      : "system";
  } catch {
    return "system";
  }
}

export const MOTION_BOOTSTRAP_SCRIPT = `
(() => {
  let preference = "system";
  try {
    const raw = window.localStorage.getItem("${APP_STORAGE_KEY}");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        const persisted = (parsed && parsed.state && parsed.state.preferences)
          || (parsed && parsed.preferences);
        if (persisted && ["system", "full", "reduced"].includes(persisted.motionPreference)) {
          preference = persisted.motionPreference;
        }
      } catch {}
    }
  } catch {}
  try {
    const systemReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const reduced = preference === "reduced" || (preference === "system" && systemReduced);
    const root = document.documentElement;
    root.dataset.motionPreference = preference;
    root.dataset.motionEffective = reduced ? "reduced" : "full";
  } catch {}
})();`;
