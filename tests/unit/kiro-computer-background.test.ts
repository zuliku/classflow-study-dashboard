import { describe, it, expect } from "vitest";
import {
  BACKGROUND_SEMANTIC_ACTIONS,
  canRunInBackground,
  resolveBackgroundMode,
} from "@/lib/ai/computer/gui/background";

describe("后台模式决策（fail closed）", () => {
  it("click/type 可后台；其余一律前台", () => {
    expect(canRunInBackground("click")).toBe(true);
    expect(canRunInBackground("type")).toBe(true);
    for (const a of [
      "double_click",
      "focus",
      "key",
      "scroll",
      "hover",
      "right_click",
      "drag",
      "wait",
      "clipboard_read",
      "upload_file",
      "nope",
    ]) {
      expect(canRunInBackground(a), a).toBe(false);
    }
    expect(BACKGROUND_SEMANTIC_ACTIONS.has("click")).toBe(true);
  });

  it("consent 缺失 → 前台（默认路径不变）", () => {
    expect(resolveBackgroundMode({ backgroundAllowed: false, action: "click", hasElementTarget: true })).toBe(
      "foreground"
    );
    expect(resolveBackgroundMode({ backgroundAllowed: false, action: "type", hasElementTarget: true })).toBe(
      "foreground"
    );
  });

  it("无元素目标（坐标）→ 前台（遮挡时坐标会打中错误窗口）", () => {
    expect(resolveBackgroundMode({ backgroundAllowed: true, action: "click", hasElementTarget: false })).toBe(
      "foreground"
    );
  });

  it("consent + 语义动作 + 元素目标 → 后台", () => {
    expect(resolveBackgroundMode({ backgroundAllowed: true, action: "click", hasElementTarget: true })).toBe(
      "background"
    );
    expect(resolveBackgroundMode({ backgroundAllowed: true, action: "type", hasElementTarget: true })).toBe(
      "background"
    );
    expect(resolveBackgroundMode({ backgroundAllowed: true, action: "key", hasElementTarget: true })).toBe(
      "foreground"
    );
  });
});
