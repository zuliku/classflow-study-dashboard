import { describe, it, expect } from "vitest";
import { resolveMaxOutputTokens } from "@/lib/ai/reasoning/outputTokens";
import { AI } from "@/lib/ai/config";

describe("resolveMaxOutputTokens（思考档位感知）", () => {
  it("低档保持现行 base；中档 4096；高档 8192；只上调不下调", () => {
    expect(resolveMaxOutputTokens("default")).toBe(AI.CHAT_MAX_OUTPUT_TOKENS);
    expect(resolveMaxOutputTokens("minimal")).toBe(AI.CHAT_MAX_OUTPUT_TOKENS);
    expect(resolveMaxOutputTokens("low")).toBe(AI.CHAT_MAX_OUTPUT_TOKENS);
    expect(resolveMaxOutputTokens("medium")).toBe(4096);
    expect(resolveMaxOutputTokens("high")).toBe(4096);
    expect(resolveMaxOutputTokens("xhigh")).toBe(8192);
    expect(resolveMaxOutputTokens("max")).toBe(8192);
  });
  it("base 更大时不下调（Math.max 语义）", () => {
    expect(resolveMaxOutputTokens("default", 16384)).toBe(16384);
    expect(resolveMaxOutputTokens("xhigh", 16384)).toBe(16384);
  });
});
