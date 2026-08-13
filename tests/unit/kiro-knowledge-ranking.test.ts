import { describe, it, expect } from "vitest";
import { buildLiveExcerpt } from "@/lib/ai/computer/knowledge/excerpt";
import { normalizeKnowledgeText, tokenizeKnowledgeText } from "@/lib/ai/computer/knowledge/tokenize";
import {
  rankKnowledgeCandidates,
  scoreKnowledgeCandidate,
  buildKnowledgeSnippet,
} from "@/lib/ai/computer/knowledge/rank";
import {
  KIRO_KNOWLEDGE_SNIPPET_MAX_CHARS,
  KiroKnowledgeChunkRecord,
  KiroKnowledgeFileRecord,
  knowledgeFileKey,
} from "@/lib/ai/computer/knowledge/types";

function file(path: string, title?: string): KiroKnowledgeFileRecord {
  return {
    key: knowledgeFileKey("ws-1", "root-out", path),
    workspaceId: "ws-1",
    rootId: "root-out",
    relativePath: path,
    extension: "md",
    type: "text",
    size: 10,
    title,
    fingerprint: "fp",
    contentStatus: "indexed",
    indexedAt: "2026-01-01T00:00:00.000Z",
  };
}

function chunk(path: string, text: string): KiroKnowledgeChunkRecord {
  return {
    key: `${knowledgeFileKey("ws-1", "root-out", path)}\u00000000`,
    fileKey: knowledgeFileKey("ws-1", "root-out", path),
    workspaceId: "ws-1",
    rootId: "root-out",
    relativePath: path,
    ordinal: 0,
    text,
    tokenCounts: {},
  };
}

describe("tokenization", () => {
  it("normalizes Latin case and produces word tokens", () => {
    expect(tokenizeKnowledgeText("Policy Adoption 2026")).toEqual(
      expect.arrayContaining(["policy", "adoption", "2026"])
    );
  });

  it("normalizes NFKC and collapses whitespace", () => {
    expect(normalizeKnowledgeText("ＡＢＣ　 ｄｅｆ\n\n  x")).toBe("abc def x");
  });

  it("produces overlapping CJK 2-grams and 3-grams", () => {
    const tokens = tokenizeKnowledgeText("研究方法");
    expect(tokens).toEqual(expect.arrayContaining(["研究", "究方", "方法", "研究方", "究方法"]));
  });

  it("single CJK character falls back to itself", () => {
    expect(tokenizeKnowledgeText("文")).toEqual(["文"]);
  });
});

describe("ranking", () => {
  const fixtures = [
    { file: file("research/研究方法.md"), chunks: [chunk("research/研究方法.md", "普通正文")] },
    { file: file("research/method.md"), chunks: [chunk("research/method.md", "研究方法采用事件研究。")] },
    { file: file("data/notes.md"), chunks: [chunk("data/notes.md", "研究方法与平行趋势检验。")] },
  ];

  it("filename exact match outranks body-only match deterministically", () => {
    const ranked = rankKnowledgeCandidates(fixtures, "研究方法");
    expect(ranked[0].result.path).toBe("research/研究方法.md");
  });

  it("separates metadataScore and contentScore; content token reasons present when indexed", () => {
    const withTokens: KiroKnowledgeChunkRecord = {
      ...chunk("research/method.md", "研究方法采用事件研究。"),
      tokenCounts: { 研究: 1, 究方: 1, 方法: 1, 研究方: 1, 究方法: 1 },
    };
    const scored = scoreKnowledgeCandidate(
      { file: file("research/method.md"), chunks: [withTokens] },
      "研究方法",
      ["研究", "究方", "方法", "研究方", "究方法"]
    );
    expect(scored.contentScore).toBeGreaterThan(0);
    expect(scored.result.matchReasons).toContain("phrase");
    expect(scored.result.matchReasons).toContain("content-token");
  });

  it("metadata-only candidate (no chunks) still ranks by filename", () => {
    const ranked = rankKnowledgeCandidates(
      [{ file: file("docs/研究背景.md"), chunks: [] }],
      "研究背景"
    );
    expect(ranked[0].result.path).toBe("docs/研究背景.md");
    expect(ranked[0].contentScore).toBe(0);
  });

  it("snippet is bounded to 320 chars", () => {
    const long = "研究方法 ".repeat(200);
    const snippet = buildKnowledgeSnippet([chunk("a.md", long)], ["研究"]);
    expect(snippet.length).toBeLessThanOrEqual(KIRO_KNOWLEDGE_SNIPPET_MAX_CHARS);
  });

  it("tie-break is deterministic by path", () => {
    const a = { file: file("b.md"), chunks: [chunk("b.md", "方法论说明")] };
    const b = { file: file("a.md"), chunks: [chunk("a.md", "方法论说明")] };
    const ranked = rankKnowledgeCandidates([a, b], "方法论");
    expect(ranked.map((r) => r.result.path)).toEqual(["a.md", "b.md"]);
  });
});

describe("live excerpt（V3 Part 2.1）", () => {
  it("500-char 完整 excerpt → truncated=false", () => {
    const src = "研究方法" + "x".repeat(496);
    expect(src.length).toBe(500);
    const r = buildLiveExcerpt(src, "研究方法");
    expect(r.excerpt.length).toBe(500);
    expect(r.truncated).toBe(false);
  });

  it(">1600-char source → truncated=true", () => {
    const src = "研究方法" + "x".repeat(2000);
    const r = buildLiveExcerpt(src, "研究方法");
    expect(r.truncated).toBe(true);
  });

  it("匹配位于文件尾部 → excerpt 包含真实尾部匹配（无 offset 漂移）", () => {
    const src = "a".repeat(1400) + "。" + "研究方法结论" + "b".repeat(300);
    const r = buildLiveExcerpt(src, "研究方法结论");
    expect(r.excerpt).toContain("研究方法结论");
    expect(r.truncated).toBe(true); // start > 0
  });

  it("匹配前存在大量空白/换行 → 不产生 normalized offset 漂移（返回 raw window）", () => {
    const src = "\n\n\n   \n".repeat(50) + "研究方法说明内容";
    const r = buildLiveExcerpt(src, "研究方法");
    expect(r.excerpt).toContain("研究方法说明内容");
    expect(r.excerpt.length).toBeLessThanOrEqual(1600);
  });
});