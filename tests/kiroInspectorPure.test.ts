// @vitest-environment node
/**
 * Kiro Inspector V1 — 纯函数测试（归属 / 语义去重 / 排序 / Computer 语义）。
 */
import { describe, it, expect } from "vitest";
import {
  INSPECTOR_SOURCES_PREVIEW_LIMIT,
  aggregateInspectorSources,
  artifactBelongsToConversation,
  inspectorSourceKey,
  normalizeSourceUrl,
  resolveInspectorComputerState,
} from "@/lib/ai/ui/kiroInspector";
import type { KiroSourceMeta } from "@/lib/ai/citations/types";

function source(overrides: Partial<KiroSourceMeta> & Pick<KiroSourceMeta, "sourceId" | "name" | "source">): KiroSourceMeta {
  return { ...overrides };
}

describe("artifactBelongsToConversation", () => {
  it("只按真实 metadata（sourceConversationId）判定", () => {
    expect(artifactBelongsToConversation({ sourceConversationId: "c1" }, "c1")).toBe(true);
    expect(artifactBelongsToConversation({ sourceConversationId: "c2" }, "c1")).toBe(false);
    expect(artifactBelongsToConversation({ sourceConversationId: undefined }, "c1")).toBe(false);
    expect(artifactBelongsToConversation({ sourceConversationId: "c1" }, null)).toBe(false);
  });
});

describe("normalizeSourceUrl", () => {
  it("只接受 http/https，去 hash 与末尾斜杠，host 小写", () => {
    expect(normalizeSourceUrl("https://OpenAI.com/docs/#section")).toBe("https://openai.com/docs");
    expect(normalizeSourceUrl("http://example.com/")).toBe("http://example.com");
    expect(normalizeSourceUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeSourceUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeSourceUrl(undefined)).toBeNull();
    expect(normalizeSourceUrl("not a url")).toBeNull();
  });
});

describe("inspectorSourceKey — 语义去重 key", () => {
  it("web：同一归一 URL 视为同一来源（跨 Turn sourceId 不同也能去重）", () => {
    const a = source({ sourceId: "web-1", name: "OpenAI", source: "web", url: "https://openai.com/blog/#x" });
    const b = source({ sourceId: "web-9", name: "OpenAI Blog", source: "web", url: "https://openai.com/blog" });
    expect(inspectorSourceKey(a)).toBe(inspectorSourceKey(b));
  });

  it("web 无安全 URL → source + domain + name", () => {
    const a = source({ sourceId: "web-1", name: "某网页", source: "web", domain: "example.com" });
    const b = source({ sourceId: "web-2", name: "某网页", source: "web", domain: "example.com" });
    expect(inspectorSourceKey(a)).toBe(inspectorSourceKey(b));
  });

  it("course-material：courseName + name；project-file / chat：source + name", () => {
    const cm1 = source({ sourceId: "material-1", name: "第三章.pdf", source: "course-material", courseName: "中级计量经济学" });
    const cm2 = source({ sourceId: "material-2", name: "第三章.pdf", source: "course-material", courseName: "中级计量经济学" });
    const cm3 = source({ sourceId: "material-3", name: "第三章.pdf", source: "course-material", courseName: "宏观经济学" });
    expect(inspectorSourceKey(cm1)).toBe(inspectorSourceKey(cm2));
    expect(inspectorSourceKey(cm1)).not.toBe(inspectorSourceKey(cm3));

    const pf = source({ sourceId: "pf-1", name: "notes.md", source: "project-file" });
    const pf2 = source({ sourceId: "pf-2", name: "notes.md", source: "project-file" });
    expect(inspectorSourceKey(pf)).toBe(inspectorSourceKey(pf2));

    const chat = source({ sourceId: "chat-1", name: "报告.pdf", source: "chat" });
    expect(inspectorSourceKey(chat)).toContain("chat:报告.pdf");
  });
});

describe("aggregateInspectorSources", () => {
  it("live Turn 优先 → 已绑定历史（新 → 旧）；按语义 key 去重保留首次出现", () => {
    const live = source({ sourceId: "web-1", name: "OpenAI", source: "web", url: "https://openai.com/" });
    const liveDuplicate = source({ sourceId: "web-2", name: "OpenAI", source: "web", url: "https://openai.com" });
    const older = source({ sourceId: "material-1", name: "讲义.pdf", source: "course-material", courseName: "课程A" });
    const newestBound = source({ sourceId: "web-3", name: "新来源", source: "web", url: "https://example.com/x" });

    const result = aggregateInspectorSources({
      currentTurnSources: [live, liveDuplicate],
      boundSources: [[newestBound], [older, live]],
    });

    expect(result.map((s) => s.name)).toEqual(["OpenAI", "新来源", "讲义.pdf"]);
    // 去重保留 live 的 sourceId（顺序稳定）
    expect(result[0].sourceId).toBe("web-1");
  });

  it("preview limit 常量固定（≤6）", () => {
    expect(INSPECTOR_SOURCES_PREVIEW_LIMIT).toBeLessThanOrEqual(6);
  });
});

describe("resolveInspectorComputerState", () => {
  it("Computer 关闭 → 隐藏", () => {
    expect(resolveInspectorComputerState({ computerEnabled: false, runtimeStatus: "idle" }).visible).toBe(false);
    expect(resolveInspectorComputerState({ computerEnabled: false, runtimeStatus: "computer-active" }).visible).toBe(false);
  });

  it("thinking 不等于 computer-active（显示已开启，绝不误报正在操作）", () => {
    const state = resolveInspectorComputerState({ computerEnabled: true, runtimeStatus: "thinking" });
    expect(state.visible).toBe(true);
    expect(state.tone).toBe("on");
    expect(state.label).toBe("已开启");
  });

  it("idle → 已开启；computer-active → 正在操作", () => {
    expect(resolveInspectorComputerState({ computerEnabled: true, runtimeStatus: "idle" }).label).toBe("已开启");
    const active = resolveInspectorComputerState({ computerEnabled: true, runtimeStatus: "computer-active" });
    expect(active.tone).toBe("active");
    expect(active.label).toBe("正在操作");
  });

  it("waiting-approval 优先于 computer-active（amber 语义）", () => {
    const state = resolveInspectorComputerState({ computerEnabled: true, runtimeStatus: "waiting-approval" });
    expect(state.tone).toBe("approval");
    expect(state.label).toBe("等待确认");
  });
});
