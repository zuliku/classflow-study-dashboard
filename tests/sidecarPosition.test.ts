import { describe, it, expect } from "vitest";
import {
  SIDECAR_DEFAULT_POSITION,
  clampSidecarGeometry,
  clampSidecarPosition,
  clampSidecarSizeAtPosition,
  normalizeSidecarPosition,
} from "@/lib/ai/ui/sidecarPosition";
import { SIDECAR_DEFAULT_SIZE, SIDECAR_MIN_WIDTH, SIDECAR_MIN_HEIGHT } from "@/lib/ai/ui/sidecarSize";

const VIEWPORT = { width: 1440, height: 900 };
const SIZE = SIDECAR_DEFAULT_SIZE; // 620×760

describe("normalizeSidecarPosition", () => {
  it("9. 缺失 / 非法持久化值 → 默认 top24/right24", () => {
    expect(normalizeSidecarPosition(undefined)).toEqual(SIDECAR_DEFAULT_POSITION);
    expect(normalizeSidecarPosition(null)).toEqual(SIDECAR_DEFAULT_POSITION);
    expect(normalizeSidecarPosition("junk")).toEqual(SIDECAR_DEFAULT_POSITION);
    expect(normalizeSidecarPosition({ top: "x", right: 40 })).toEqual({ top: 24, right: 40 });
    expect(normalizeSidecarPosition({ top: 10, right: NaN })).toEqual({ top: 24, right: 24 });
  });

  it("1. default = top24 / right24", () => {
    expect(SIDECAR_DEFAULT_POSITION).toEqual({ top: 24, right: 24 });
    expect(normalizeSidecarPosition({ top: 120, right: 80 })).toEqual({ top: 120, right: 80 });
  });

  it("负值 / 小于 margin 的值被钳到 margin（24）", () => {
    expect(normalizeSidecarPosition({ top: -5, right: 0 })).toEqual({ top: 24, right: 24 });
  });
});

describe("clampSidecarPosition（四边 ≥24px）", () => {
  it("2. 向右拖（dx +100）→ right -100", () => {
    expect(clampSidecarPosition({ top: 24, right: 24 - 100 }, SIZE, VIEWPORT)).toEqual({ top: 24, right: 24 });
    // 无 clamp 冲突：从 124 右移 100 → 24
    expect(clampSidecarPosition({ top: 24, right: 124 }, SIZE, VIEWPORT)).toEqual({ top: 24, right: 124 });
  });

  it("3. 向左拖（dx -100）→ right +100", () => {
    expect(clampSidecarPosition({ top: 24, right: 124 }, SIZE, VIEWPORT)).toEqual({ top: 24, right: 124 });
  });

  it("4. 向下拖（dy +100）→ top +100（未触及 bottom bound）", () => {
    const size = { width: 620, height: 600 }; // maxTop = 900-600-24 = 276
    expect(clampSidecarPosition({ top: 24 + 100, right: 24 }, size, VIEWPORT)).toEqual({ top: 124, right: 24 });
    expect(clampSidecarPosition({ top: 24, right: 124 }, size, VIEWPORT)).toEqual({ top: 24, right: 124 });
  });

  it("5. top clamp 24（向上拖过头）", () => {
    expect(clampSidecarPosition({ top: 24 - 500, right: 24 }, SIZE, VIEWPORT)).toEqual({ top: 24, right: 24 });
  });

  it("6. right clamp 24（向右拖过头）", () => {
    expect(clampSidecarPosition({ top: 24, right: -400 }, SIZE, VIEWPORT)).toEqual({ top: 24, right: 24 });
  });

  it("7. left edge clamp：right <= viewport.width - size.width - 24", () => {
    const maxRight = VIEWPORT.width - SIZE.width - 24; // 796
    expect(clampSidecarPosition({ top: 24, right: 5000 }, SIZE, VIEWPORT)).toEqual({ top: 24, right: maxRight });
  });

  it("8. bottom clamp：top <= viewport.height - size.height - 24", () => {
    const maxTop = VIEWPORT.height - SIZE.height - 24; // 116
    expect(clampSidecarPosition({ top: 5000, right: 24 }, SIZE, VIEWPORT)).toEqual({ top: 116, right: 24 });
  });

  it("窗口过小：不产生 NaN / 负几何（Math.max 兜底）", () => {
    const tiny = { width: 300, height: 400 };
    const pos = clampSidecarPosition({ top: 24, right: 24 }, { width: 620, height: 760 }, tiny);
    expect(Number.isFinite(pos.top)).toBe(true);
    expect(Number.isFinite(pos.right)).toBe(true);
    expect(pos.top).toBeGreaterThanOrEqual(24);
    expect(pos.right).toBeGreaterThanOrEqual(24);
  });
});

describe("clampSidecarSizeAtPosition（position-aware resize）", () => {
  it("面板靠左（right 大）→ 宽度上限 = viewport.width - right - 24", () => {
    const atLeft = { top: 24, right: 500 };
    // 原 clampSidecarSize 上限 1392；position-aware 上限 = 1440 - 500 - 24 = 916
    const next = clampSidecarSizeAtPosition({ width: 1200, height: 760 }, atLeft, VIEWPORT);
    expect(next.width).toBe(916);
  });

  it("底部靠下（top 大）→ 高度上限 = viewport.height - top - 24", () => {
    const atBottom = { top: 300, right: 24 };
    const next = clampSidecarSizeAtPosition({ width: 620, height: 900 }, atBottom, VIEWPORT);
    expect(next.height).toBe(900 - 300 - 24);
  });

  it("min 约束不被 position 破坏", () => {
    const atLeft = { top: 24, right: 1400 };
    const next = clampSidecarSizeAtPosition({ width: 200, height: 200 }, atLeft, VIEWPORT);
    expect(next.width).toBe(SIDECAR_MIN_WIDTH);
    expect(next.height).toBe(SIDECAR_MIN_HEIGHT);
  });
});

describe("clampSidecarGeometry（viewport resize 后确定性修正）", () => {
  it("窗口缩小：size 先按 position clamp，position 再按最终 size 拉回可见区", () => {
    // 用户把面板放到左下（top 大 / right 大）；缩小到仍能容纳 min 尺寸的窗口
    const size = { width: 620, height: 760 };
    const position = { top: 500, right: 400 };
    const small = { width: 900, height: 800 };
    const g = clampSidecarGeometry(size, position, small);
    // size clamp：width ≤ 900-400-24=476；height ≤ 800-500-24=276 → min 560
    expect(g.size).toEqual({ width: 476, height: SIDECAR_MIN_HEIGHT });
    // position clamp：top ≤ 800-560-24=216；right ≤ 900-476-24=400
    expect(g.position.top).toBe(216);
    expect(g.position.right).toBe(400);
    // 四边可见（margin 语义）
    expect(g.position.right + g.size.width).toBeLessThanOrEqual(small.width - 24);
    expect(g.position.top + g.size.height).toBeLessThanOrEqual(small.height - 24);
  });

  it("默认几何在默认 viewport 下不变（backward-compatible）", () => {
    const g = clampSidecarGeometry(SIZE, SIDECAR_DEFAULT_POSITION, VIEWPORT);
    expect(g.size).toEqual(SIZE);
    expect(g.position).toEqual(SIDECAR_DEFAULT_POSITION);
  });
});
