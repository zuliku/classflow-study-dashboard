import { describe, it, expect } from "vitest";
import {
  DEFAULT_SIDECAR_MINIMIZED_POSITION,
  SIDECAR_MINIMIZED_MARGIN,
  SIDECAR_MINIMIZED_SIZE,
  normalizeSidecarMinimizedPosition,
  clampSidecarMinimizedPosition,
  clampSidecarMinimizedGeometry,
} from "@/lib/ai/ui/sidecarMinimizedPosition";

describe("Sidecar Minimized Position Domain", () => {
  it("1. default：right=24 bottom=24", () => {
    expect(DEFAULT_SIDECAR_MINIMIZED_POSITION).toEqual({ right: 24, bottom: 24 });
    expect(SIDECAR_MINIMIZED_MARGIN).toBe(24);
    expect(SIDECAR_MINIMIZED_SIZE).toEqual({ width: 176, height: 46 });
  });

  it("2. left clamp（right 过大 → right 被限制，left ≥24）", () => {
    const viewport = { width: 1440, height: 900 };
    const pos = { right: 10000, bottom: 24 };
    const clamped = clampSidecarMinimizedPosition(pos, viewport);
    const maxRight = viewport.width - SIDECAR_MINIMIZED_SIZE.width - SIDECAR_MINIMIZED_MARGIN;
    expect(clamped.right).toBe(maxRight);
    expect(clamped.bottom).toBe(24);
    // left = viewport.width - right - width ≥24
    expect(viewport.width - clamped.right - SIDECAR_MINIMIZED_SIZE.width).toBeGreaterThanOrEqual(24);
  });

  it("3. right clamp（right 过小）", () => {
    const viewport = { width: 1440, height: 900 };
    const clamped = clampSidecarMinimizedPosition({ right: 0, bottom: 24 }, viewport);
    expect(clamped.right).toBe(SIDECAR_MINIMIZED_MARGIN);
  });

  it("4. top clamp（bottom 过大 → bottom 被限制，top ≥24）", () => {
    const viewport = { width: 1440, height: 900 };
    const clamped = clampSidecarMinimizedPosition({ right: 24, bottom: 10000 }, viewport);
    const maxBottom = viewport.height - SIDECAR_MINIMIZED_SIZE.height - SIDECAR_MINIMIZED_MARGIN;
    expect(clamped.bottom).toBe(maxBottom);
    expect(viewport.height - clamped.bottom - SIDECAR_MINIMIZED_SIZE.height).toBeGreaterThanOrEqual(24);
  });

  it("5. bottom clamp（bottom 过小）", () => {
    const viewport = { width: 1440, height: 900 };
    const clamped = clampSidecarMinimizedPosition({ right: 24, bottom: 0 }, viewport);
    expect(clamped.bottom).toBe(SIDECAR_MINIMIZED_MARGIN);
  });

  it("6. very small viewport（小于 capsule）→ 安全退化，不产生 NaN/负无穷", () => {
    const tiny = { width: 100, height: 80 };
    const clamped = clampSidecarMinimizedPosition({ right: 1000, bottom: 1000 }, tiny);
    expect(Number.isFinite(clamped.right)).toBe(true);
    expect(Number.isFinite(clamped.bottom)).toBe(true);
    expect(clamped.right).toBe(SIDECAR_MINIMIZED_MARGIN);
    expect(clamped.bottom).toBe(SIDECAR_MINIMIZED_MARGIN);
    // clampSidecarMinimizedGeometry 同样安全
    const geo = clampSidecarMinimizedGeometry({ right: 500, bottom: 500 }, tiny);
    expect(geo.right).toBe(SIDECAR_MINIMIZED_MARGIN);
    expect(geo.bottom).toBe(SIDECAR_MINIMIZED_MARGIN);
  });

  it("7. NaN normalization → default", () => {
    expect(normalizeSidecarMinimizedPosition({ right: NaN, bottom: NaN })).toEqual(DEFAULT_SIDECAR_MINIMIZED_POSITION);
    expect(normalizeSidecarMinimizedPosition({ right: NaN, bottom: 24 }).right).toBe(24);
    expect(normalizeSidecarMinimizedPosition(null as unknown as object)).toEqual(DEFAULT_SIDECAR_MINIMIZED_POSITION);
    expect(normalizeSidecarMinimizedPosition(undefined as unknown as object)).toEqual(DEFAULT_SIDECAR_MINIMIZED_POSITION);
  });

  it("8. Infinity normalization → default/margin", () => {
    expect(normalizeSidecarMinimizedPosition({ right: Infinity, bottom: Infinity })).toEqual(DEFAULT_SIDECAR_MINIMIZED_POSITION);
    expect(normalizeSidecarMinimizedPosition({ right: -Infinity, bottom: 100 })).toEqual({ right: 24, bottom: 100 });
    expect(normalizeSidecarMinimizedPosition({ right: 50, bottom: -Infinity })).toEqual({ right: 50, bottom: 24 });
  });

  it("9. negative persisted values → margin", () => {
    expect(normalizeSidecarMinimizedPosition({ right: -100, bottom: -5 })).toEqual({ right: 24, bottom: 24 });
    const viewport = { width: 1440, height: 900 };
    const clamped = clampSidecarMinimizedPosition({ right: -10, bottom: -10 }, viewport);
    expect(clamped.right).toBe(24);
    expect(clamped.bottom).toBe(24);
  });

  it("10. huge persisted values → viewport clamp", () => {
    const viewport = { width: 1440, height: 900 };
    const huge = normalizeSidecarMinimizedPosition({ right: 1e9, bottom: 1e9 });
    expect(huge.right).toBe(1e9);
    expect(huge.bottom).toBe(1e9);
    const clamped = clampSidecarMinimizedPosition(huge, viewport);
    const maxRight = viewport.width - SIDECAR_MINIMIZED_SIZE.width - SIDECAR_MINIMIZED_MARGIN;
    const maxBottom = viewport.height - SIDECAR_MINIMIZED_SIZE.height - SIDECAR_MINIMIZED_MARGIN;
    expect(clamped.right).toBe(maxRight);
    expect(clamped.bottom).toBe(maxBottom);
  });

  it("partial object / string → default", () => {
    expect(normalizeSidecarMinimizedPosition({ right: 50 } as unknown as object)).toEqual({ right: 50, bottom: 24 });
    expect(normalizeSidecarMinimizedPosition({ bottom: 50 } as unknown as object)).toEqual({ right: 24, bottom: 50 });
    expect(normalizeSidecarMinimizedPosition("invalid" as unknown as object)).toEqual(DEFAULT_SIDECAR_MINIMIZED_POSITION);
    expect(normalizeSidecarMinimizedPosition({ right: "50" as unknown as number, bottom: 24 })).toEqual({ right: 24, bottom: 24 });
  });
});
