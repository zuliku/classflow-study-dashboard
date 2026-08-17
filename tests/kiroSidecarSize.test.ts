/**
 * Kiro Sidecar 尺寸逻辑（UX V2）测试：clamp / resize / 持久化归一。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  SIDECAR_DEFAULT_SIZE,
  SIDECAR_MIN_WIDTH,
  SIDECAR_MIN_HEIGHT,
  clampSidecarSize,
  resizeSidecarSize,
  normalizeSidecarSize,
} from "@/lib/ai/ui/sidecarSize";
import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";

const VIEWPORT = { width: 1440, height: 900 };

describe("clampSidecarSize", () => {
  it("默认尺寸在正常 viewport 内保持不变", () => {
    expect(clampSidecarSize(SIDECAR_DEFAULT_SIZE, VIEWPORT)).toEqual(SIDECAR_DEFAULT_SIZE);
  });

  it("低于 min → 抬升到 min（min-width 420 / min-height 560）", () => {
    expect(clampSidecarSize({ width: 200, height: 300 }, VIEWPORT)).toEqual({
      width: SIDECAR_MIN_WIDTH,
      height: SIDECAR_MIN_HEIGHT,
    });
  });

  it("超过 viewport 边界（各留 24px）→ 收缩到可显示范围", () => {
    const big = clampSidecarSize({ width: 3000, height: 3000 }, VIEWPORT);
    expect(big.width).toBe(1440 - 48);
    expect(big.height).toBe(900 - 48);
  });

  it("窗口过小：收缩到可显示范围（max 不低于 min，不溢出）", () => {
    // viewport 500×400：maxWidth = max(420, 500-48=452) = 452；maxHeight = max(560, 400-48=352) = 560
    const r = clampSidecarSize({ width: 600, height: 700 }, { width: 500, height: 400 });
    expect(r.width).toBe(452);
    expect(r.height).toBe(560);
  });

  it("取整", () => {
    const r = clampSidecarSize({ width: 620.6, height: 760.4 }, VIEWPORT);
    expect(r.width).toBe(621);
    expect(r.height).toBe(760);
  });
});

describe("resizeSidecarSize（拖拽增量）", () => {
  it("左边缘：dx>0（向右拉）→ 变窄", () => {
    const r = resizeSidecarSize(SIDECAR_DEFAULT_SIZE, { deltaWidth: -40, deltaHeight: 0 }, VIEWPORT);
    expect(r.width).toBe(620 - 40);
  });

  it("底边：dy>0（向下拉）→ 变高", () => {
    const r = resizeSidecarSize(SIDECAR_DEFAULT_SIZE, { deltaWidth: 0, deltaHeight: 60 }, VIEWPORT);
    expect(r.height).toBe(760 + 60);
  });

  it("左下角：宽高同时变", () => {
    const r = resizeSidecarSize(SIDECAR_DEFAULT_SIZE, { deltaWidth: -80, deltaHeight: 40 }, VIEWPORT);
    expect(r.width).toBe(620 - 80);
    expect(r.height).toBe(760 + 40);
  });

  it("受 min 限制：无限缩小停在 min", () => {
    const r = resizeSidecarSize(SIDECAR_DEFAULT_SIZE, { deltaWidth: -10000, deltaHeight: -10000 }, VIEWPORT);
    expect(r.width).toBe(SIDECAR_MIN_WIDTH);
    expect(r.height).toBe(SIDECAR_MIN_HEIGHT);
  });

  it("受 viewport 上限限制：无限放大停在 max", () => {
    const r = resizeSidecarSize(SIDECAR_DEFAULT_SIZE, { deltaWidth: 10000, deltaHeight: 10000 }, VIEWPORT);
    expect(r.width).toBe(1440 - 48);
    expect(r.height).toBe(900 - 48);
  });
});

describe("normalizeSidecarSize（持久化 hydrate）", () => {
  it("非法 / 缺失 → 默认值", () => {
    expect(normalizeSidecarSize(undefined)).toEqual(SIDECAR_DEFAULT_SIZE);
    expect(normalizeSidecarSize({ width: "x", height: null })).toEqual(SIDECAR_DEFAULT_SIZE);
    expect(normalizeSidecarSize({})).toEqual(SIDECAR_DEFAULT_SIZE);
  });

  it("合法值保留（仅 min 下限）", () => {
    expect(normalizeSidecarSize({ width: 700, height: 800 })).toEqual({ width: 700, height: 800 });
    expect(normalizeSidecarSize({ width: 100, height: 100 })).toEqual({
      width: SIDECAR_MIN_WIDTH,
      height: SIDECAR_MIN_HEIGHT,
    });
  });
});

describe("useKiroPreferencesStore.sidecarSize", () => {
  beforeEach(() => {
    useKiroPreferencesStore.setState({ sidecarSize: SIDECAR_DEFAULT_SIZE });
  });

  it("setSidecarSize 持久化到 store（可再读取）", () => {
    useKiroPreferencesStore.getState().setSidecarSize({ width: 700, height: 800 });
    expect(useKiroPreferencesStore.getState().sidecarSize).toEqual({ width: 700, height: 800 });
  });

  it("非法尺寸被归一（min 下限）", () => {
    useKiroPreferencesStore.getState().setSidecarSize({ width: 10, height: 10 });
    expect(useKiroPreferencesStore.getState().sidecarSize.width).toBe(SIDECAR_MIN_WIDTH);
    expect(useKiroPreferencesStore.getState().sidecarSize.height).toBe(SIDECAR_MIN_HEIGHT);
  });
});
