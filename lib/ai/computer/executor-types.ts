export interface ComputerAdapterIO {
  list(dirPath: string): Promise<{ name: string; kind: "file" | "directory"; size: number }[]>;
  stat(path: string): Promise<{ kind: "file" | "directory"; size: number; type?: string } | null>;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  createDirectory(path: string): Promise<"created" | "exists">;
  writeText(path: string, content: string, type?: string): Promise<void>;
  writeBytes(path: string, content: Uint8Array, type?: string): Promise<void>;
}
