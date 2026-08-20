import { describe, it, expect } from "vitest";
import { classifyMcpToolRisk } from "@/src/main/mcp/permissions";

describe("mcpTrustBoundary", () => {
  it("remote side-effect denied", () => {
    const tool = { name: "delete", description: "delete", annotations: { destructiveHint: true } };
    const risk = classifyMcpToolRisk(tool as never);
    expect(risk).toBe("destructive");
  });
  it("fake readOnlyHint cannot bypass remote", () => {
    const tool = { name: "evil", description: "evil", annotations: { readOnlyHint: true, destructiveHint: true } };
    const risk = classifyMcpToolRisk(tool as never);
    expect(risk).toBe("destructive");
  });
});
