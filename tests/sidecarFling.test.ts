import { describe, it, expect } from "vitest";
import {
  computeFlingVelocity,
  gestureDistance,
  projectFlingPosition,
  FLING_MAX_PROJECTION_PX,
} from "@/lib/ai/ui/sidecarFling";
import { SIDECAR_DEFAULT_SIZE } from "@/lib/ai/ui/sidecarSize";

const VIEWPORT = { width: 1440, height: 900 };

describe("sidecarFling 纯函数", () => {
  it("dt < 8ms（同步事件）→ null，不 fling", () => {
    expect(
      computeFlingVelocity(
        { deltaX: 0, deltaY: 0, t: 1000 },
        { deltaX: -120, deltaY: 60, t: 1000 }
      )
    ).toBeNull();
    expect(
      computeFlingVelocity(
        { deltaX: 0, deltaY: 0, t: 1000 },
        { deltaX: -120, deltaY: 60, t: 1007.9 }
      )
    ).toBeNull();
  });

  it("慢速拖拽 → null（键盘 discrete/点按同理）", () => {
    // 24px 用了 200ms = 0.12px/ms
    expect(
      computeFlingVelocity(
        { deltaX: 0, deltaY: 0, t: 1000 },
        { deltaX: 24, deltaY: 0, t: 1200 }
      )
    ).toBeNull();
  });

  it("果断甩动 → 末速度（px/ms）", () => {
    // 100px / 50ms = 2px/ms
    const v = computeFlingVelocity(
      { deltaX: 0, deltaY: 0, t: 1000 },
      { deltaX: -100, deltaY: 50, t: 1050 }
    );
    expect(v).not.toBeNull();
    expect(v!.vx).toBeCloseTo(-2, 5);
    expect(v!.vy).toBeCloseTo(1, 5);
    expect(v!.speed).toBeCloseTo(Math.hypot(2, 1), 5);
  });

  it("gestureDistance：单采样/空 → 0；双采样 → 首末位移", () => {
    expect(gestureDistance([])).toBe(0);
    expect(gestureDistance([{ deltaX: 5, deltaY: 5, t: 1 }])).toBe(0);
    expect(
      gestureDistance([
        { deltaX: 0, deltaY: 0, t: 1 },
        { deltaX: 3, deltaY: 4, t: 2 },
      ])
    ).toBe(5);
  });

  it("投射方向：屏幕左甩（dx<0）→ right 增大；下甩（dy>0）→ top 增大", () => {
    const next = projectFlingPosition({
      position: { top: 100, right: 100 },
      velocity: { vx: -2, vy: 1, speed: Math.hypot(2, 1) },
      size: SIDECAR_DEFAULT_SIZE,
      viewport: VIEWPORT,
    });
    expect(next.right).toBeGreaterThan(100);
    expect(next.top).toBeGreaterThan(100);
  });

  it("投射封顶 200px：极速甩动不飞出 clamp", () => {
    const next = projectFlingPosition({
      position: { top: 400, right: 400 },
      velocity: { vx: -10, vy: 0, speed: 10 },
      size: SIDECAR_DEFAULT_SIZE,
      viewport: VIEWPORT,
    });
    // 原始投射 10×120=1200px → 封顶 200px：right 400+200=600（clamp 上限内）
    expect(next.right - 400).toBeLessThanOrEqual(FLING_MAX_PROJECTION_PX);
    // 贴边场景：超出 viewport 直接 clamp 到合法值
    const edge = projectFlingPosition({
      position: { top: 40, right: 24 },
      velocity: { vx: 10, vy: -10, speed: Math.hypot(10, 10) },
      size: SIDECAR_DEFAULT_SIZE,
      viewport: VIEWPORT,
    });
    expect(edge.right).toBeGreaterThanOrEqual(24);
    expect(edge.top).toBeGreaterThanOrEqual(40);
  });
});
