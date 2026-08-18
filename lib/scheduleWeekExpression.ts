/**
 * 教学周表达式统一解析器（Schedule Week Expression）。
 *
 * 支持：
 * - 单段区间：1-16 / 1-16周 / 第1-16周
 * - 多段逗号（英文/中文逗号）：1-5,7-17 / 1-4,6-7,9-17 / 1-5，7-17
 * - 段与单周混排：3-7,9
 * - 纯枚举：1,3,5,7
 * - 奇偶：单周 / 双周 / 1-16单周 / 1-16双周
 *
 * CourseSchedule.weeks 保持自由字符串（不迁移数据）；本模块是 isScheduleActive /
 * 冲突检测 / 课表导入共享的唯一周次语义来源。
 */

export type WeekParity = "odd" | "even" | "all";

export interface ParsedWeekExpression {
  /** 闭区间段（含端点） */
  ranges: Array<{ start: number; end: number }>;
  /** 独立单周 */
  singles: number[];
  /** 奇偶约束（全局；任何段带"单周/双周"字样即整体生效） */
  parity: WeekParity;
  /** 归一化后的规范字符串（英文逗号） */
  canonical: string;
}

const WEEK_UNIT = /周/g;

/** 清除 "周" 字（保留 1-16 数字语义）；"第" 前缀不影响 */
function stripWeekSuffix(raw: string): string {
  return raw.replace(WEEK_UNIT, "");
}

/**
 * 解析周次表达式。
 * 返回 null：空 / 无任何可识别段（调用方按旧语义回退处理）。
 */
export function parseWeekExpression(expr: string | null | undefined): ParsedWeekExpression | null {
  if (typeof expr !== "string") return null;
  let text = expr.trim();
  if (!text) return null;

  // 奇偶：整体判断（"单周/双周" 出现即全局生效）
  let parity: WeekParity = "all";
  if (text.includes("单周")) parity = "odd";
  else if (text.includes("双周")) parity = "even";

  text = stripWeekSuffix(text);
  text = text.replace(/^第/, "");
  // 统一逗号（英文/中文/全角）
  const parts = text.split(/[,，、]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  const ranges: Array<{ start: number; end: number }> = [];
  const singles: number[] = [];
  const seen = new Set<number>();

  for (const part of parts) {
    // 段内可能残留奇偶字样（如 "1-16单周"）：stripWeekSuffix 已移除 "周"，再移除残留"单/双"
    const cleaned = part.replace(/单|双/g, "");
    const rangeMatch = /^(\d+)\s*[-–—]\s*(\d+)$/.exec(cleaned);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start) {
        ranges.push({ start, end });
        for (let w = start; w <= end; w++) seen.add(w);
        continue;
      }
      continue; // 非法区间段：跳过（不静默猜测）
    }
    const singleMatch = /^(\d+)$/.exec(cleaned);
    if (singleMatch) {
      const week = Number(singleMatch[1]);
      if (Number.isInteger(week) && week >= 1 && !seen.has(week)) {
        singles.push(week);
        seen.add(week);
      }
      continue;
    }
    // 无法识别的段：跳过（调用方可另行判定）
  }

  if (ranges.length === 0 && singles.length === 0) {
    // 纯 "单周"/"双周"（无数字段）
    if (parity !== "all") {
      return { ranges: [], singles: [], parity, canonical: parity === "odd" ? "单周" : "双周" };
    }
    return null;
  }

  const canonical = buildCanonical(ranges, singles, parity);
  return { ranges, singles, parity, canonical };
}

function buildCanonical(
  ranges: Array<{ start: number; end: number }>,
  singles: number[],
  parity: WeekParity
): string {
  const segments: string[] = [];
  for (const r of ranges) segments.push(r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`);
  for (const s of [...singles].sort((a, b) => a - b)) segments.push(`${s}`);
  const body = segments.join(",");
  if (parity === "odd") return `${body}单周`;
  if (parity === "even") return `${body}双周`;
  return body;
}

/** 判断某周是否在教学周表达式内（null → 默认 true，兼容旧行为） */
export function isWeekActive(parsed: ParsedWeekExpression | null, week: number): boolean {
  if (!parsed) return true;
  if (!Number.isInteger(week) || week < 1) return false;
  if (parsed.parity === "odd" && week % 2 === 0) return false;
  if (parsed.parity === "even" && week % 2 !== 0) return false;
  // 纯单周/双周（无任何数字段）：奇偶约束已在上方过滤，命中即 active
  if (parsed.ranges.length === 0 && parsed.singles.length === 0) return true;
  if (parsed.singles.includes(week)) return true;
  return parsed.ranges.some((r) => week >= r.start && week <= r.end);
}

/** 表达式覆盖的最大周次（null → fallback，默认 16） */
export function getMaxActiveWeek(parsed: ParsedWeekExpression | null, fallback = 16): number {
  if (!parsed) return fallback;
  let max = 0;
  for (const r of parsed.ranges) max = Math.max(max, r.end);
  for (const s of parsed.singles) max = Math.max(max, s);
  return max > 0 ? max : fallback;
}

/** 归一化（英文逗号规范形式；无法解析返回原串） */
export function normalizeWeekExpression(expr: string | null | undefined): string {
  const parsed = parseWeekExpression(expr);
  if (!parsed) return typeof expr === "string" ? expr : "";
  return parsed.canonical;
}
