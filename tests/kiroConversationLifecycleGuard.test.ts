// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Kiro 会话生命周期防护（稳定性审计回归，源码契约锁）：
 *
 * BUG-019 复活 bug：删除当前对话 / 清空历史后，迟到的持久化（300ms debounce timer、
 * flushSave）会把已删除的会话原样写回 IndexedDB —— 「删除」后线程重新出现。
 * 修复契约：tombstone 集合（deletedConversationIdsRef）；persistCurrent 对其中 id
 * 一律拒绝落盘；删除当前/清空历史经统一 transition lifecycle（不再直连 newChat()）。
 *
 * BUG-020 切换窗口绕过 Stop：transition gate 只看 streaming，awaiting-tool-result
 * 窗口（status=ready、审批等待）内切换不触发 stop() —— 迟到工具输出/审计落到新会话。
 * 修复契约：gate 与等待 effect 使用完整 turnInFlight。
 */
const src = readFileSync(join(process.cwd(), "components/kiro/KiroSessionProvider.tsx"), "utf-8");

describe("kiro conversation lifecycle guards", () => {
  it("persistCurrent 拒绝 tombstone 会话落盘（防复活）", () => {
    const fn = src.match(/const persistCurrent = useCallback\([\s\S]*?\}, \[\]\)/);
    expect(fn).toBeTruthy();
    const body = fn![0];
    expect(body).toContain("deletedConversationIdsRef.current.has(id)");
    // tombstone 检查必须在 saveConversation 之前
    expect(body.indexOf("deletedConversationIdsRef.current.has(id)")).toBeLessThan(
      body.indexOf("saveConversation(record)")
    );
    expect(src).toContain("deletedConversationIdsRef = useRef<Set<string>>");
  });

  it("删除当前会话：先 tombstone 再经统一 transition（不再直连 newChat 绕过 stop→save→switch）", () => {
    const fn = src.match(/const deleteConversation = useCallback\([\s\S]*?\},\s*\[requestConversationTransition, refreshHistory\]\s*\);/);
    expect(fn).toBeTruthy();
    const body = fn![0];
    expect(body).toContain("deleteConversationRecord(id)");
    expect(body).toContain("deletedConversationIdsRef.current.add(id)");
    expect(body).toContain('requestConversationTransition({ type: "new"');
    // 直连绕行必须消失（注释提及不算语句）
    expect(body).not.toMatch(/(?<!直接 )newChat\(\);/);
  });

  it("清空历史：当前会话同样 tombstone 并经 transition 切换（防清空后复活单线程）", () => {
    const fn = src.match(/const clearHistory = useCallback\([\s\S]*?\},\s*\[newChat, requestConversationTransition\]\s*\);/);
    expect(fn).toBeTruthy();
    const body = fn![0];
    expect(body).toContain("clearConversationHistory()");
    expect(body).toContain("deletedConversationIdsRef.current.add(current)");
    expect(body).toContain('requestConversationTransition({ type: "new"');
  });

  it("transition gate 使用 turnInFlight（覆盖 awaiting-tool-result 窗口），迟到回填被既有 Stop 守卫丢弃", () => {
    const req = src.match(/const requestConversationTransition = useCallback\([\s\S]*?\},\s*\[applyTransition, finishConversationTransition\]\s*\);/);
    expect(req).toBeTruthy();
    expect(req![0]).toContain("chatRef.current.turnInFlight");
    expect(req![0]).not.toMatch(/streaming:\s*chatRef\.current\.streaming/);
    // 等待 effect 也以 turnInFlight 为准
    const waitEffect = src.match(/React\.useEffect\(\(\) => \{[\s\S]{0,120}?if \(chat\.turnInFlight\) return;[\s\S]{0,80}?const pending = transitionStateRef\.current\.pending;/);
    expect(waitEffect).toBeTruthy();
  });
});
