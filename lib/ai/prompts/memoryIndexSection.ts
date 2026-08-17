/**
 * 「# 用户长期学习记忆（Index）」Prompt section（纯 helper）。
 * Production Route 与 Text Eval 共用同一实现，避免 Benchmark 随生产格式变化漂移。
 * 只负责这一个稳定 section；不重构完整 Prompt assembly。
 */
export interface KiroMemoryIndexEntryLike {
  title?: string;
  category?: string;
  scope?: string;
  scopeId?: string;
}

export function buildKiroMemoryIndexSection(memoryIndex: ReadonlyArray<KiroMemoryIndexEntryLike>): string {
  if (memoryIndex.length === 0) return "";
  return (
    `\n\n# 用户长期学习记忆（Index；不代表当前 ClassFlow 业务状态）\n${memoryIndex
      .map((m, i) => `- ${i + 1}. ${m.title ?? "未命名"}（${m.category ?? ""} · ${m.scope ?? "global"}${m.scopeId ? " · " + m.scopeId : ""}）`)
      .join("\n")}\n需要完整内容时调用 search_memories。`
  );
}
