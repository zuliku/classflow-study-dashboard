import { describe, it, expect } from "vitest";
import { sanitizeIpcErrorMessage, toSanitizedIpcError } from "@/src/main/security/ipcErrors";

describe("sanitizeIpcErrorMessage（路径脱敏不断文案）", () => {
  it("Windows 绝对路径（含用户名）被遮蔽", () => {
    const out = sanitizeIpcErrorMessage("读取失败 C:\\Users\\ye\\skills\\x\\SKILL.md: EACCES");
    expect(out).not.toContain("ye");
    expect(out).toContain("[path]");
    expect(out).toContain("EACCES");
  });

  it("Unix home 用户名被遮蔽", () => {
    expect(sanitizeIpcErrorMessage("open /home/alice/a.txt failed")).toBe("open /home/[redacted]/a.txt failed");
  });

  it("普通校验文案原样保留", () => {
    expect(sanitizeIpcErrorMessage("name and endpoint required")).toBe("name and endpoint required");
  });

  it("超长截断 300", () => {
    expect(sanitizeIpcErrorMessage("x".repeat(400))).toHaveLength(300);
  });
});

describe("toSanitizedIpcError（code 保留 + message 清洗）", () => {
  it("JSON 错误保留 code，message 脱敏", () => {
    try {
      toSanitizedIpcError(new Error(JSON.stringify({ code: "E_FAIL", message: "bad C:\\Users\\ye\\x" })));
      expect.unreachable();
    } catch (err) {
      const direct = JSON.parse((err as Error).message) as { code: string; message: string };
      expect(direct.code).toBe("E_FAIL");
      expect(direct.message).not.toContain("ye");
      expect(direct.message).toContain("[path]");
    }
  });

  it("非 Error 输入 fail closed 为 UNKNOWN", () => {
    try {
      toSanitizedIpcError("boom C:\\temp\\a.txt");
      expect.unreachable();
    } catch (err) {
      const direct = JSON.parse((err as Error).message) as { code: string; message: string };
      expect(direct.code).toBe("UNKNOWN");
      expect(direct.message).toContain("[path]");
    }
  });
});
