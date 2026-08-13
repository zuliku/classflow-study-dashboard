export interface ComputerAdapterIO {
  list(dirPath: string): Promise<{ name: string; kind: "file" | "directory"; size: number }[]>;
  stat(path: string): Promise<{ kind: "file" | "directory"; size: number; type?: string } | null>;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  createDirectory(path: string): Promise<"created" | "exists">;
  writeText(path: string, content: string, type?: string): Promise<void>;
  writeBytes(path: string, content: Uint8Array, type?: string): Promise<void>;
  /** Part 3：Undo 专用（非 Model Tool）：删除单个文件 / 空目录（non-recursive） */
  remove(path: string, kind: "file" | "directory"): Promise<void>;
  /** V2：file-only verified relocation（same adapter；实现层保证 source absent + target present） */
  move(from: string, to: string): Promise<void>;
  /** V3 Part 1：bounded text prefix read（KIRO.md 用；实现必须按 byte prefix，不先读全文再截断） */
  readTextPrefix(path: string, maxBytes: number): Promise<{ text: string; truncated: boolean }>;
}
