export interface PaginationResult<T> {
  items: T[];
  totalItems: number;
  totalPages: number;
  /** clamp 后的安全页号（不会出现 第 2 / 1 页） */
  currentPage: number;
}

export function clampPage(page: number, totalPages: number): number {
  if (totalPages <= 0) return 1;
  return Math.min(Math.max(page, 1), totalPages);
}

/**
 * 纯展示分页：不修改原数组。
 * totalPages 至少为 1（空列表显示第 1 / 1 页）。
 */
export function paginate<T>(items: T[], page: number, pageSize: number): PaginationResult<T> {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / Math.max(1, pageSize)));
  const currentPage = clampPage(page, totalPages);
  const start = (currentPage - 1) * Math.max(1, pageSize);
  return {
    items: items.slice(start, start + Math.max(1, pageSize)),
    totalItems,
    totalPages,
    currentPage,
  };
}
