import { describe, it, expect } from "vitest";
import {
  MINI_CHAT_PROTOCOL_VERSION,
  MINI_MAX_FILES,
  MINI_MAX_MESSAGES,
  MINI_MAX_TEXT_CHARS,
  MINI_MAX_TEXT_PER_MESSAGE,
  base64ToBytes,
  buildMiniSnapshot,
  bytesToBase64,
  isMiniModeSearch,
  sanitizeMiniSend,
} from "@/lib/ai/miniChat/protocol";

function filePayload(name: string, size: number, dataBase64: string) {
  return { name, type: "text/plain", size, dataBase64 };
}

describe("isMiniModeSearch（?mini=1 分支）", () => {
  it("含 mini 参数 → true；其余 → false", () => {
    expect(isMiniModeSearch("?mini=1")).toBe(true);
    expect(isMiniModeSearch("?mini=1&foo=bar")).toBe(true);
    expect(isMiniModeSearch("")).toBe(false);
    expect(isMiniModeSearch("?foo=bar")).toBe(false);
  });
});

describe("buildMiniSnapshot（只读快照裁剪）", () => {
  it("只保留 user/assistant；超长截断；只取尾部 N 条", () => {
    const messages = [
      { id: "m1", role: "system", content: "sys" },
      { id: "m2", role: "user", content: "hi" },
      { id: "m3", role: "assistant", content: "x".repeat(MINI_MAX_TEXT_PER_MESSAGE + 10) },
    ];
    const snap = buildMiniSnapshot({
      conversationId: "c1",
      messages,
      busy: true,
      streaming: true,
      attachments: [{ id: "a1", name: "n.md", status: "ready" }],
      configured: true,
      now: 123,
    });
    expect(snap.version).toBe(MINI_CHAT_PROTOCOL_VERSION);
    expect(snap.messages.map((m) => m.id)).toEqual(["m2", "m3"]);
    expect(snap.messages[1].text.endsWith("（已截断）")).toBe(true);
    expect(snap.busy).toBe(true);
    expect(snap.updatedAt).toBe(123);
  });

  it("超过上限只取尾部", () => {
    const messages = Array.from({ length: MINI_MAX_MESSAGES + 10 }, (_, i) => ({
      id: `m${i}`,
      role: "user",
      content: `t${i}`,
    }));
    const snap = buildMiniSnapshot({
      conversationId: null,
      messages,
      busy: false,
      streaming: false,
      attachments: [],
      configured: false,
    });
    expect(snap.messages).toHaveLength(MINI_MAX_MESSAGES);
    expect(snap.messages[0].id).toBe(`m10`);
    // structured-clone 安全：纯 plain 数据
    expect(() => structuredClone(snap)).not.toThrow();
  });
});

describe("sanitizeMiniSend（执行前最后一道门）", () => {
  const tiny = bytesToBase64(new TextEncoder().encode("hello"));

  it("空输入拒绝", () => {
    expect(sanitizeMiniSend({ text: "   ", files: [] }).ok).toBe(false);
    expect(sanitizeMiniSend({ text: "", files: "nope" }).ok).toBe(false);
  });

  it("超长文本拒绝", () => {
    const r = sanitizeMiniSend({ text: "x".repeat(MINI_MAX_TEXT_CHARS + 1), files: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("TEXT_TOO_LONG");
  });

  it("合法文件通过；超量/超大/非法 base64 具名丢弃", () => {
    const good = filePayload("a.txt", 5, tiny);
    const big = filePayload("big.bin", 21 * 1024 * 1024, tiny);
    const bad = filePayload("bad.txt", 5, "!!!not-base64!!!");
    const r = sanitizeMiniSend({ text: "hi", files: [good, big, bad] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.files.map((f) => f.name)).toEqual(["a.txt"]);
      expect(r.value.droppedFiles).toEqual(["big.bin", "bad.txt"]);
    }
  });

  it("文件数上限：超量按序丢弃", () => {
    const files = Array.from({ length: MINI_MAX_FILES + 2 }, (_, i) => filePayload(`f${i}.txt`, 5, tiny));
    const r = sanitizeMiniSend({ text: "", files });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.files).toHaveLength(MINI_MAX_FILES);
      expect(r.value.droppedFiles).toEqual([`f${MINI_MAX_FILES}.txt`, `f${MINI_MAX_FILES + 1}.txt`]);
    }
  });

  it("size 自述与载荷严重不符 → 丢弃", () => {
    const r = sanitizeMiniSend({ text: "hi", files: [filePayload("fake.txt", 100000, tiny)] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.files).toHaveLength(0);
      expect(r.value.droppedFiles).toEqual(["fake.txt"]);
    }
  });
});

describe("base64 编解码往返", () => {
  it("bytes ⇄ base64 无损", () => {
    const raw = new Uint8Array([0, 1, 2, 250, 255, 72, 101, 108, 108, 111]);
    expect(base64ToBytes(bytesToBase64(raw))).toEqual(raw);
  });
});
