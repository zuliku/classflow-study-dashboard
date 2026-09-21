// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Stop 后迟到工具结果防护（稳定性审计回归）：
 *
 * 症状：Kiro 执行 client 工具（read_material / read_project_file / vision 等）期间按「停止」，
 * 工具 Promise 稍后 resolve → emitToolOutput → chat.addToolOutput → SDK 的
 * sendAutomaticallyWhen 看到 pending tool 变为 output-available，发起全新 provider 请求
 * —— 用户感知为「停止后继续跑、token 继续烧」。
 *
 * 修复契约：emitToolOutput 在 stoppedTurnMessageIdRef 非 null（用户已 Stop 本 turn）
 * 时直接丢弃回填；ref 由 handleStop 设置、下一次 send 重置。
 *
 * 注：useKiroChat 依赖完整 Kiro Session/Provider 环境，jsdom 下无法构造真实 hook
 * harness（仓库现状无对应测试基建），故本回归以源码契约锁实现结构；
 * 运行时行为由 Manual QA（Stop during tool execution）覆盖。
 */
const src = readFileSync(join(process.cwd(), "hooks/useKiroChat.ts"), "utf-8");

describe("stop → late tool output guard", () => {
  it("emitToolOutput 在 stopped turn 时先于 addToolOutput 直接返回", () => {
    const fn = src.match(/const emitToolOutput = useCallback\([\s\S]*?\}\,\s*\[chat\]\s*\)\;/);
    expect(fn).toBeTruthy();
    const body = fn![0];
    const dropIdx = body.indexOf("stoppedTurnMessageIdRef.current !== null");
    const addIdx = body.indexOf("chat.addToolOutput");
    expect(dropIdx).toBeGreaterThan(-1);
    expect(addIdx).toBeGreaterThan(dropIdx);
    // 早退 return 必须出现在 addToolOutput 之前
    expect(body.slice(0, addIdx)).toMatch(/return;\s*\n\s*\/\/ V4\.6|if \(stoppedTurnMessageIdRef\.current !== null\) \{\s*\n\s*return;/);
  });

  it("handleStop 负责置位 stopped ref；send/reset 路径负责清位", () => {
    const stopFn = src.match(/const handleStop = useCallback\([\s\S]*?\}, \[[^\]]*\]\);/);
    expect(stopFn).toBeTruthy();
    expect(stopFn![0]).toContain("stoppedTurnMessageIdRef.current =");
    // 至少存在多处 reset-to-null（新会话 / 新 send / conversation switch）
    expect(src.match(/stoppedTurnMessageIdRef\.current = null;/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("fire-and-forget 工具执行器统一经 emitToolOutput 回填（守卫单点生效）", () => {
    // 异步只读执行器的完成路径都必须走 emitToolOutput 单点，
    // 保证 stop 守卫覆盖全部迟到回填入口
    expect(src).toMatch(/void executeReadMaterial\(input[\s\S]{0,600}emitToolOutput\(/);
    expect(src).toMatch(/void executeReadProjectFile\(input[\s\S]{0,600}emitToolOutput\(/);
    expect(src).toMatch(/void executeSearchProjectFile\(input[\s\S]{0,600}emitToolOutput\(/);
    expect((src.match(/emitToolOutput\(/g) ?? []).length).toBeGreaterThanOrEqual(10);
  });
});
