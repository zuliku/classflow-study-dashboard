/**
 * Vision Turn Runtime Ledger（V1.3B）测试：
 * - 共享 10 MiB total / 8 MiB PDF / 6 pages（与 direct attachments 同源扣减）
 * - async-exclusive reservation：并发 visual calls 不能 overspend
 * - continuation 不重置；新 Turn 重建
 * - conservative accounting：reservation 后失败不 refund
 */
import { describe, it, expect } from "vitest";
import { createVisionTurnRuntimeBudget } from "@/lib/ai/attachments/visionTurnRuntimeBudget";

const MIB = 1024 * 1024;

describe("createVisionTurnRuntimeBudget", () => {
  it("初始化：直接用户图片 4MiB + 扫描 PDF 3MiB/2页 → total 剩余 3MiB；PDF 子预算 5MiB（min(8,6)-... 语义）", () => {
    const ledger = createVisionTurnRuntimeBudget({
      initialUserImageBytes: 4 * MIB,
      initialPdfBytes: 3 * MIB,
      initialPdfPages: 2,
    });
    // total = 10 - 4 - 3 = 3 MiB
    // pdfBytes = min(8, 10-4) - 3 = 6 - 3 = 3 MiB
    // pdfPages = 6 - 2 = 4
    expect(ledger.remaining().totalBytes).toBe(3 * MIB);
    expect(ledger.remaining().pdfBytes).toBe(3 * MIB);
    expect(ledger.remaining().pdfPages).toBe(4);
    // 实际 Project PDF 最多只能用 min(3,3) = 3 MiB（不能重新得到 8 MiB）
  });

  it("共享 PDF page cap：attachment 已用 4 pages → Project 最多 2 pages", () => {
    const ledger = createVisionTurnRuntimeBudget({ initialPdfPages: 4 });
    expect(ledger.remaining().pdfPages).toBe(2);
  });

  it("image reservation：exclusive 扣减 total；并发 6MiB×2 → 一个成功一个失败（不能都读到旧值）", async () => {
    const ledger = createVisionTurnRuntimeBudget({});
    // 两个 6MiB 并发请求都希望成功；只有一个能拿到
    const results = await Promise.all([
      ledger.reserveImageExclusive(6 * MIB),
      ledger.reserveImageExclusive(6 * MIB),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(ledger.remaining().totalBytes).toBe(4 * MIB);
  });

  it("concurrent visual calls 不能 overspend：3 个并行 4MiB → 最多 2 个成功", async () => {
    const ledger = createVisionTurnRuntimeBudget({});
    const results = await Promise.all([
      ledger.reserveImageExclusive(4 * MIB),
      ledger.reserveImageExclusive(4 * MIB),
      ledger.reserveImageExclusive(4 * MIB),
    ]);
    expect(results.filter(Boolean)).toHaveLength(2);
    expect(ledger.remaining().totalBytes).toBe(2 * MIB);
  });

  it("PDF rasterization exclusive：按实际 rendered pages/bytes 扣减（total + pdf + pages）", async () => {
    const ledger = createVisionTurnRuntimeBudget({ initialPdfPages: 4 });
    await ledger.runPdfRasterizationExclusive(async (rem) => {
      expect(rem.pdfPages).toBe(2); // 6-4
      return { pages: [{ size: MIB }, { size: MIB }] };
    });
    expect(ledger.remaining().pdfPages).toBe(0);
    expect(ledger.remaining().pdfBytes).toBe(8 * MIB - 2 * MIB);
    expect(ledger.remaining().totalBytes).toBe(10 * MIB - 2 * MIB);
  });

  it("continuation 不重置：Tool Output → continuation 的第二次 visual call 看到扣减后的剩余；新 Turn 重新 10MiB", async () => {
    const ledger = createVisionTurnRuntimeBudget({});
    expect(await ledger.reserveImageExclusive(2 * MIB)).toBe(true);
    // continuation 模拟：同一 ledger 继续
    expect(ledger.remaining().totalBytes).toBe(8 * MIB);
    expect(await ledger.reserveImageExclusive(8 * MIB)).toBe(true);
    expect(ledger.remaining().totalBytes).toBe(0);
    // 下一 User Turn：新 ledger → 重新 10 MiB
    const nextLedger = createVisionTurnRuntimeBudget({});
    expect(nextLedger.remaining().totalBytes).toBe(10 * MIB);
  });

  it("conservative：reservation 后不 refund（即使调用方后续失败）", async () => {
    const ledger = createVisionTurnRuntimeBudget({});
    expect(await ledger.reserveImageExclusive(2 * MIB)).toBe(true);
    // 调用方 Provider 失败：不 refund
    expect(ledger.remaining().totalBytes).toBe(8 * MIB);
  });

  it("reservation 前失败不消耗（等价语义：小字节请求失败则 remaining 不变）", async () => {
    const ledger = createVisionTurnRuntimeBudget({ initialUserImageBytes: 9 * MIB });
    // 剩余 1MiB；请求 2MiB → false，且 remaining 不变
    expect(await ledger.reserveImageExclusive(2 * MIB)).toBe(false);
    expect(ledger.remaining().totalBytes).toBe(1 * MIB);
  });
});
