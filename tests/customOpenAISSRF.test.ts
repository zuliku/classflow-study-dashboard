import { describe, it, expect } from "vitest";
import { validateCustomBaseURL } from "@/lib/ai/providers/customOpenAI";

/**
 * custom-openai baseURL SSRF 校验边界（稳定性审计 Round3 回归）：
 *
 * BUG-040：IPv4-mapped IPv6（::ffff:127.0.0.1）与十六进制/八进制 IP 变体
 * 绕过旧的点分十进制分类器，被当作「域名」放行 → 可指向 loopback/私网 HTTPS 端点。
 */
describe("validateCustomBaseURL — mapped/hex IP bypass", () => {
  it("mapped IPv6 全形态拒绝（WHATWG URL 将点分形式规范化为 hex；一律 fail-closed）", () => {
    // ::ffff:127.0.0.1 → hostname "::ffff:7f00:1"（hex 化）→ MAPPED_IPV6
    expect(validateCustomBaseURL("https://[::ffff:127.0.0.1]/v1")).toBe("MAPPED_IPV6");
    expect(validateCustomBaseURL("https://[::ffff:10.0.0.5]/v1")).toBe("MAPPED_IPV6");
    expect(validateCustomBaseURL("https://[::ffff:169.254.169.254]/v1")).toBe("MAPPED_IPV6");
    expect(validateCustomBaseURL("https://[::ffff:7f00:1]/v1")).toBe("MAPPED_IPV6");
  });

  it("十六进制 / 八进制 / 整数 IPv4 变体：WHATWG URL 规范化为点分十进制 → 正确分类（不绕过）", () => {
    // Node 的 URL parser 将这些变体归一为标准 IPv4 → parseIPv4 命中 → 精确分类
    expect(validateCustomBaseURL("https://0x7f000001/v1")).toBe("LOOPBACK");
    expect(validateCustomBaseURL("https://0177.0.0.1/v1")).toBe("LOOPBACK");
    expect(validateCustomBaseURL("https://2130706433/v1")).toBe("LOOPBACK");
    // 公网 hex 变体（0xdeadbeef → 222.173.190.239）→ 放行（公网）
    expect(validateCustomBaseURL("https://0xdeadbeef/v1")).toBeNull();
    // IP_LITERAL_VARIANT 分支保留作纵深防御：若未来解析器保留字面量则拒绝而非放行
  });

  it("原行为不回归：公网域名放行；点分私网/loopback 仍拦截", () => {
    expect(validateCustomBaseURL("https://api.example.com/v1")).toBeNull();
    expect(validateCustomBaseURL("https://api.deepseek.com")).toBeNull();
    expect(validateCustomBaseURL("http://localhost:9000/v1")).toBe("NOT_HTTPS");
    expect(validateCustomBaseURL("https://127.0.0.1/v1")).toBe("LOOPBACK");
    expect(validateCustomBaseURL("https://192.168.1.10/v1")).toBe("PRIVATE");
    expect(validateCustomBaseURL("https://100.64.0.7/v1")).toBe("PRIVATE"); // CGNAT
  });
});
