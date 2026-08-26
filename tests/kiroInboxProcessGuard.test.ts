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
 * 修复契约：handler 在 beginRemoteInbox 之后（await 回来后读 live status），
 * 若 chat 仍处于 streaming/submitted，则 toast 提示并放弃本次发送。
 */
const src = readFileSync(join(process.cwd(), "hooks/useKiroChat.ts"), "utf-8");

describe("inbox process → parallel stream guard", () => {
  it("inbox:process handler 在 await 后检查 live streaming/submitted 状态", () => {
    const handler = src.match(/const handler = async \(e: Event\)[\s\S]*?window\.addEventListener\("classflow:inbox:process"/);
    expect(handler).toBeTruthy();
    const body = handler![0];
    expect(body).toContain("classflow:inbox:process");
    // 必须先 beginRemoteInbox（invocation 契约不变）
    expect(body).toContain("beginRemoteInbox");
    // live status 检查必须存在，且位于 sendMessage 之前
    const guardIdx = body.indexOf('liveStatus === "streaming" || liveStatus === "submitted"');
    const sendIdx = body.indexOf("sendMessage({ text })");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(sendIdx).toBeGreaterThan(guardIdx);
    // 放弃发送时必须有用户可见反馈（不能静默丢弃）
    expect(body.slice(guardIdx, sendIdx)).toContain("pushToast");
    // 读取 live ref 而非闭包 stale status
    expect(body).toContain("latestChatRef.current");
  });
});
