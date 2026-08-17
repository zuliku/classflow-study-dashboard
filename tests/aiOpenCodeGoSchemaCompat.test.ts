/**
 * OpenCode Go chat/completions tool-schema root 兼容（V4.7.2 真实验证回归）。
 * 生产 provider 已证明：OpenCode Go 上游对 tool parameters 根 JSON Schema 要求 type:"object"。
 * 这里锁定 openCodeGoTransformRequestBody 的纯行为（不写第二份 Tool Schema；registry 仍是 source of truth）。
 */
import { describe, it, expect } from "vitest";
import { openCodeGoTransformRequestBody } from "@/lib/ai/providers/openCodeGo";

const TOOL_OBJECT = {
  type: "object",
  properties: { assignmentId: { type: "string" } },
  required: ["assignmentId"],
};

const TOOL_ANYOF = {
  anyOf: [
    { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
    { type: "object", properties: { b: { type: "string" } }, required: ["b"] },
  ],
};

const TOOL_ONEOF = {
  oneOf: [
    { type: "object", properties: { x: { type: "number" } }, required: ["x"] },
    { type: "object", properties: { y: { type: "number" } }, required: ["y"] },
  ],
};

const TOOL_NO_PARAMS = { type: "function", function: { name: "noop", description: "" } };

describe("openCodeGoTransformRequestBody（tool-schema root type:object 兼容）", () => {
  it("已有 root type:object 的 schema 保持语义不变", () => {
    const body = { model: "m", messages: [], tools: [{ type: "function", function: { name: "t", parameters: TOOL_OBJECT } }] };
    const out = openCodeGoTransformRequestBody(body);
    expect(out.tools).toEqual(body.tools);
    expect(out.model).toBe("m");
  });

  it("anyOf 风格（zod discriminatedUnion）→ root.type 补为 object，anyOf 内容完全保留", () => {
    const body = { model: "m", messages: [], tools: [{ type: "function", function: { name: "create_reminder", parameters: TOOL_ANYOF } }] };
    const out = openCodeGoTransformRequestBody(body);
    const params = (out.tools as { function: { parameters: Record<string, unknown> } }[])[0].function.parameters;
    expect(params.type).toBe("object");
    expect(params.anyOf).toEqual(TOOL_ANYOF.anyOf);
  });

  it("oneOf 同理 → root.type 补为 object，oneOf 内容保留", () => {
    const body = { model: "m", messages: [], tools: [{ type: "function", function: { name: "t", parameters: TOOL_ONEOF } }] };
    const out = openCodeGoTransformRequestBody(body);
    const params = (out.tools as { function: { parameters: Record<string, unknown> } }[])[0].function.parameters;
    expect(params.type).toBe("object");
    expect(params.oneOf).toEqual(TOOL_ONEOF.oneOf);
  });

  it("没有 tools：body 其它字段原样", () => {
    const body = { model: "m", messages: [{ role: "user", content: "hi" }], temperature: 0.2 };
    const out = openCodeGoTransformRequestBody(body);
    expect(out).toEqual(body);
  });

  it("tool 没有 function.parameters：不得擅自修改", () => {
    const body = { model: "m", messages: [], tools: [TOOL_NO_PARAMS] };
    const out = openCodeGoTransformRequestBody(body);
    expect(out.tools).toEqual([TOOL_NO_PARAMS]);
  });

  it("非 object 结构（标量/枚举 schema）不得被补 type", () => {
    const body = { model: "m", messages: [], tools: [{ type: "function", function: { name: "t", parameters: { type: "string" } } }] };
    const out = openCodeGoTransformRequestBody(body);
    expect(out.tools).toEqual(body.tools);
  });

  it("mutation 不触碰工具定义本身（只改请求体 parameters 副本）", () => {
    const body = { model: "m", messages: [], tools: [{ type: "function", function: { name: "t", parameters: TOOL_ANYOF } }] };
    const out = openCodeGoTransformRequestBody(body);
    expect((body.tools as { function: { parameters: Record<string, unknown> } }[])[0].function.parameters.type).toBeUndefined();
    expect((out.tools as { function: { parameters: Record<string, unknown> } }[])[0].function.parameters.type).toBe("object");
  });
});
