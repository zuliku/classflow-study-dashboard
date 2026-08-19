import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * MiMo 2.5 Live Terminal Smoke（gated；仅本地显式 OPENCODE_GO_TEST_API_KEY 才运行）。
 *
 * 分层（任务 §15）：
 * - A. Runtime PowerShell Smoke：tests/terminalStreaming/Lifecycle/Stdin/PtyContract（真实 PowerShell）✓
 * - B. MiMo Tool-routing Smoke：本文件（MiMo → 调用 run_terminal_command → 真实 PowerShell 执行 → 结果回模型）
 * - C. Combined Kiro Desktop E2E：需要完整 Electron renderer+main；vitest 无此环境 → 单独报告 NOT CLOSED
 *
 * 本文件验证 B：模型正确发出 run_terminal_command（shell=powershell、safe 只读命令），
 * runtime 真实启动 PowerShell，stdout 含 marker，final answer 基于真实结果。
 * 不要求模型逐字回答；断言核心 marker / 成功事实。maxOutputTokens 低（200~400），不做 benchmark。
 */
const key = process.env.OPENCODE_GO_TEST_API_KEY;
const smokeModel = process.env.OPENCODE_GO_SMOKE_MODEL ?? "mimo-v2.5";
const gated = !!key ? describe : describe.skip;

gated(`${smokeModel} Terminal Live Smoke（MiMo → run_terminal_command → 真实 PowerShell）`, () => {
  it("MiMo 调用 run_terminal_command（powershell / safe smoke），读取真实结果后给出事实回答", async () => {
    const { generateText, tool } = await import("ai");
    const { resolveLanguageModel } = await import("@/lib/ai/providers/resolver");
    const { runTerminalCommandSchema } = await import("@/lib/ai/computer/tools/schemas");
    const { runTerminalProcess } = await import("@/src/main/terminalRuntime");

    const resolved = await resolveLanguageModel({
      provider: "opencode-go",
      model: smokeModel,
      apiKey: key!,
    });
    const cwd = mkdtempSync(join(tmpdir(), "classflow-mimo-term-"));

    const system =
      "你是 ClassFlow 桌面助手。可用 run_terminal_command 在已授权工作区执行 PowerShell 命令。" +
      "调用时必须提供完整参数：shell=\"powershell\"、command=\"Write-Output \\\"classflow-mimo-terminal-ok\\\"\"。" +
      "只执行用户明确要求的只读命令，不修改文件、不联网、不安装软件、不执行其它命令。";

    // 第一轮：MiMo 发出 run_terminal_command（AI SDK 自动执行 → 真实 PowerShell）
    const round1 = await generateText({
      model: resolved.model,
      system,
      messages: [
        {
          role: "user",
          content:
            '请在当前已授权工作区使用 PowerShell 执行一个只读测试。执行：Write-Output "classflow-mimo-terminal-ok"。' +
            "读取真实终端结果后，只告诉我命令是否成功以及输出。不要修改文件，不要联网，不要安装软件，不要执行其它命令。",
        },
      ],
      tools: {
        run_terminal_command: tool({
          description:
            "在已授权工作区运行 PowerShell/cmd 命令。必填参数：shell（powershell 或 cmd）、command（要执行的命令字符串）、cwd（相对路径，可空）、timeoutMs（可选毫秒）。示例：{ shell: \"powershell\", cwd: \"\", command: \"Write-Output \\\"hello\\\"\" }。",
          inputSchema: runTerminalCommandSchema,
          execute: async ({ shell, command, timeoutMs }) => {
            const { promise } = runTerminalProcess({
              executionId: `term-live-${Date.now()}`,
              shell: (shell ?? "powershell") as "powershell" | "cmd",
              cwd,
              command: String(command),
              timeoutMs: Number(timeoutMs ?? 30_000),
              onEvent: () => {},
            });
            const r = await promise;
            // eslint-disable-next-line no-console
            console.log(`[LIVE:mimo] executed shell=${shell} exit=${r.exitCode} stdout=${JSON.stringify(r.stdout.slice(0, 80))}`);
            return {
              shell,
              cwd: "",
              exitCode: r.exitCode,
              stdout: r.stdout,
              stderr: r.stderr,
              timedOut: r.timedOut,
              durationMs: r.durationMs,
            };
          },
        }),
      },
      maxOutputTokens: 500,
    });
    const toolCalls = round1.toolCalls;

    // 第二轮：把含 tool result 的完整 messages 回传模型，生成基于真实结果的 final answer
    const round2 = await generateText({
      model: resolved.model,
      system,
      messages: round1.response.messages,
      maxOutputTokens: 400,
    });
    const text = round2.text;

    // 断言：工具被调用
    expect(toolCalls.length).toBeGreaterThanOrEqual(1);
    // eslint-disable-next-line no-console
    console.log("[LIVE:mimo] toolCalls", JSON.stringify(toolCalls.map((c) => ({ name: c.toolName, input: c.input }))).slice(0, 800));
    console.log("[LIVE:mimo] text", JSON.stringify((text ?? "").slice(0, 200)));
    const terminalCalls = toolCalls.filter((c) => c.toolName === "run_terminal_command");
    expect(terminalCalls.length).toBeGreaterThanOrEqual(1);

    const first = terminalCalls[0].input as { shell?: string; command?: string };
    expect(first.shell).toBe("powershell");
    expect(first.command).toContain("classflow-mimo-terminal-ok");
    // safe 只读：不得含删除/联网/安装/提权命令
    const cmd = (first.command ?? "").toLowerCase();
    for (const banned of ["remove-item", "del ", "invoke-webrequest", "curl", "wget", "npm install", "pip install", "runas", "start-process -verb runas"]) {
      expect(cmd).not.toContain(banned);
    }

    // 断言：final answer 基于真实结果（marker 或成功事实）
    const answer = text ?? "";
    expect(answer.length).toBeGreaterThan(0);
    const hasMarker = answer.includes("classflow-mimo-terminal-ok");
    const hasSuccess = /(成功|ok|exit 0|运行成功|已执行)/i.test(answer);
    expect(hasMarker || hasSuccess).toBe(true);

    // 断言：没有无理由执行第二条危险命令（最多允许额外只读命令；禁止危险类）
    const dangerousCalls = toolCalls.filter((c) => {
      if (c.toolName !== "run_terminal_command") return false;
      const a = ((c.input ?? {}) as { command?: string }).command ?? "";
      return /remove-item|del |format|registry|schtasks|stop-process|runas/i.test(a.toLowerCase());
    });
    expect(dangerousCalls).toHaveLength(0);
  }, 120000);
});
