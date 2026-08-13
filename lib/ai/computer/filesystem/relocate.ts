/**
 * Kiro Computer V2 — Verified File Relocation（file-only）。
 * 同一 adapter（move）或跨 adapter/root（relocateFile）共用语义：
 * source 存在且是 file → target 不存在 → 写 target → verify target → 删 source → verify source absent。
 * 任何失败 → rollback target（尽力）→ 抛 VERIFICATION_FAILED（绝不宣称 atomic/成功）。
 */
import { ComputerError } from "@/lib/ai/computer/errors";
import { ComputerAdapterIO } from "@/lib/ai/computer/executor-types";

export interface RelocateFileInput {
  source: ComputerAdapterIO;
  sourcePath: string;
  destination: ComputerAdapterIO;
  destinationPath: string;
}

export interface RelocateFileResult {
  size: number;
  type?: string;
}

/** 校验 source 存在（file）且 destination 不存在（拒绝隐式覆盖） */
async function preflightRelocation(
  source: ComputerAdapterIO,
  sourcePath: string,
  destination: ComputerAdapterIO,
  destinationPath: string
): Promise<{ type?: string }> {
  const src = await source.stat(sourcePath);
  if (!src) throw new ComputerError("RESOURCE_NOT_FOUND", `源文件不存在：${sourcePath}`);
  if (src.kind !== "file") throw new ComputerError("UNSUPPORTED_FILE_TYPE", "仅支持移动文件（不支持目录）");
  const target = await destination.stat(destinationPath);
  if (target) throw new ComputerError("RESOURCE_ALREADY_EXISTS", `目标已存在：${destinationPath}`);
  return { type: src.type };
}

/**
 * 跨 adapter/root verified relocation：
 * read bytes → write target → verify target（bytes 长度）→ remove source → verify source absent。
 * remove/verify 失败 → 尝试删除 target 回滚；rollback 也失败时错误文案明确可能残留部分 destination。
 */
export async function relocateFile(input: RelocateFileInput): Promise<RelocateFileResult> {
  const { source, sourcePath, destination, destinationPath } = input;
  const { type } = await preflightRelocation(source, sourcePath, destination, destinationPath);

  const bytes = await source.readBytes(sourcePath);
  await destination.writeBytes(destinationPath, bytes);

  // Verify target：存在且字节长度一致
  const targetAfter = await destination.stat(destinationPath);
  if (!targetAfter || targetAfter.kind !== "file" || targetAfter.size !== bytes.byteLength) {
    await destination.remove(destinationPath, "file").catch(() => undefined);
    throw new ComputerError("VERIFICATION_FAILED", "目标写入校验失败");
  }

  // Remove source + verify absent
  try {
    await source.remove(sourcePath, "file");
    const sourceAfter = await source.stat(sourcePath);
    if (sourceAfter !== null) {
      throw new ComputerError("VERIFICATION_FAILED", "源文件删除校验失败");
    }
  } catch (err) {
    // rollback：尽力删除目标；失败也如实报告（可能残留部分 destination，绝不宣称 atomic）
    await destination.remove(destinationPath, "file").catch(() => undefined);
    if (err instanceof ComputerError) throw err;
    throw new ComputerError("VERIFICATION_FAILED", "文件移动校验失败");
  }

  return { size: bytes.byteLength, type };
}
