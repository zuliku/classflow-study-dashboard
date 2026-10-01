// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Inbox「交给 Kiro 处理」并发流防护（稳定性审计回归）：
 *
 * 症状：Kiro 回复仍在 streaming 时，收件箱点击「处理」→ handler 直接 sendMessage。
 * AI SDK 的 sendMessage 不会 abort 已有响应 → 同一 conversation 出现两条并行
 * provider 流（交错写入 + 双倍计费 + 消息顺序错乱）。
 *
 * 修复契约（V2）：handler 在 beginRemoteInbox 之后（await 回来后读 live 状态），
 * 若本轮未 settle（executing / awaiting-tool-result / awaiting-continuation，
 * 后两者 status 已回 ready，仅查 status 会穿透），则 toast 提示并放弃本次发送；
 * 发送必须走 sendWithAttachments 规范入口（直调 sendMessage 会跳过 preflight /
 * intent 冻结 / 附件快照队列，导致后续轮次附件错位）。
 */
const src = readFileSync(join(process.cwd(), "hooks/useKiroChat.ts"), "utf-8");

describe("inbox process → parallel stream guard", () => {
  it("inbox:process handler 在 await 后检查 live 状态（含 turnInFlight）", () => {
    const handler = src.match(/const handler = async \(e: Event\)[\s\S]*?window\.addEventListener\("classflow:inbox:process"/);
    expect(handler).toBeTruthy();
    const body = handler![0];
    expect(body).toContain("classflow:inbox:process");
    // 必须先 beginRemoteInbox（invocation 契约不变）
    expect(body).toContain("beginRemoteInbox");
    // live 状态检查必须存在，且位于规范发送之前（含 awaiting 窗口的 turnInFlight 门）
    const guardIdx = body.indexOf("turnInFlightRef.current");
    const sendIdx = body.indexOf("sendWithAttachmentsRef.current(text, [])");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(sendIdx).toBeGreaterThan(guardIdx);
    // 放弃发送时必须有用户可见反馈（不能静默丢弃）
    expect(body.slice(guardIdx, sendIdx)).toContain("pushToast");
    // 读取 live ref 而非闭包 stale status
    expect(body).toContain("latestChatRef.current");
    // 不得直调裸 sendMessage（绕过规范管线）
    expect(body).not.toContain("sendMessage({ text })");
  });
});
