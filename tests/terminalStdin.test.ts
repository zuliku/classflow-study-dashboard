import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTerminalProcess, TerminalRuntimeHandle } from "@/src/main/terminalRuntime";
import { DesktopTerminalEvent } from "@/lib/desktop/types";
import { isSensitiveTerminalInput } from "@/lib/ai/computer/terminal/executor";

/**
 * Phase 3 — stdin Interaction（真实 Windows PowerShell pipe stdin）。
 * 白名单命令（任务 §10/§21）：[Console]::In.ReadLine()；不联网 / 安装 / 删除。
 */

function scratchCwd(): string {
  return mkdtempSync(join(tmpdir(), "classflow-term-stdin-"));
}

describe("Phase 3 — stdin round-trip（真实）", () => {
  it("ReadLine → write hello → stdout 出现 received:hello → 正常 exit", async () => {
    const events: DesktopTerminalEvent[] = [];
    let handle: TerminalRuntimeHandle | null = null;
    const { promise, handle: h } = runTerminalProcess({
      executionId: `term-stdin-${Date.now()}`,
      shell: "powershell",
      cwd: scratchCwd(),
      command: '$x = [Console]::In.ReadLine(); Write-Output "received:$x"',
      timeoutMs: 15_000,
      onEvent: (e) => events.push(e),
    });
    handle = h;

    // 进程启动后（未 exit）写入
    await new Promise((r) => setTimeout(r, 500));
    expect(handle).not.toBeNull();
    const writeResult = await handle!.write("hello\n");
    expect(writeResult).toBeUndefined();

    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("received:hello");
    const totalStdout = events
      .filter((e) => e.type === "stdout")
      .map((e) => (e.type === "stdout" ? e.text : ""))
      .join("");
    expect(totalStdout).toContain("received:hello");
  });

  it("exit 后再次 write 被拒绝（reject INVALID_OPERATION）", async () => {
    const { promise, handle } = runTerminalProcess({
      executionId: `term-stdin-x-${Date.now()}`,
      shell: "powershell",
      cwd: scratchCwd(),
      command: 'Write-Output "done"',
      timeoutMs: 10_000,
      onEvent: () => {},
    });
    await promise; // 已 exit
    await expect(handle.write("late\n")).rejects.toMatchObject({ code: "INVALID_OPERATION" });
  });

  it("size bound：>4096 字符写入被拒绝", async () => {
    const { promise, handle } = runTerminalProcess({
      executionId: `term-stdin-size-${Date.now()}`,
      shell: "powershell",
      cwd: scratchCwd(),
      command: 'Start-Sleep -Seconds 3',
      timeoutMs: 10_000,
      onEvent: () => {},
    });
    await expect(handle.write("x".repeat(5000))).rejects.toMatchObject({ code: "INVALID_OPERATION" });
    handle.cancel().catch(() => {});
    await promise.catch(() => {});
  });
});

describe("Phase 3 — 敏感输入边界", () => {
  it("非敏感输入允许（y/n/数字/短文本）", () => {
    expect(isSensitiveTerminalInput("y")).toBe(false);
    expect(isSensitiveTerminalInput("n\n")).toBe(false);
    expect(isSensitiveTerminalInput("1")).toBe(false);
    expect(isSensitiveTerminalInput("hello")).toBe(false);
    expect(isSensitiveTerminalInput("project-name")).toBe(false);
  });

  it("敏感形状被拒绝（sk- / token= / password / API_KEY / Bearer）", () => {
    expect(isSensitiveTerminalInput("sk-fake-secret-1234567890")).toBe(true);
    expect(isSensitiveTerminalInput("password=supersecret")).toBe(true);
    expect(isSensitiveTerminalInput("OPENCODE_GO_TEST_API_KEY=fake-key-12345678")).toBe(true);
    expect(isSensitiveTerminalInput("Bearer abcdefghijklmnopqrstuvwxyz012345")).toBe(true);
    expect(isSensitiveTerminalInput("token=abcdef1234567890abcdef1234567890")).toBe(true);
  });
});
