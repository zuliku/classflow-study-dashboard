import { ComputerError } from "@/lib/ai/computer/errors";
import { normalizeRelativeComputerPath } from "@/lib/ai/computer/workspace/resolver";

/** text-like 文件扩展名（grep 只读这些；pdf/docx/image 不按 UTF-8 文本处理） */
export const TEXT_LIKE_EXTENSIONS = new Set([
  "md", "txt", "csv", "json", "html", "css", "js", "ts", "tsx", "jsx",
  "py", "r", "do", "tex", "yaml", "yml", "xml",
]);

export const GREP_MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MiB

export interface FileEntryMeta {
  name: string;
  kind: "file" | "directory";
  size: number;
  type?: string;
}

export interface DirectoryWalker {
  list(dirPath: string): Promise<FileEntryMeta[]>;
  readText(path: string): Promise<string>;
}

export interface ReadBounds {
  startLine?: number;
  endLine?: number;
  maxChars?: number;
}

export const READ_TEXT_DEFAULT_MAX_CHARS = 12000;
export const READ_TEXT_MAX_CHARS = 24000;

/** 按行切分并应用 startLine/endLine/maxChars 边界 */
export function applyReadBounds(content: string, bounds: ReadBounds): {
  text: string;
  truncated: boolean;
  startLine: number;
  endLine: number;
} {
  const lines = content.split("\n");
  const totalLines = lines.length;
  const startLine = Math.max(1, Math.min(bounds.startLine ?? 1, totalLines));
  const endLine = Math.min(bounds.endLine ?? totalLines, totalLines);
  let text = lines.slice(startLine - 1, endLine).join("\n");
  let truncated = false;
  const maxChars = Math.min(bounds.maxChars ?? READ_TEXT_DEFAULT_MAX_CHARS, READ_TEXT_MAX_CHARS);
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    truncated = true;
  }
  return { text, truncated, startLine, endLine };
}

/** 文件名搜索（含路径匹配）；query 最长 120 */
export function matchesFileName(query: string, name: string, relativePath: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (q.length > 120) throw new ComputerError("FILE_TOO_LARGE", "搜索关键词过长");
  return name.toLowerCase().includes(q) || relativePath.toLowerCase().includes(q);
}

export interface SearchFilesOptions {
  query: string;
  maxResults?: number;
  maxDepth?: number;
}

export interface SearchFilesResult {
  results: { path: string; kind: "file" | "directory" }[];
  truncated: boolean;
}

/** 按文件名递归搜索（walk adapter）；limits：maxResults 30/100、maxDepth 6/10 */
export async function searchFiles(
  walker: DirectoryWalker,
  options: SearchFilesOptions
): Promise<SearchFilesResult> {
  const maxResults = Math.min(options.maxResults ?? 30, 100);
  const maxDepth = Math.min(options.maxDepth ?? 6, 10);
  const results: { path: string; kind: "file" | "directory" }[] = [];

  const visit = async (dirPath: string, depth: number): Promise<boolean> => {
    if (depth > maxDepth) return false;
    const entries = await walker.list(dirPath);
    let stopped = false;
    for (const entry of entries) {
      if (results.length >= maxResults) return true;
      const rel = dirPath ? `${dirPath}/${entry.name}` : entry.name;
      if (matchesFileName(options.query, entry.name, rel)) {
        results.push({ path: rel, kind: entry.kind });
        if (results.length >= maxResults) return true;
      }
      if (entry.kind === "directory") {
        stopped = await visit(rel, depth + 1);
        if (stopped) return true;
      }
    }
    return stopped;
  };

  await visit("", 1);
  return { results, truncated: results.length >= maxResults };
}

export interface GrepFilesOptions {
  query: string;
  maxResults?: number;
  maxFiles?: number;
}

export interface GrepFilesResult {
  matches: { path: string; line: number; snippet: string }[];
  truncated: boolean;
}

/** literal 文本搜索（非 regex）；maxResults 30/100、maxFiles 80/200；text-like 且 <= 2MiB */
export async function grepFiles(
  walker: DirectoryWalker,
  options: GrepFilesOptions
): Promise<GrepFilesResult> {
  const maxResults = Math.min(options.maxResults ?? 30, 100);
  const maxFiles = Math.min(options.maxFiles ?? 80, 200);
  const q = options.query;
  if (!q) throw new ComputerError("UNSUPPORTED_FILE_TYPE", "搜索内容为空");
  const matches: { path: string; line: number; snippet: string }[] = [];
  let filesRead = 0;

  const visit = async (dirPath: string, depth: number): Promise<boolean> => {
    if (depth > 8 || filesRead >= maxFiles) return true;
    const entries = await walker.list(dirPath);
    for (const entry of entries) {
      if (filesRead >= maxFiles || matches.length >= maxResults) return true;
      const rel = dirPath ? `${dirPath}/${entry.name}` : entry.name;
      if (entry.kind === "directory") {
        if (await visit(rel, depth + 1)) return true;
        continue;
      }
      const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
      if (!TEXT_LIKE_EXTENSIONS.has(ext)) continue;
      if (entry.size > GREP_MAX_FILE_BYTES) continue;
      filesRead += 1;
      let content: string;
      try {
        content = await walker.readText(rel);
      } catch {
        continue;
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (matches.length >= maxResults) break;
        if (lines[i].includes(q)) {
          matches.push({ path: rel, line: i + 1, snippet: lines[i].slice(0, 200) });
        }
      }
    }
    return false;
  };

  await visit("", 1);
  return { matches, truncated: matches.length >= maxResults || filesRead >= maxFiles };
}

/** exact patch 工具：0 匹配 PATCH_CONFLICT、>1 PATCH_AMBIGUOUS、恰 1 应用；返回新内容与变更数 */
export function applyExactPatches(
  content: string,
  edits: { oldText: string; newText: string }[]
): { content: string; changeCount: number } {
  let current = content;
  let changeCount = 0;
  for (const edit of edits) {
    const first = current.indexOf(edit.oldText);
    if (first === -1) {
      throw new ComputerError("PATCH_CONFLICT", "未找到要修改的原文");
    }
    const second = current.indexOf(edit.oldText, first + 1);
    if (second !== -1) {
      throw new ComputerError("PATCH_AMBIGUOUS", "原文在文件中出现多次，请提供更精确的上下文");
    }
    current = current.slice(0, first) + edit.newText + current.slice(first + edit.oldText.length);
    changeCount += 1;
  }
  return { content: current, changeCount };
}

/** 规范化 root scope 路径（allowRoot）：返回 "" 表示 root 本身 */
export function normalizeScopePath(input: string): string {
  return normalizeRelativeComputerPath(input, { allowRoot: true }).path;
}
