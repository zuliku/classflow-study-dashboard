/**
 * Kiro Project Prompt Context（V1.2）测试：
 * normalize（trust boundary）/ toProjectTurnContext（client 冻结）/ Prompt section 组合。
 */
import { describe, it, expect } from "vitest";
import {
  normalizeProjectTurnContext,
  toProjectTurnContext,
  buildProjectInstructionsSection,
} from "@/lib/ai/projects/prompt";
import { KIRO_PROJECT_INSTRUCTIONS_MAX } from "@/lib/ai/projects/types";

describe("normalizeProjectTurnContext（server trust boundary）", () => {
  it("A. 合法输入完整保留（id/name/instructions）", () => {
    const ctx = normalizeProjectTurnContext({
      id: "proj-a",
      name: "论文项目",
      instructions: "回答使用中文",
    });
    expect(ctx).toEqual({ id: "proj-a", name: "论文项目", instructions: "回答使用中文" });
  });

  it("B. 未知字段全部丢弃（adapterRef/apiKey/permissions/roots/description）", () => {
    const ctx = normalizeProjectTurnContext({
      id: "proj-a",
      name: "P",
      instructions: "规则",
      adapterRef: "x",
      apiKey: "sk-secret",
      permissions: ["delete"],
      roots: ["/"],
      description: "DESCRIPTION_SENTINEL",
      createdAt: "t",
      updatedAt: "t",
    });
    expect(ctx).toEqual({ id: "proj-a", name: "P", instructions: "规则" });
    const json = JSON.stringify(ctx);
    expect(json).not.toContain("sk-secret");
    expect(json).not.toContain("DESCRIPTION_SENTINEL");
  });

  it("C. instructions 超限：hard slice（绝不把超大内容塞进 prompt）", () => {
    const long = "x".repeat(KIRO_PROJECT_INSTRUCTIONS_MAX + 5000);
    const ctx = normalizeProjectTurnContext({ id: "a", name: "P", instructions: long });
    expect(ctx?.instructions).toHaveLength(KIRO_PROJECT_INSTRUCTIONS_MAX);
  });

  it("C2. name / id 超限也 bounded；缺 id/name → undefined", () => {
    const ctx = normalizeProjectTurnContext({ id: "a".repeat(200), name: "N".repeat(200), instructions: "" });
    expect(ctx?.id).toHaveLength(64);
    expect(ctx?.name).toHaveLength(50);
    expect(normalizeProjectTurnContext(null)).toBeUndefined();
    expect(normalizeProjectTurnContext({ name: "P" })).toBeUndefined();
    expect(normalizeProjectTurnContext({ id: "a" })).toBeUndefined();
  });

  it("D. instructions 空（trim 后）→ 不产生 instructions 字段（无空块）", () => {
    const ctx = normalizeProjectTurnContext({ id: "a", name: "P", instructions: "   " });
    expect(ctx).toEqual({ id: "a", name: "P" });
    expect("instructions" in (ctx ?? {})).toBe(false);
  });

  it("E. description 根本不属于 Prompt Context", () => {
    const ctx = normalizeProjectTurnContext({ id: "a", name: "P", description: "DESC" });
    expect("description" in (ctx ?? {})).toBe(false);
  });
});

describe("toProjectTurnContext（client send boundary 冻结）", () => {
  it("从 Project Record 派生冻结快照（name/instructions trim + bounded）", () => {
    const record = {
      id: "proj-a",
      name: "  论文项目  ",
      description: "不应出现",
      instructions: "  回答使用中文  ",
      createdAt: "t",
      updatedAt: "t",
    };
    const ctx = toProjectTurnContext(record);
    expect(ctx).toEqual({ id: "proj-a", name: "论文项目", instructions: "回答使用中文" });
  });

  it("Turn freeze：快照在 Record 被修改后保持不变（v1 → v2 不污染进行中的 Turn）", () => {
    const record = { id: "a", name: "P", instructions: "v1", createdAt: "t", updatedAt: "t" } as const;
    const frozen = toProjectTurnContext(record);
    expect(frozen?.instructions).toBe("v1");
    // 模拟 live Project 被编辑为 v2
    const recordV2 = { id: "a", name: "P", instructions: "v2", createdAt: "t", updatedAt: "t" } as const;
    const next = toProjectTurnContext(recordV2);
    expect(next?.instructions).toBe("v2");
    // 已冻结快照保持 v1（快照对象不可变语义）
    expect(frozen?.instructions).toBe("v1");
  });

  it("无 instructions → 只含 id/name（模型能回答「这个项目是什么」）", () => {
    const ctx = toProjectTurnContext({ id: "a", name: "P" } as never);
    expect(ctx).toEqual({ id: "a", name: "P" });
  });
});

describe("buildProjectInstructionsSection", () => {
  it("无 context → 空字符串（global Conversation 零开销）", () => {
    expect(buildProjectInstructionsSection(undefined)).toBe("");
  });

  it("有 context 无 instructions → 项目名块，无空指令块", () => {
    const s = buildProjectInstructionsSection({ id: "a", name: "项目 A" });
    expect(s).toContain("# 当前 Kiro 项目");
    expect(s).toContain("项目 A");
    expect(s).not.toContain("## 项目指令");
  });

  it("含 instructions → 指令块 + 安全语义 + 用户明确要求优先", () => {
    const s = buildProjectInstructionsSection({
      id: "a",
      name: "P",
      instructions: "PROJECT_RULE_SENTINEL 回答全部使用英文",
    });
    expect(s).toContain("PROJECT_RULE_SENTINEL");
    expect(s).toContain("## 项目指令");
    expect(s).toContain("不能改变系统安全策略");
    expect(s).toContain("以当前明确要求为准");
    // 不出现会错误提升优先级的表述
    expect(s).not.toContain("MANDATORY SYSTEM");
    expect(s).not.toContain("DEVELOPER RULE");
    // description 永不进入
    expect(s).not.toContain("description");
  });
});
