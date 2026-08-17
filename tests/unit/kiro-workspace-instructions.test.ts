import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadWorkspaceInstructionsForTurn,
  normalizeWorkspaceInstructionsForPrompt,
  buildWorkspaceInstructionsSection,
} from "@/lib/ai/computer/knowledge/instructions";
import { getComputerAdapterForAdapterRef  } from "@/lib/ai/computer/adapters/factory";
import { clearSandboxAdapter, sandboxWriteText } from "@/lib/ai/computer/adapters/sandbox";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { ComputerPermissionRule, KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import {
  KIRO_INSTRUCTIONS_MAX_CHARS_PER_ROOT,
  KIRO_INSTRUCTIONS_MAX_CHARS_TOTAL,
} from "@/lib/ai/computer/knowledge/types";

const REF_A = "sandbox-inst-a";
const REF_B = "sandbox-inst-b";

const workspace: KiroWorkspaceMeta = {
  id: "ws-i",
  name: "指令工作区",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  roots: [
    { id: "root-a", label: "Alpha", access: "read-write", adapterRef: REF_A },
    { id: "root-b", label: "Beta", access: "read-write", adapterRef: REF_B },
  ],
};

function snapshot(overrides: Partial<KiroComputerTurnSnapshot> = {}): KiroComputerTurnSnapshot {
  return {
    enabled: true,
    workspaceId: "ws-i",
    agentMode: "workspace-auto",
    roots: [
      { id: "root-a", label: "Alpha", access: "read-write" },
      { id: "root-b", label: "Beta", access: "read-write" },
    ],
    ...overrides,
  };
}

function rulesFor(overrides: Partial<ComputerPermissionRule>[] = []): ComputerPermissionRule[] {
  return overrides as ComputerPermissionRule[];
}

beforeEach(async () => {
  await clearSandboxAdapter(REF_A);
  await clearSandboxAdapter(REF_B);
});

describe("client loader", () => {
  it("loads only exact root-level KIRO.md in frozen root order", async () => {
    await sandboxWriteText(REF_A, "KIRO.md", "A 指令");
    await sandboxWriteText(REF_B, "KIRO.md", "B 指令");
    const ctx = await loadWorkspaceInstructionsForTurn({
      snapshot: snapshot(),
      liveWorkspaces: [workspace],
      livePermissionRules: [],
      getAdapter: getComputerAdapterForAdapterRef,
    });
    expect(ctx?.entries.map((e) => e.rootId)).toEqual(["root-a", "root-b"]);
    expect(ctx?.entries.map((e) => e.availability)).toEqual(["loaded", "loaded"]);
    expect(ctx?.entries[0].text).toContain("A 指令");
  });

  it("never promotes nested project/KIRO.md", async () => {
    await sandboxWriteText(REF_A, "project/KIRO.md", "nested 指令");
    const ctx = await loadWorkspaceInstructionsForTurn({
      snapshot: snapshot(),
      liveWorkspaces: [workspace],
      livePermissionRules: [],
      getAdapter: getComputerAdapterForAdapterRef,
    });
    expect(ctx?.entries[0].availability).toBe("missing");
  });

  it("fs.read deny/ask omits instructions without approval", async () => {
    await sandboxWriteText(REF_A, "KIRO.md", "机密指令");
    const deny: ComputerPermissionRule = {
      id: "deny-a",
      effect: "deny",
      capability: "fs.read",
      workspaceId: "ws-i",
      rootId: "root-a",
      resourcePattern: "KIRO.md",
      scope: "persistent",
    };
    const ctx = await loadWorkspaceInstructionsForTurn({
      snapshot: snapshot(),
      liveWorkspaces: [workspace],
      livePermissionRules: rulesFor([deny]),
      getAdapter: getComputerAdapterForAdapterRef,
    });
    expect(ctx?.entries[0].availability).toBe("unavailable");
    // 无文件 IO（不读取正文）
    expect(ctx?.entries[0].text).toBeUndefined();
  });

  it("applies 8000/root and 16000/workspace bounds deterministically", async () => {
    const big = "x".repeat(KIRO_INSTRUCTIONS_MAX_CHARS_PER_ROOT + 100);
    await sandboxWriteText(REF_A, "KIRO.md", big);
    await sandboxWriteText(REF_B, "KIRO.md", "y".repeat(KIRO_INSTRUCTIONS_MAX_CHARS_TOTAL));
    const ctx = await loadWorkspaceInstructionsForTurn({
      snapshot: snapshot(),
      liveWorkspaces: [workspace],
      livePermissionRules: [],
      getAdapter: getComputerAdapterForAdapterRef,
    });
    const loaded = ctx?.entries.filter((e) => e.availability === "loaded") ?? [];
    expect(loaded[0].text?.length).toBe(KIRO_INSTRUCTIONS_MAX_CHARS_PER_ROOT);
    const total = loaded.reduce((sum, e) => sum + (e.text?.length ?? 0), 0);
    expect(total).toBeLessThanOrEqual(KIRO_INSTRUCTIONS_MAX_CHARS_TOTAL);
  });

  it("missing KIRO.md is normal and produces empty section", async () => {
    const ctx = await loadWorkspaceInstructionsForTurn({
      snapshot: snapshot(),
      liveWorkspaces: [workspace],
      livePermissionRules: [],
      getAdapter: getComputerAdapterForAdapterRef,
    });
    expect(ctx?.entries.map((e) => e.availability)).toEqual(["missing", "missing"]);
    expect(buildWorkspaceInstructionsSection(ctx?.entries ?? [])).toBe("");
  });
});

describe("server normalizer", () => {
  it("replaces client labels/order with frozen snapshot facts", () => {
    const raw = {
      workspaceId: "ws-i",
      entries: [
        { rootId: "root-b", rootLabel: "HACKED", path: "KIRO.md", availability: "loaded", text: "B 指令" },
      ],
    };
    const normalized = normalizeWorkspaceInstructionsForPrompt(raw, snapshot());
    expect(normalized[0].rootLabel).toBe("Beta");
    expect(normalized[0].rootId).toBe("root-b");
  });

  it("mismatched workspace/root and arbitrary extra fields are dropped", () => {
    const raw = {
      workspaceId: "ws-other",
      entries: [
        { rootId: "root-a", path: "KIRO.md", availability: "loaded", text: "x", adapterRef: "secret", nativePath: "C:\\x" },
      ],
    };
    expect(normalizeWorkspaceInstructionsForPrompt(raw, snapshot())).toEqual([]);
    const raw2 = {
      workspaceId: "ws-i",
      entries: [{ rootId: "root-unknown", path: "KIRO.md", availability: "loaded", text: "x" }],
    };
    expect(normalizeWorkspaceInstructionsForPrompt(raw2, snapshot())).toEqual([]);
  });

  it("accepts only literal KIRO.md path and loaded availability; re-applies bounds", () => {
    const big = "z".repeat(KIRO_INSTRUCTIONS_MAX_CHARS_PER_ROOT + 50);
    const raw = {
      workspaceId: "ws-i",
      entries: [
        { rootId: "root-a", path: "nested/KIRO.md", availability: "loaded", text: "nested" },
        { rootId: "root-b", path: "KIRO.md", availability: "loaded", text: big, truncated: true },
      ],
    };
    const normalized = normalizeWorkspaceInstructionsForPrompt(raw, snapshot());
    expect(normalized.map((e) => e.rootId)).toEqual(["root-b"]);
    expect(normalized[0].text?.length).toBe(KIRO_INSTRUCTIONS_MAX_CHARS_PER_ROOT);
    expect(normalized[0].truncated).toBe(true);
  });

  it("section has fixed notice and no loaded content → empty", () => {
    const section = buildWorkspaceInstructionsSection([
      { workspaceId: "ws-i", rootId: "root-a", rootLabel: "Alpha", path: "KIRO.md", availability: "loaded", text: "约定", truncated: false },
    ]);
    expect(section).toContain("# Workspace Instructions");
    expect(section).toContain("约定");
    expect(section).not.toContain("adapterRef");
    expect(buildWorkspaceInstructionsSection([])).toBe("");
  });
});

