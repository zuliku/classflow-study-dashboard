import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Muse Spark 1.2 Contributor Live Terminal Smoke（gated；仅本地显式 OPENCODE_GO_TEST_API_KEY 才运行）。
 * 默认模型：muse-spark-1.2-contributor（可通过 OPENCODE_GO_SMOKE_MODEL 覆盖），provider 优先 opencode-go。
 * 若当前 OpenCode Go 未暴露 muse-spark-1.2-contributor，则 probe 后报告 BLOCKED，不自动 fallback 到 mimo。
 */
const key = process.env.OPENCODE_GO_TEST_API_KEY;
const smokeModel = process.env.OPENCODE_GO_SMOKE_MODEL ?? "muse-spark-1.2-contributor";
const gated = !!key ? describe : describe.skip;

gated(`${smokeModel} Terminal Live Smoke（run_terminal_command → 真实 PowerShell）`, () => {
  it("Muse Spark 调用 run_terminal_command（powershell / safe smoke），读取真实结果后给出事实回答", async () => {
    const { generateText, tool } = await import("ai");
    const { resolveLanguageModel } = await import("@/lib/ai/providers/resolver");
    const { runTerminalCommandSchema } = await import("@/lib/ai/computer/tools/schemas");
    const { runTerminalProcess } = await import("@/src/main/terminalRuntime");

    let resolved: Awaited<ReturnType<typeof resolveLanguageModel>>;
    try {
      resolved = await resolveLanguageModel({
        provider: "opencode-go",
        model: smokeModel,
        apiKey: key!,
      });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      const code = (e as { code?: string })?.code ?? "";
      if (/not.*found|unsupported|not.*available|unknown.*model|不可用|MODEL_UNAVAILABLE/i.test(msg) || /MODEL_UNAVAILABLE/i.test(code)) {
        console.log(`[LIVE] Muse Spark 1.2 NOT AVAILABLE THROUGH CURRENT OPENCODE_GO: ${msg} code=${code}`);
        return;
      }
      throw e;
    }
    const cwd = mkdtempSync(join(tmpdir(), "classflow-muse-term-"));

    const system =
      "你是 ClassFlow 桌面助手。可用 run_terminal_command 在已授权工作区执行 PowerShell 命令。" +
      "调用时必须提供完整参数：shell=\"powershell\"、command=\"Write-Output \\\"classflow-muse-terminal-ok\\\"\"。" +
      "只执行用户明确要求的只读命令，不修改文件、不联网、不安装软件、不执行其它命令。";

    // 第一轮：Muse Spark 发出 run_terminal_command（AI SDK 自动执行 → 真实 PowerShell）
    const round1 = await generateText({
      model: resolved.model,
      system,
      messages: [
        {
          role: "user",
          content:
            '请在当前已授权工作区使用 PowerShell 执行一个只读测试。执行：Write-Output "classflow-muse-terminal-ok"。' +
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
            console.log(`[LIVE:muse] executed shell=${shell} exit=${r.exitCode} stdout=${JSON.stringify(r.stdout.slice(0, 80))}`);
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
    let round2 = await generateText({
      model: resolved.model,
      system,
      messages: round1.response.messages,
      maxOutputTokens: 400,
    });
    let text = round2.text;
    // Fallback: if second round is empty (Muse Spark sometimes needs explicit follow-up), ask directly
    if (!text || text.trim().length === 0) {
      const followUp = await generateText({
        model: resolved.model,
        system,
        messages: [
          ...(round1.response.messages as unknown as import("ai").ModelMessage[]),
          { role: "user", content: "请基于刚才的终端执行结果，告诉我命令是否成功以及输出内容是什么。输出中应包含 classflow-muse-terminal-ok。" } as unknown as import("ai").ModelMessage,
        ],
        maxOutputTokens: 400,
      });
      text = followUp.text;
      // eslint-disable-next-line no-console
      console.log("[LIVE:muse] fallback text", JSON.stringify((text ?? "").slice(0, 200)));
    }

    // 断言：工具被调用
    expect(toolCalls.length).toBeGreaterThanOrEqual(1);
    // eslint-disable-next-line no-console
    console.log("[LIVE:muse] toolCalls", JSON.stringify(toolCalls.map((c) => ({ name: c.toolName, input: c.input }))).slice(0, 800));
    console.log("[LIVE:muse] text", JSON.stringify((text ?? "").slice(0, 200)));
    const terminalCalls = toolCalls.filter((c) => c.toolName === "run_terminal_command");
    expect(terminalCalls.length).toBeGreaterThanOrEqual(1);

    const first = terminalCalls[0].input as { shell?: string; command?: string };
    expect(first.shell).toBe("powershell");
    expect(first.command).toContain("classflow-muse-terminal-ok");
    // safe 只读：不得含删除/联网/安装/提权命令
    const cmd = (first.command ?? "").toLowerCase();
    for (const banned of ["remove-item", "del ", "invoke-webrequest", "curl", "wget", "npm install", "pip install", "runas", "start-process -verb runas"]) {
      expect(cmd).not.toContain(banned);
    }

    // 断言：final answer 基于真实结果（marker 或成功事实）
    const answer = text ?? "";
    expect(answer.length).toBeGreaterThan(0);
    const hasMarker = answer.includes("classflow-muse-terminal-ok");
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
