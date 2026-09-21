/**
 * Computer Use V2.1 — 控件语义检索（find_desktop_element 的确定性打分核心）。
 *
 * 设计（参考 UFO² SoM「从预定义列表选择」优于模型自行定位）：
 * - 只在当前 observation 已收集的控件里检索，绝不触发新的 UIA 扫描
 * - 打分完全确定性（名称精确 > 前缀 > 包含 > 角色匹配；enabled/focused 轻加权）
 * - 返回 elementId 供 desktop_action 使用（模型不需要"肉眼"在长列表里找）
 */

export interface SearchableElement {
  elementId: string;
  role: string;
  name: string;
  enabled: boolean;
  focused: boolean;
}

export interface ElementMatch extends SearchableElement {
  score: number;
}

export const ELEMENT_SEARCH_DEFAULT_RESULTS = 5;
export const ELEMENT_SEARCH_MAX_RESULTS = 10;

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/** 单个控件对 query 的确定性得分（0 = 不匹配） */
export function scoreElementMatch(element: SearchableElement, query: string): number {
  const q = normalize(query);
  if (!q) return 0;
  const name = normalize(element.name);
  const role = normalize(element.role);
  const tokens = q.split(" ").filter(Boolean);

  let score = 0;
  if (name && name === q) score += 100;
  else if (name && name.startsWith(q)) score += 80;
  else if (name && name.includes(q)) score += 60;
  else if (tokens.length > 1 && tokens.every((t) => name.includes(t))) score += 50;

  if (role === q) score += 40;
  else if (role.includes(q)) score += 20;

  // 多词查询：名称命中 token 的细粒度加分（上限 30）
  let tokenHits = 0;
  for (const token of tokens) {
    if (token.length >= 2 && name.includes(token)) tokenHits += 1;
  }
  score += Math.min(tokenHits * 10, 30);

  if (score > 0) {
    if (element.enabled) score += 5;
    if (element.focused) score += 5;
  }
  return score;
}

/**
 * 检索并排序（score desc → 名称短者优先 → elementId 升序，保证稳定可复现）。
 */
export function searchObservationElements<T extends SearchableElement>(
  elements: readonly T[],
  query: string,
  maxResults: number = ELEMENT_SEARCH_DEFAULT_RESULTS
): ElementMatch[] {
  const limit = Math.max(1, Math.min(Math.trunc(maxResults) || ELEMENT_SEARCH_DEFAULT_RESULTS, ELEMENT_SEARCH_MAX_RESULTS));
  const matches: ElementMatch[] = [];
  for (const element of elements) {
    const score = scoreElementMatch(element, query);
    if (score <= 0) continue;
    matches.push({ ...element, score });
  }
  matches.sort(
    (a, b) =>
      b.score - a.score ||
      a.name.length - b.name.length ||
      a.elementId.localeCompare(b.elementId)
  );
  return matches.slice(0, limit);
}
