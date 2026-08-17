import { describe, it, expect } from "vitest";
import { zodSchema } from "ai";
import { KIRO_TOOLS } from "@/lib/ai/tools";
import { deepSeekTransformRequestBody } from "@/lib/ai/providers/deepSeek";

/**
 * DeepSeek 400 守卫：发给 DeepSeek 的最终请求 body 中，
 * 每个工具的 parameters 根节点必须是 type:"object"（DeepSeek 严格校验，
 * z.discriminatedUnion 原始转换根节点无 type，create_reminder 曾因此 400）。
 * 同时原始转换也必须有可识别的 object 结构（properties/anyOf/oneOf），否则 transform 无法补全。
 */
describe("KIRO_TOOLS DeepSeek 请求体守卫", () => {
  it("transform 后所有工具 parameters 根节点 type=object（含 create_reminder）", () => {
    // 与 SDK 发送路径一致：inputSchema（zod）→ zodSchema → JSON Schema → wire 形状 → DeepSeek transform
    const wireTools = Object.entries(KIRO_TOOLS).map(([name, def]) => ({
      type: "function",
      function: {
        name,
        parameters: (zodSchema((def as { inputSchema: never }).inputSchema) as { jsonSchema: Record<string, unknown> })
          .jsonSchema,
      },
    }));
    const body = deepSeekTransformRequestBody({ model: "deepseek-v4-flash", messages: [], tools: wireTools });
    const tools = body.tools as { function: { name: string; parameters?: Record<string, unknown> } }[];
    const bad: string[] = [];
    for (const t of tools) {
      const params = t.function.parameters;
      if (!params || params.type !== "object") {
        bad.push(`${t.function.name}: root type=${JSON.stringify(params?.type)}`);
      }
    }
    expect(bad, `非 object 根节点工具：${bad.join("; ")}`).toEqual([]);
  });

  it("原始转换守卫：任一工具 schema 都能被 transform 识别为 object 结构", () => {
    const bad: string[] = [];
    for (const [name, def] of Object.entries(KIRO_TOOLS)) {
      const t = def as { inputSchema?: unknown };
      if (!t.inputSchema) continue;
      let json: { type?: unknown; properties?: unknown; anyOf?: unknown; oneOf?: unknown } | null = null;
      try {
        json = (zodSchema(t.inputSchema as never) as { jsonSchema: { type?: unknown; properties?: unknown; anyOf?: unknown; oneOf?: unknown } }).jsonSchema;
      } catch {
        bad.push(`${name}: conversion-failed`);
        continue;
      }
      if (json && json.type !== "object" && !json.properties && !Array.isArray(json.anyOf) && !Array.isArray(json.oneOf)) {
        bad.push(`${name}: 无 object 结构可补`);
      }
    }
    expect(bad, `无法补全的工具：${bad.join("; ")}`).toEqual([]);
  });
});
