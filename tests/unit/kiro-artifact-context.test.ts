import { describe, it, expect } from "vitest";
import { KiroContextRef } from "@/lib/ai/context/types";
import { refsForPrompt, normalizePromptContextRefs, dedupeContextRefs } from "@/lib/ai/context/contextSelection";
import { sanitizeConversation } from "@/lib/ai/history/sanitize";
import { KiroChatMessageView } from "@/hooks/useKiroChat";

function artifactRef(overrides: Partial<KiroContextRef> = {}): KiroContextRef {
  return {
    key: "manual-artifact-art-1",
    kind: "artifact",
    entityId: "art-1",
    label: "文件 · research.md",
    source: "manual",
    artifact: {
      artifactId: "art-1",
      workspaceId: "ws-a",
      rootId: "root-sandbox",
      relativePath: "research.md",
      type: "markdown",
      revision: 1,
    },
    ...overrides,
  };
}

function makeView(role: "user" | "assistant", content: string): KiroChatMessageView {
  return {
    id: `m-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    streaming: false,
    canRegenerate: role === "assistant" ? false : true,
  };
}

describe("refsForPrompt artifact projection", () => {
  it("exact logical whitelist（无 content/adapterRef/nativePath/bytes/Source IR）", () => {
    const out = refsForPrompt([artifactRef()]);
    expect(out).toEqual([
      {
        kind: "artifact",
        id: "art-1",
        label: "文件 · research.md",
        workspaceId: "ws-a",
        rootId: "root-sandbox",
        relativePath: "research.md",
        type: "markdown",
        revision: 1,
      },
    ]);
    const serialized = JSON.stringify(out);
    for (const forbidden of ["adapterRef", "nativePath", "absolutePath", "handle", "bytes", "content", "source IR", "sandbox-default"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("artifact 无 meta 的 ref 不输出", () => {
    const ref = artifactRef();
    delete ref.artifact;
    expect(refsForPrompt([ref])).toEqual([]);
  });

  it("dedupe 同 artifact 只保留一个（kind:artifact + entityId）", () => {
    const a = artifactRef();
    const b = artifactRef({ key: "manual-artifact-art-1-b" });
    const deduped = dedupeContextRefs([a, b]);
    expect(deduped.length).toBe(1);
  });
});

describe("normalizePromptContextRefs hostile input", () => {
  it("只保留白名单字段；恶意额外字段全部丢弃", () => {
    const normalized = normalizePromptContextRefs([
      {
        kind: "artifact",
        id: "art-1",
        label: "文件 · research.md",
        workspaceId: "ws-a",
        rootId: "root-sandbox",
        relativePath: "research.md",
        type: "markdown",
        revision: 1,
        adapterRef: "secret",
        nativePath: "C:\\secret\\file.md",
        content: "hacked body",
        bytes: [1, 2, 3],
      },
    ]);
    expect(normalized).toEqual([
      {
        kind: "artifact",
        id: "art-1",
        label: "文件 · research.md",
        workspaceId: "ws-a",
        rootId: "root-sandbox",
        relativePath: "research.md",
        type: "markdown",
        revision: 1,
      },
    ]);
    const serialized = JSON.stringify(normalized);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("hacked");
    expect(serialized).not.toContain("C:\\");
    expect(serialized).not.toContain("adapterRef");
    expect(serialized).not.toContain("content");
    expect(serialized).not.toContain("bytes");
  });

  it("非法 artifact（缺字段/坏 type/revision<1/未知 kind）→ 拒绝", () => {
    expect(normalizePromptContextRefs([{ kind: "artifact", id: "a", label: "x" }])).toEqual([]);
    expect(
      normalizePromptContextRefs([
        { kind: "artifact", id: "a", label: "x", workspaceId: "w", rootId: "r", relativePath: "p.md", type: "html", revision: 1 },
      ])
    ).toEqual([]);
    expect(
      normalizePromptContextRefs([
        { kind: "artifact", id: "a", label: "x", workspaceId: "w", rootId: "r", relativePath: "p.md", type: "markdown", revision: 0 },
      ])
    ).toEqual([]);
    expect(normalizePromptContextRefs([{ kind: "hacker", id: "a", label: "x" }])).toEqual([]);
    expect(normalizePromptContextRefs("not-array")).toEqual([]);
  });

  it("普通 course ref 继续通过", () => {
    expect(normalizePromptContextRefs([{ kind: "course", id: "c1", label: "课程" }])).toEqual([
      { kind: "course", id: "c1", label: "课程" },
    ]);
  });
});

describe("artifact context 不持久化", () => {
  it("sanitizeConversation 过滤 artifact ref，普通 course ref 正常持久化", () => {
    const record = sanitizeConversation({
      id: "conv-art",
      title: "对话",
      createdAt: "2026-08-13T10:00:00.000Z",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      messages: [
        makeView("user", "总结这个文件"),
        makeView("assistant", "好的"),
      ],
      manualRefs: [
        artifactRef(),
        { key: "manual-course-c1", kind: "course", entityId: "c1", label: "课程", source: "manual" },
      ],
      entryRefs: [],
    });
    expect(record.manualRefs).toEqual([{ kind: "course", entityId: "c1", label: "课程" }]);
    expect(record.manualRefs.some((r) => r.kind === ("artifact" as never))).toBe(false);
  });
});
