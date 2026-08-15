/**
 * Kiro Streaming Hot Path 测量 hooks（Streaming UX V4.2 Phase 1 baseline）。
 *
 * 严格 test/DEV-only：只有 window.__kiroStreamPerf 存在（Playwright addInitScript
 * 注入 / 测试环境）才记账；生产环境不存在该全局 → 每次调用一次属性访问，无其它开销。
 * 全部测量点：
 * - splitterCalls / splitterChars：Markdown block splitter 调用次数与实际扫描字符量
 * - inlineSplitterCalls / inlineSplitterChars：长单段 inline splitter
 * - worklogRenders / worklogRendersByPhase：KiroWorklog render 次数
 * - toolRowRenders / toolRowRendersTotal：KiroToolRow render 次数（按 block id）
 * - resizeObserverCalls：KiroConversation ResizeObserver 触发次数
 * - scrollTopWrites：自动 scrollTop 实际写入次数
 */

export interface KiroStreamPerfCounters {
  splitterCalls: number;
  splitterChars: number;
  inlineSplitterCalls: number;
  inlineSplitterChars: number;
  worklogRenders: number;
  worklogRendersByPhase: Record<string, number>;
  toolRowRenders: Record<string, number>;
  toolRowRendersTotal: number;
  resizeObserverCalls: number;
  scrollTopWrites: number;
  citationScans: number;
  presentationCalls: number;
  presentationParts: number;
  /** V4.3 settle：settle 决策次数（reuse 或 full canonical；= streaming=false 帧已渲染） */
  settleTransitions: number;
  /** V4.3 settle：完整 canonical full parse 次数 */
  settleFullParses: number;
  /** V4.3 settle：safe-reuse 复用的 stable block 数 */
  settleReusedBlocks: number;
  /** V4.3 settle：canonical fallback 实际渲染次数 */
  settleCanonicalFallbacks: number;
  /** V4.3 settle：settle 帧实际重 parse 的字符量（reuse ≈ 最后 tail；canonical = 全文） */
  settleParsedChars: number;
  /** V4.3 settle：canonical full render 的渲染+提交耗时（test-only） */
  settleDurationMs: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __kiroStreamPerf: Partial<KiroStreamPerfCounters> | undefined;
}

function counters(): KiroStreamPerfCounters | null {
  const g = (typeof window !== "undefined" ? window : globalThis) as unknown as {
    __kiroStreamPerf?: Partial<KiroStreamPerfCounters>;
  };
  const c = g.__kiroStreamPerf;
  if (!c) return null;
  if (typeof c.splitterCalls !== "number") {
    c.splitterCalls = 0;
    c.splitterChars = 0;
    c.inlineSplitterCalls = 0;
    c.inlineSplitterChars = 0;
    c.worklogRenders = 0;
    c.worklogRendersByPhase = {};
    c.toolRowRenders = {};
    c.toolRowRendersTotal = 0;
    c.resizeObserverCalls = 0;
    c.scrollTopWrites = 0;
    c.citationScans = 0;
    c.presentationCalls = 0;
    c.presentationParts = 0;
    c.settleFullParses = 0;
    c.settleTransitions = 0;
    c.settleReusedBlocks = 0;
    c.settleCanonicalFallbacks = 0;
    c.settleParsedChars = 0;
    c.settleDurationMs = 0;
  }
  return c as KiroStreamPerfCounters;
}

export function bumpStreamPerf(
  key:
    | "splitterCalls"
    | "inlineSplitterCalls"
    | "worklogRenders"
    | "toolRowRendersTotal"
    | "resizeObserverCalls"
    | "scrollTopWrites"
    | "citationScans"
    | "presentationCalls"
    | "settleFullParses"
    | "settleTransitions"
    | "settleReusedBlocks"
    | "settleCanonicalFallbacks"
): void {
  const c = counters();
  if (!c) return;
  c[key] += 1;
}

export function addStreamPerfChars(
  key: "splitterChars" | "inlineSplitterChars" | "presentationParts" | "settleParsedChars",
  chars: number
): void {
  const c = counters();
  if (!c) return;
  c[key] += chars;
}

export function addStreamPerfMillis(key: "settleDurationMs", ms: number): void {
  const c = counters();
  if (!c) return;
  c[key] += ms;
}

export function bumpStreamPerfKeyed(key: "worklogRendersByPhase" | "toolRowRenders", id: string): void {
  const c = counters();
  if (!c) return;
  const bucket = c[key] as Record<string, number>;
  bucket[id] = (bucket[id] ?? 0) + 1;
}
