/**
 * Kiro Motion System V1 —— Empty Intro claim（纯函数）。
 * workspace / sidecar 各自对同一 generation 只能 claim 一次：
 * 切 Tab 不重播、历史会话不播放；new chat（含 project new chat）→ generation 递增 → 可再次 claim。
 */

export type KiroIntroSurface = "workspace" | "sidecar";

export interface KiroIntroSeen {
  workspace: number;
  sidecar: number;
}

export function claimEmptyIntroOnce(
  seen: KiroIntroSeen,
  surface: KiroIntroSurface,
  generation: number
): boolean {
  if (seen[surface] === generation) return false;
  seen[surface] = generation;
  return true;
}
