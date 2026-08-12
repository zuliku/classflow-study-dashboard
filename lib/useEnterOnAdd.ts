import { useEffect, useRef, useState } from "react";
import { getAddedIds } from "@/lib/addedIds";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";

/**
 * 列表新增动画辅助：返回"新增条目的 id 集合"。
 * 仅当 id 集合出现新成员时加入动画类（animate-enter），
 * 首次渲染不触发，避免页面加载时整表 stagger。
 */
export function useEnterOnAdd(ids: string[]): Set<string> {
  const reducedMotion = useEffectiveReducedMotion();
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const prevRef = useRef<string[] | null>(null);
  const timerRef = useRef<number | null>(null);
  const idsKey = ids.join("\u0000");

  useEffect(() => {
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
    }, 200);
    // idsKey 让流式内容更新不会取消尚未结束的结构动画计时器。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, reducedMotion]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    []
  );

  return newIds;
}
