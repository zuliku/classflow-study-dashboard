"use client";

import { useEffect, useState } from "react";
import { getClassFlowDesktopComputerSessionBridge } from "@/lib/desktop/bridge";
import type { ClassFlowDesktopComputerSkillDraftResult } from "@/lib/desktop/types";

/**
 * Skill Draft（P5 §36）：只在 session state === completed 时向 Main 拉取确定性轨迹草稿。
 * - 复用现有 buildSkillDraft（不重建轨迹能力）；
 * - 不把 trajectory 放入 React Store；绝不包含 screenshot；
 * - Surface 本体不承载异步细节。
 */
export function useKiroComputerSessionSkillDraft(input: {
  sessionId: string | null;
  state: string | null;
}): ClassFlowDesktopComputerSkillDraftResult | null {
  const [draft, setDraft] = useState<ClassFlowDesktopComputerSkillDraftResult | null>(null);

  useEffect(() => {
    if (input.state !== "completed" || !input.sessionId) {
      setDraft(null);
      return;
    }
    const bridge = getClassFlowDesktopComputerSessionBridge();
    if (!bridge?.buildSkillDraft) return;
    let cancelled = false;
    void bridge
      .buildSkillDraft({ sessionId: input.sessionId })
      .then((result) => {
        if (!cancelled) setDraft(result);
      })
      .catch(() => {
        if (!cancelled) setDraft(null);
      });
    return () => {
      cancelled = true;
    };
  }, [input.state, input.sessionId]);

  return draft;
}
