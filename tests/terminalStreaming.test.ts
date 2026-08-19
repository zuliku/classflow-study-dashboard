import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTerminalProcess, TerminalRuntimeResult } from "@/src/main/terminalRuntime";
import { DesktopTerminalEvent } from "@/lib/desktop/types";

/**
 * Phase 1 — 真实 Windows PowerShell Streaming smoke + 契约测试。
 * 白名单命令（见任务 §21）：Write-Output / Start-Sleep 循环；绝不联网 / 安装 / 删除。
 */

function scratchCwd(): string {
  return mkdtempSync(join(tmpdir(), "classflow-term-"));
}

/** 收集一次执行的完整事件流（resolve 时事件流已闭合并可断言） */
function collectEvents(command: string, timeoutMs = 30_000): Promise<{ events: DesktopTerminalEvent[]; result: TerminalRuntimeResult }> {
  return new Promise((resolve, reject) => {
    const events: DesktopTerminalEvent[] = [];
    const { promise, handle } = runTerminalProcess({
      executionId: `term-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      shell: "powershell",
      cwd: scratchCwd(),
      command,
      timeoutMs,
      onEvent: (e) => events.push(e),
    });
    promise.then(
      (result) => resolve({ events, result }),
      (err) => reject(err)
    );
    void handle;
  });
}

describe("Phase 1 — 真实 PowerShell streaming", () => {
  it("exit 前观察到 >= 2 次 stdout chunk（不是最终一次性 stdout）", async () => {
    let stdoutEvents = 0;
    let sawBeforeExit = false;
    const events: DesktopTerminalEvent[] = [];
    const { promise } = runTerminalProcess({
      executionId: `term-stream-${Date.now()}`,
      shell: "powershell",
      cwd: scratchCwd(),
      command: "1..3 | ForEach-Object { Write-Output \"classflow-stream-$_\"; Start-Sleep -Milliseconds 150 }",
      timeoutMs: 30_000,
      onEvent: (e) => {
        events.push(e);
        if (e.type === "stdout") stdoutEvents += 1;
        if (e.type === "exit" && stdoutEvents >= 2) sawBeforeExit = true;
      },
    });
    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(stdoutEvents).toBeGreaterThanOrEqual(2);
    expect(sawBeforeExit).toBe(true); // 验收：exit 之前已收到 >= 2 次 chunk
    // 最终 aggregate 与 chunks 一致（三行都在）
    for (let i = 1; i <= 3; i++) {
      expect(result.stdout).toContain(`classflow-stream-${i}`);
    }
    const totalText = events.filter((e) => e.type === "stdout").map((e) => (e.type === "stdout" ? e.text : "")).join("");
    expect(totalText).toContain("classflow-stream-1");
    expect(totalText).toContain("classflow-stream-3");
  });

  it("seq 单调递增（同 execution 内）", async () => {
    const { events } = await collectEvents('Write-Output "seq-test-1"\nStart-Sleep -Milliseconds 100\nWrite-Output "seq-test-2"');
    const seqs = events.map((e) => e.sequence);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
    expect(seqs[0]).toBe(1); // started = sequence 1
  });

  it("stderr 事件有序且不丢失", async () => {
    const { events } = await collectEvents('Write-Error "boom-stream-1"\nStart-Sleep -Milliseconds 100\nWrite-Error "boom-stream-2"');
    const stderr = events.filter((e) => e.type === "stderr").map((e) => (e.type === "stderr" ? e.text : ""));
    expect(stderr.length).toBeGreaterThanOrEqual(2);
    expect(stderr.join("")).toContain("boom-stream-1");
    expect(stderr.join("")).toContain("boom-stream-2");
  });

  it("bounded：>512KB 单 chunk 输出 → truncated 标志", async () => {
    const { result } = await collectEvents('Write-Output ("x" * 600000)');
    expect(result.exitCode).toBe(0);
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stdout.length).toBeLessThan(512 * 1024);
  }, 60_000);
});

describe("Phase 1 — 事件 sanitization（真实输出）", () => {
  it("secret 输出在事件中被 redacted（假 secret；绝不硬编码真实 key）", async () => {
    const { events, result } = await collectEvents('Write-Output "sk-fake-secret-1234567890"');
    const totalText = events.filter((e) => e.type === "stdout").map((e) => (e.type === "stdout" ? e.text : "")).join("");
    expect(totalText).toContain("[REDACTED_SECRET]");
    expect(totalText).not.toContain("sk-fake-secret-1234567890");
    // 最终 aggregate（回模型的 Tool Result）保持原始 bounded 输出（Web 层另有 strip/bound）
    expect(result.stdout).toContain("sk-fake-secret-1234567890");
  });

  it("绝对路径在事件中被 redacted", async () => {
    const { events } = await collectEvents('Write-Output "C:\\\\Users\\\\alice\\\\secret\\\\file.txt"');
    const totalText = events.filter((e) => e.type === "stdout").map((e) => (e.type === "stdout" ? e.text : "")).join("");
    expect(totalText).not.toContain("C:\\Users\\alice");
  });

  it("started/exit 事件不含 pid / native path / username", async () => {
    const { events } = await collectEvents('Write-Output "ok"');
    for (const e of events) {
      const serialized = JSON.stringify(e);
      expect(serialized).not.toMatch(/pid|username|C:\\\\|local\\user/i);
    }
  });
});
