import { useEffect, useRef, useState } from "react";

/**
 * 列表新增动画辅助：返回"新增条目的 id 集合"。
 * 仅当 id 集合出现新成员时加入动画类（animate-enter），
 * 首次渲染不触发，避免页面加载时整表 stagger。
 */
export function useEnterOnAdd(ids: string[]): Set<string> {
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const prevRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    if (prev) {
      const added = ids.filter((id) => !prev.has(id));
      if (added.length > 0) {
        setNewIds((cur) => new Set(Array.from(cur).concat(added)));
      }
    }
    prevRef.current = new Set(ids);
  }, [ids]);

  return newIds;
}
