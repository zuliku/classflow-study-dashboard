import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  sandboxCreateDirectory,
  sandboxWriteText,
  sandboxWriteBytes,
  sandboxReadText,
  sandboxReadBytes,
  sandboxListDirectory,
  sandboxStat,
} from "@/lib/ai/computer/adapters/sandbox";
import {
  applyReadBounds,
  searchFiles,
  grepFiles,
  applyExactPatches,
  normalizeScopePath,
  matchesFileName,
} from "@/lib/ai/computer/filesystem/search";
import { normalizeRelativeComputerPath } from "@/lib/ai/computer/workspace/resolver";
import { ComputerError } from "@/lib/ai/computer/errors";
import { KIRO_SANDBOX_DB, KIRO_SANDBOX_FILES_STORE } from "@/lib/ai/computer/adapters/sandbox";

const REF_A = "sandbox-a";
const REF_B = "sandbox-b";

/** 递归清空某 adapterRef 全部 entry（目录 marker `path/` 与子文件都删） */
function clearSandbox(ref: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.open(KIRO_SANDBOX_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(KIRO_SANDBOX_FILES_STORE)) {
        req.result.createObjectStore(KIRO_SANDBOX_FILES_STORE);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(KIRO_SANDBOX_FILES_STORE, "readwrite");
      const store = tx.objectStore(KIRO_SANDBOX_FILES_STORE);
      const keys = store.getAllKeys();
      keys.onsuccess = () => {
        const prefix = ref + "\u0000";
        for (const k of keys.result as string[]) {
          if (k.startsWith(prefix)) store.delete(k);
        }
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    };
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  await clearSandbox(REF_A);
  await clearSandbox(REF_B);
});

describe("sandbox filesystem", () => {
  it("create directory + write text + read back + stat", async () => {
    await sandboxCreateDirectory(REF_A, "docs");
    expect((await sandboxStat(REF_A, "docs"))?.kind).toBe("directory");
    await sandboxWriteText(REF_A, "docs/notes.md", "# 标题\n正文");
    const text = await sandboxReadText(REF_A, "docs/notes.md");
    expect(text).toBe("# 标题\n正文");
    expect((await sandboxStat(REF_A, "docs/notes.md"))?.size).toBeGreaterThan(0);
    expect((await sandboxStat(REF_A, "docs/notes.md"))?.kind).toBe("file");
  });

  it("binary bytes read/write", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    await sandboxWriteBytes(REF_A, "bin/data.bin", bytes, "application/octet-stream");
    const read = await sandboxReadBytes(REF_A, "bin/data.bin");
    expect(Array.from(read)).toEqual([1, 2, 3, 4, 5]);
  });

  it("adapterRef 完全隔离", async () => {
    await sandboxWriteText(REF_A, "a.txt", "AAA");
    await sandboxWriteText(REF_B, "a.txt", "BBB");
    expect(await sandboxReadText(REF_A, "a.txt")).toBe("AAA");
    expect(await sandboxReadText(REF_B, "a.txt")).toBe("BBB");
    expect((await sandboxListDirectory(REF_A, "")).length).toBe(1);
    expect((await sandboxListDirectory(REF_B, "")).length).toBe(1);
  });

  it("list directory 只返回直接子项", async () => {
    await sandboxWriteText(REF_A, "top.md", "t");
    await sandboxWriteText(REF_A, "sub/inner.md", "i");
    const items = await sandboxListDirectory(REF_A, "");
    const names = items.map((i) => i.name).sort();
    expect(names).toEqual(["sub", "top.md"]);
  });
});

describe("read bounds", () => {
  it("startLine/endLine/maxChars 边界", () => {
    const content = "l1\nl2\nl3\nl4\nl5";
    expect(applyReadBounds(content, { startLine: 2, endLine: 4 }).text).toBe("l2\nl3\nl4");
    const b = applyReadBounds(content, { maxChars: 6 });
    expect(b.text).toBe("l1\nl2\n");
    expect(b.truncated).toBe(true);
  });

  it("maxChars 上限 24000", () => {
    const r = applyReadBounds("x".repeat(50000), { maxChars: 999999 });
    expect(r.text.length).toBe(24000);
    expect(r.truncated).toBe(true);
  });
});

describe("search / grep", () => {
  const walker = {
    list: async (dir: string) => {
      const all: Record<string, { kind: "file" | "directory"; size: number }> = {
        "": { kind: "directory", size: 0 },
        "a.md": { kind: "file", size: 10 },
        "b.txt": { kind: "file", size: 10 },
        "sub": { kind: "directory", size: 0 },
        "sub/c.md": { kind: "file", size: 10 },
        "img.png": { kind: "file", size: 10 },
      };
      const prefix = dir ? dir + "/" : "";
      return Object.entries(all)
        .filter(([k]) => k.startsWith(prefix) && k !== prefix && !k.slice(prefix.length).includes("/"))
        .map(([k, v]) => ({ name: k.slice(prefix.length), ...v }));
    },
    readText: async (p: string) =>
      p.includes("a.md") ? "hello world\n你好 world" : p.includes("c.md") ? "other content hello" : "no match here",
  };

  it("search_files 按文件名匹配（含子目录 + truncated）", async () => {
    const r = await searchFiles(walker, { query: "c.md", maxResults: 2 });
    expect(r.results.map((x) => x.path)).toContain("sub/c.md");
    expect(r.truncated).toBe(false);
    const q = await searchFiles(walker, { query: "md", maxResults: 1 });
    expect(q.results.length).toBe(1);
    expect(q.truncated).toBe(true);
  });

  it("grep_files literal 搜索（非正则，跳过非文本）", async () => {
    const r = await grepFiles(walker, { query: "hello" });
    const paths = r.matches.map((m) => m.path);
    expect(paths).toContain("a.md");
    expect(paths).toContain("sub/c.md");
    expect(paths).not.toContain("img.png");
    // literal：正则元字符不展开
    const none = await grepFiles(walker, { query: "he.llo" });
    expect(none.matches.length).toBe(0);
  });

  it("query 长度限制", () => {
    expect(() => matchesFileName("x".repeat(121), "x", "x")).toThrow(ComputerError);
  });
});

describe("exact patch", () => {
  it("0 匹配 PATCH_CONFLICT / >1 PATCH_AMBIGUOUS / 恰 1 应用", () => {
    expect(() => applyExactPatches("abc", [{ oldText: "xyz", newText: "q" }])).toThrowError(
      expect.objectContaining({ code: "PATCH_CONFLICT" })
    );
    expect(() => applyExactPatches("ab ab", [{ oldText: "ab", newText: "q" }])).toThrowError(
      expect.objectContaining({ code: "PATCH_AMBIGUOUS" })
    );
    const r = applyExactPatches("hello world", [{ oldText: "world", newText: "classflow" }]);
    expect(r.content).toBe("hello classflow");
    expect(r.changeCount).toBe(1);
  });

  it("多 edits 全部验证后一次性应用", () => {
    const r = applyExactPatches("a\nb\nc", [
      { oldText: "a", newText: "A" },
      { oldText: "c", newText: "C" },
    ]);
    expect(r.content).toBe("A\nb\nC");
    expect(r.changeCount).toBe(2);
  });
});

describe("path root scope", () => {
  it("allowRoot：'.' 解析为 root；普通路径仍严格", () => {
    expect(normalizeRelativeComputerPath(".", { allowRoot: true }).path).toBe("");
    expect(normalizeScopePath("")).toBe("");
    expect(normalizeScopePath("a/b")).toBe("a/b");
    expect(() => normalizeRelativeComputerPath("../x")).toThrow(ComputerError);
    expect(() => normalizeRelativeComputerPath(".", { allowRoot: false })).toThrow(ComputerError);
  });
});
