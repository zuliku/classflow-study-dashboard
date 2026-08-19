import { describe, it, expect } from "vitest";
import {
  stripAnsi,
  redactAbsolutePaths,
  redactTerminalSecrets,
  sanitizeTerminalChunk,
  sanitizeTerminalModelOutput,
  redactCommandPreview,
  REDACTED_PATH_MARK,
  REDACTED_SECRET_MARK,
} from "@/lib/ai/computer/terminal/redact";

/**
 * Phase 1 — chunk sanitization / redaction 纯函数测试。
 * 只用假 secret（sk-fake-…）；绝不硬编码真实 API key。
 */

describe("stripAnsi", () => {
  it("剥离 CSI 着色序列", () => {
    expect(stripAnsi("\u001b[32mgreen\u001b[0m")).toBe("green");
  });
  it("剥离 OSC（如 8-bit title）与 ESC 单字符序列", () => {
    expect(stripAnsi("\u001b]0;title\u0007text")).toBe("text");
    expect(stripAnsi("\u001b(Btext")).toBe("text");
  });
});

describe("redactAbsolutePaths", () => {
  it("Windows 绝对路径 → [REDACTED_PATH]", () => {
    expect(redactAbsolutePaths("file at C:\\Users\\alice\\secret\\x.txt now")).toBe(`file at ${REDACTED_PATH_MARK} now`);
  });
  it("UNC 路径 → [REDACTED_PATH]", () => {
    expect(redactAbsolutePaths("\\\\server\\share\\dir\\f.txt")).toContain(REDACTED_PATH_MARK);
  });
  it("普通相对路径 / 单词不被误伤", () => {
    expect(redactAbsolutePaths("src/components/KiroTerminalBlock.tsx")).toBe("src/components/KiroTerminalBlock.tsx");
    expect(redactAbsolutePaths("hello world")).toBe("hello world");
  });
});

describe("redactTerminalSecrets", () => {
  const sk = "sk-fake-secret-abcdef1234567890";
  it("sk- 前缀 provider key", () => {
    expect(redactTerminalSecrets(`key=${sk}`)).toContain(REDACTED_SECRET_MARK);
    expect(redactTerminalSecrets(`key=${sk}`)).not.toContain(sk);
  });
  it("Bearer token", () => {
    const t = "Bearer abcdefghijklmnopqrstuvwxyz012345";
    const out = redactTerminalSecrets(`auth ${t}`);
    expect(out).toContain(REDACTED_SECRET_MARK);
    expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz012345");
  });
  it("Authorization header", () => {
    const out = redactTerminalSecrets("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123");
    expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz0123");
  });
  it("KEY=value 赋值（api_key / token / password）", () => {
    expect(redactTerminalSecrets("OPENCODE_GO_TEST_API_KEY=fake-key-12345678")).not.toContain("fake-key-12345678");
    expect(redactTerminalSecrets("api_key=fake-key-12345678")).not.toContain("fake-key-12345678");
    expect(redactTerminalSecrets("password=hunter2hunter2hunter2")).not.toContain("hunter2hunter2hunter2");
    expect(redactTerminalSecrets("token=abcdef1234567890abcdef1234567890")).not.toContain("abcdef1234567890abcdef1234567890");
  });
  it("长随机串（>=40 字符）", () => {
    const long = "qwertyuiopasdfghjklzxcvbnm1234567890QWERTYUIOP";
    expect(redactTerminalSecrets(long)).toContain(REDACTED_SECRET_MARK);
  });
  it("普通文本不误伤", () => {
    expect(redactTerminalSecrets("npm test passed, 42 tests")).toBe("npm test passed, 42 tests");
    expect(redactTerminalSecrets("classflow-stream-1")).toBe("classflow-stream-1");
  });
});

describe("sanitizeTerminalChunk", () => {
  it("ANSI + path + secret 组合", () => {
    const out = sanitizeTerminalChunk(
      "\u001b[31merror: token=sk-fake-secret-1234567890 at C:\\Users\\alice\\x.txt\u001b[0m"
    );
    expect(out).not.toContain("sk-fake-secret-1234567890");
    expect(out).not.toContain("C:\\Users\\alice");
    expect(out).not.toContain("\u001b");
  });
  it("char bound", () => {
    const out = sanitizeTerminalChunk(".".repeat(20_000), 100);
    expect(out.length).toBe(100);
  });
});

describe("redactCommandPreview", () => {
  it("命令中的 secret 被 redacted", () => {
    const out = redactCommandPreview('Write-Output "sk-fake-secret-1234567890"');
    expect(out).not.toContain("sk-fake-secret-1234567890");
  });
  it("折叠空白 + 500 上限", () => {
    const out = redactCommandPreview("echo   a   b\nc".padEnd(900, "x"));
    expect(out.length).toBeLessThanOrEqual(500);
    expect(redactCommandPreview("echo   a   b\nc")).toContain("echo a b c");
  });
});

describe("sanitizeTerminalModelOutput", () => {
  it("最终模型输出：ANSI → path → secret → bound 同规则", () => {
    const { text } = sanitizeTerminalModelOutput(
      "\u001b[31merror at C:\\Users\\alice\\x.txt token=sk-fake-secret-1234567890\u001b[0m",
      1000
    );
    expect(text).not.toContain("sk-fake-secret-1234567890");
    expect(text).not.toContain("C:\\Users\\alice");
    expect(text).not.toContain("\u001b");
    expect(text).toContain("[REDACTED_SECRET]");
  });
  it("与 streaming 同规则（sanitizeTerminalChunk 等价）", () => {
    const raw = "OPENCODE_GO_TEST_API_KEY=fake-secret-value-for-test-12345678 at C:\\Users\\alice\\f.txt";
    const chunk = sanitizeTerminalChunk(raw, 1000);
    const { text } = sanitizeTerminalModelOutput(raw, 1000);
    expect(chunk).toBe(text);
  });
});
