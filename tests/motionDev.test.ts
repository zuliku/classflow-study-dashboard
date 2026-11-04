// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import {
  computeFps,
  summarizeFrameDeltas,
  shouldShowFpsProbe,
  shouldShowMotionGallery,
  resolveMotionEasingPreview,
  shouldUseMotionEasingV5,
  applyMotionEasingPreview,
  MOTION_EASING_STORAGE_KEY,
} from "@/lib/motionDev";

describe("motionDev 门禁与换算", () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    document.documentElement.removeAttribute("data-motion-easing");
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("非 dev 构建：query 再对也关闭（production/test 永不渲染）", () => {
    process.env.NODE_ENV = "production";
    expect(shouldShowMotionGallery("?motion-gallery=1")).toBe(false);
    expect(shouldShowFpsProbe("?motion-fps=1")).toBe(false);
    process.env.NODE_ENV = "test";
    expect(shouldShowMotionGallery("?motion-gallery=1")).toBe(false);
    expect(shouldShowFpsProbe("?motion-fps=1")).toBe(false);
  });

  it("dev 构建：query=1 开启，其他值/缺失关闭", () => {
    process.env.NODE_ENV = "development";
    expect(shouldShowMotionGallery("?motion-gallery=1")).toBe(true);
    expect(shouldShowFpsProbe("?motion-fps=1")).toBe(true);
    expect(shouldShowMotionGallery("")).toBe(false);
    expect(shouldShowMotionGallery("?motion-gallery=0")).toBe(false);
    expect(shouldShowFpsProbe("?foo=1")).toBe(false);
    // 坏 query 不抛
    expect(shouldShowMotionGallery("?%")).toBe(false);
  });

  it("Motion V5 easing 灰度：URL 优先、localStorage 持久化、非 dev 关闭", () => {
    process.env.NODE_ENV = "development";
    expect(resolveMotionEasingPreview("?motion-easing=v5", "v4")).toBe("v5");
    expect(resolveMotionEasingPreview("?motion-easing=v4", "v5")).toBe("v4");
    expect(resolveMotionEasingPreview("", "v5")).toBe("v5");
    expect(resolveMotionEasingPreview("", "v4")).toBe("v4");
    expect(resolveMotionEasingPreview("", null)).toBe("v4");
    expect(resolveMotionEasingPreview("?%", "v5")).toBe("v5");

    expect(shouldUseMotionEasingV5("?motion-easing=v5", null)).toBe(true);
    expect(shouldUseMotionEasingV5("", "v5")).toBe(true);
    expect(shouldUseMotionEasingV5("", "v4")).toBe(false);
    process.env.NODE_ENV = "production";
    expect(shouldUseMotionEasingV5("?motion-easing=v5", null)).toBe(false);
  });

  it("applyMotionEasingPreview：dataset / storage / URL / 事件同步", () => {
    process.env.NODE_ENV = "development";
    const events: boolean[] = [];
    const onEasing = (e: Event) => events.push((e as CustomEvent<boolean>).detail);
    window.addEventListener("classflow:motion-easing-change", onEasing);
    applyMotionEasingPreview(true);
    expect(document.documentElement.dataset.motionEasing).toBe("v5");
    expect(window.localStorage.getItem(MOTION_EASING_STORAGE_KEY)).toBe("v5");
    expect(window.location.search).toContain("motion-easing=v5");
    expect(events).toEqual([true]);

    applyMotionEasingPreview(false);
    expect(document.documentElement.dataset.motionEasing).toBeUndefined();
    expect(window.localStorage.getItem(MOTION_EASING_STORAGE_KEY)).toBe("v4");
    expect(window.location.search).not.toContain("motion-easing=v5");
    expect(events).toEqual([true, false]);
    window.removeEventListener("classflow:motion-easing-change", onEasing);
  });

  it("computeFps：500ms 窗口换算 + 除零/非法保护", () => {
    expect(computeFps(30, 500)).toBe(60);
    expect(computeFps(59, 1000)).toBe(59);
    expect(computeFps(0, 500)).toBe(0);
    expect(computeFps(30, 0)).toBe(0);
    expect(computeFps(-1, 500)).toBe(0);
    expect(computeFps(Number.NaN, 500)).toBe(0);
  });

  it("summarizeFrameDeltas：数量/最差帧/jank 计数 + 非法值保护", () => {
    expect(summarizeFrameDeltas([])).toEqual({ count: 0, worstMs: 0, jank50: 0 });
    expect(summarizeFrameDeltas([16.7, 16.6, 33.3])).toEqual({ count: 3, worstMs: 33.3, jank50: 0 });
    expect(summarizeFrameDeltas([16.7, 83.24, 120])).toEqual({ count: 3, worstMs: 120, jank50: 2 });
    expect(summarizeFrameDeltas([Number.NaN, -5, 16.66])).toEqual({ count: 1, worstMs: 16.7, jank50: 0 });
  });
});
