import { useEffect, useRef, useState } from "react";
import { getAddedIds } from "@/lib/addedIds";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import { MOTION_MS } from "@/lib/motion";

/**
 * 列表新增动画辅助：返回"新增条目的 id 集合"。
 * 仅当 id 集合出现新成员时加入动画类（animate-enter），
 * 首次渲染不触发，避免页面加载时整表 stagger。
 * scopeKey（可选）：作用域变化（如切换项目/视图）时直接把 prev 同步为新 ids，
 * 不把「另一作用域的 items」误判为新增（向后兼容：不传则行为不变）。
 *
 * Motion Contract：newIds 保留时长 = MOTION_MS.base，与 animate-enter 的 CSS
 * 动画时长（--motion-base）同源一致——flag 消失不会早于/晚于视觉动画。
 */
export function useEnterOnAdd(ids: string[], scopeKey?: string): Set<string> {
  const reducedMotion = useEffectiveReducedMotion();
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const prevRef = useRef<string[] | null>(null);
  const prevScopeRef = useRef<string | undefined>(scopeKey);
  const timerRef = useRef<number | null>(null);
  const idsKey = ids.join("\u0000");

  useEffect(() => {
    if (scopeKey !== prevScopeRef.current) {
      prevScopeRef.current = scopeKey;
      prevRef.current = ids;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setNewIds(new Set());
      return;
    }
    const added = getAddedIds(prevRef.current, ids);
    prevRef.current = ids;
    if (reducedMotion) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setNewIds(new Set());
      return;
    }
    if (added.length === 0) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setNewIds(new Set(added));
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setNewIds(new Set());
    }, MOTION_MS.base);
    // idsKey 让流式内容更新不会取消尚未结束的结构动画计时器。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, scopeKey, reducedMotion]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    []
  );

  return newIds;
}
