// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import {
  computeFps,
  shouldShowFpsProbe,
  shouldShowMotionGallery,
} from "@/lib/motionDev";

describe("motionDev 门禁与换算", () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
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

  it("computeFps：500ms 窗口换算 + 除零/非法保护", () => {
    expect(computeFps(30, 500)).toBe(60);
    expect(computeFps(59, 1000)).toBe(59);
    expect(computeFps(0, 500)).toBe(0);
    expect(computeFps(30, 0)).toBe(0);
    expect(computeFps(-1, 500)).toBe(0);
    expect(computeFps(Number.NaN, 500)).toBe(0);
  });
});
