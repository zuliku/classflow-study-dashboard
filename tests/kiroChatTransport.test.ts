import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Kiro Chat transport — Task 16D Phase 17/18/19", () => {
  it("hooks/useKiroChat.ts uses DefaultChatTransport with apiUrl (injected via webRequest)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "hooks/useKiroChat.ts"), "utf8");
    expect(src).toContain("DefaultChatTransport");
    expect(src).toContain('api: apiUrl("/api/ai/chat")');
    // Must not directly use requestDesktopApi for streaming (that would be DTO, not streaming)
    expect(src).not.toContain('requestDesktopApi("/api/ai/chat")');
    // Must import apiUrl
    expect(src).toContain('import { apiUrl }');
  });

  it("webRequest injection preserves ReadableStream/AbortSignal for continuation and Stop", () => {
    const mainSrc = fs.readFileSync(path.join(process.cwd(), "src/main/index.ts"), "utf8");
    // Injection only adds header, does not consume body or signal
    expect(mainSrc).toContain("x-classflow-capability");
    expect(mainSrc).not.toContain("ReadableStream");
    expect(mainSrc).not.toContain("AbortSignal");
    // Kiro chat must support tool continuation and Stop (via useChat + chat.stop)
    const chatSrc = fs.readFileSync(path.join(process.cwd(), "hooks/useKiroChat.ts"), "utf8");
    expect(chatSrc).toContain("DefaultChatTransport");
    expect(chatSrc).toContain("apiUrl(\"/api/ai/chat\")");
    expect(chatSrc).toContain("experimental_throttle");
    expect(chatSrc).toContain("chat.stop");
  });
});
