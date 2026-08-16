// @vitest-environment jsdom
/**
 * Native V1：Desktop Bridge detection + grantId 校验 + adapterRef 解析。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isClassFlowDesktopRuntime,
  getClassFlowDesktopBridge,
  getClassFlowDesktopTerminalBridge,
  hasClassFlowDesktopTerminal,
  isValidNativeGrantId,
  isNativeAdapterRef,
  nativeGrantIdFromAdapterRef,
} from "@/lib/desktop/bridge";
import { installMemoryDesktopBridgeMock } from "@/tests/helpers/memoryDesktopBridge";

beforeEach(() => {
  delete (window as unknown as Record<string, unknown>).classflowDesktop;
  delete (window as unknown as Record<string, unknown>).__desktopBridgeControl;
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).classflowDesktop;
  delete (window as unknown as Record<string, unknown>).__desktopBridgeControl;
});

describe("isClassFlowDesktopRuntime / getClassFlowDesktopBridge", () => {
  it("无 bridge → false / null（SSR safe：window 未定义时也返回 false）", () => {
    expect(isClassFlowDesktopRuntime()).toBe(false);
    expect(getClassFlowDesktopBridge()).toBeNull();
  });

  it("version:1 完整 bridge → 可用", () => {
    installMemoryDesktopBridgeMock();
    expect(isClassFlowDesktopRuntime()).toBe(true);
    expect(getClassFlowDesktopBridge()?.version).toBe(1);
  });

  it("version:2（未知版本）→ 不可用（不做猜测兼容）", () => {
    (window as unknown as Record<string, unknown>).classflowDesktop = {
      version: 2,
      platform: "windows",
      filesystem: {},
    };
    expect(isClassFlowDesktopRuntime()).toBe(false);
  });

  it("不完整 bridge（缺 filesystem 方法）→ 不可用", () => {
    (window as unknown as Record<string, unknown>).classflowDesktop = {
      version: 1,
      platform: "windows",
      filesystem: { list: () => {} },
    };
    expect(isClassFlowDesktopRuntime()).toBe(false);
  });

  it("V1.1（0.1）：filesystem 缺 readBytes → bridge invalid（isClassFlowDesktopRuntime false）", () => {
    // 完整方法集（含 readBytes）→ valid
    installMemoryDesktopBridgeMock();
    expect(isClassFlowDesktopRuntime()).toBe(true);
    delete (window as unknown as Record<string, unknown>).classflowDesktop;
    // 去掉 readBytes → invalid
    const full = installMemoryDesktopBridgeMock();
    const b = window.classflowDesktop as unknown as { filesystem: Record<string, unknown> };
    delete b.filesystem.readBytes;
    expect(isClassFlowDesktopRuntime()).toBe(false);
    expect(getClassFlowDesktopBridge()).toBeNull();
    // filesystem-only（无 terminal）仍 valid（V1.1：terminal 是 optional capability）
    delete (window as unknown as Record<string, unknown>).classflowDesktop;
    installMemoryDesktopBridgeMock();
    delete (window.classflowDesktop as { terminal?: unknown }).terminal;
    expect(isClassFlowDesktopRuntime()).toBe(true);
    expect(hasClassFlowDesktopTerminal()).toBe(false);
  });

  it("V1.1：terminal bridge 检测（version=1 完整 → 可用；version=2 / 缺 execute / 缺 cancel → 不可用）", () => {
    installMemoryDesktopBridgeMock();
    expect(hasClassFlowDesktopTerminal()).toBe(true);
    expect(getClassFlowDesktopTerminalBridge()?.version).toBe(1);
    // version=2 → 不可用
    (window.classflowDesktop as { terminal: { version: number } }).terminal.version = 2;
    expect(hasClassFlowDesktopTerminal()).toBe(false);
    // 缺 execute
    (window.classflowDesktop as { terminal: { version: number; execute?: unknown } }).terminal.version = 1;
    delete (window.classflowDesktop as { terminal: { execute?: unknown } }).terminal.execute;
    expect(hasClassFlowDesktopTerminal()).toBe(false);
    // 缺 cancel
    (window.classflowDesktop as { terminal: { execute: unknown; cancel?: unknown } }).terminal.execute = async () => ({});
    delete (window.classflowDesktop as { terminal: { cancel?: unknown } }).terminal.cancel;
    expect(hasClassFlowDesktopTerminal()).toBe(false);
  });
});

describe("isValidNativeGrantId", () => {
  it("合法：字母数字下划线连字符（1–128）", () => {
    expect(isValidNativeGrantId("grant_abc-123")).toBe(true);
    expect(isValidNativeGrantId("6c29f9e4-3b1a-4c5d-8e2f-1234567890ab")).toBe(true);
    expect(isValidNativeGrantId("a")).toBe(true);
    expect(isValidNativeGrantId("x".repeat(128))).toBe(true);
  });

  it("非法：路径样式 / 盘符 / UNC / 超长 / 空 / native: 前缀", () => {
    expect(isValidNativeGrantId("C:\\Users\\x")).toBe(false);
    expect(isValidNativeGrantId("C:/Users/x")).toBe(false);
    expect(isValidNativeGrantId("\\\\server\\share")).toBe(false);
    expect(isValidNativeGrantId("/root/a")).toBe(false);
    expect(isValidNativeGrantId("a/b")).toBe(false);
    expect(isValidNativeGrantId("a\\b")).toBe(false);
    expect(isValidNativeGrantId("a:b")).toBe(false);
    expect(isValidNativeGrantId(".")).toBe(false);
    expect(isValidNativeGrantId("..")).toBe(false);
    expect(isValidNativeGrantId("native:abc")).toBe(false);
    expect(isValidNativeGrantId("")).toBe(false);
    expect(isValidNativeGrantId("x".repeat(129))).toBe(false);
    expect(isValidNativeGrantId(123)).toBe(false);
    expect(isValidNativeGrantId(null)).toBe(false);
  });
});

describe("isNativeAdapterRef / nativeGrantIdFromAdapterRef", () => {
  it("native:<grantId> 严格解析", () => {
    expect(isNativeAdapterRef("native:grant_abc-123")).toBe(true);
    expect(nativeGrantIdFromAdapterRef("native:grant_abc-123")).toBe("grant_abc-123");
  });

  it("非 native / 非法 grant 拒绝", () => {
    expect(isNativeAdapterRef("browser-grant-xxx")).toBe(false);
    expect(nativeGrantIdFromAdapterRef("browser-grant-xxx")).toBeNull();
    expect(isNativeAdapterRef("sandbox-default")).toBe(false);
    expect(nativeGrantIdFromAdapterRef("native:C:\\Users\\x")).toBeNull();
    expect(nativeGrantIdFromAdapterRef("native:a/b")).toBeNull();
    expect(nativeGrantIdFromAdapterRef("native:")).toBeNull();
    expect(nativeGrantIdFromAdapterRef("native:..")).toBeNull();
    expect(nativeGrantIdFromAdapterRef("")).toBeNull();
  });
});
