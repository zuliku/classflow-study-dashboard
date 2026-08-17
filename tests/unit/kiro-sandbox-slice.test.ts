import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { clearSandboxAdapter, sandboxWriteBytes, sandboxReadBytes } from "@/lib/ai/computer/adapters/sandbox";

const REF = "sandbox-slice-ref";

describe("Sandbox binary exact-byte slice（V2.4 regression）", () => {
  beforeEach(async () => {
    await clearSandboxAdapter(REF);
  });

  it("写入 subarray 视图，读取必须 exactly [1,2,3,4]（不含宿主 buffer 前后字节）", async () => {
    const full = new Uint8Array([99, 1, 2, 3, 4, 88]);
    const sub = full.subarray(1, 5); // 指向宿主 buffer 中部
    await sandboxWriteBytes(REF, "slice.bin", sub, "application/octet-stream");
    const readBack = await sandboxReadBytes(REF, "slice.bin");
    expect(Array.from(readBack)).toEqual([1, 2, 3, 4]);
  });

  it("写入零偏移视图 / 完整 buffer，读取一致", async () => {
    const full = new Uint8Array([7, 8, 9]);
    await sandboxWriteBytes(REF, "full.bin", full, "application/octet-stream");
    expect(Array.from(await sandboxReadBytes(REF, "full.bin"))).toEqual([7, 8, 9]);
    // 宿主 buffer 被后续修改不影响已存 bytes（exact slice 语义）
    full[0] = 0;
    expect(Array.from(await sandboxReadBytes(REF, "full.bin"))).toEqual([7, 8, 9]);
  });
});
