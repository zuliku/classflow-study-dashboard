// @vitest-environment node
/**
 * 后台静默操作 Phase 1 — worker 与一次性脚本语义对齐（fail loud）。
 *
 * 背景：默认执行路径走常驻 UIA worker（uiaWorkerClient → workerRunNativeGuiAction），
 * 一次性脚本（guiAction.ts）只是 fallback。若两者后台语义漂移：
 * - worker 在后台对无语义 click 做 bounds-click = 抢焦点/打中错误窗口（比不做更糟）；
 * - hover/right_click/drag 在 worker 返回 unsupported-action 而非 foreground-required，
 *   executor 无法给出“请走前台”的正确指引。
 * 本单测锁死两者关键语义串一致，防止再次漂移。
 */
import { describe, it, expect } from "vitest";
import { buildUiaWorkerScript } from "@/src/main/computer/uiaWorkerScript";
import { buildGuiActionScript } from "@/src/main/computer/guiAction";

describe("uiaWorker 与 guiAction 后台语义对齐", () => {
  it("后台黑名单一致：focus/hover/right_click/drag/key/scroll/double_click", () => {
    const worker = buildUiaWorkerScript();
    const once = buildGuiActionScript({ hwnd: 1, nativeRef: null, action: "click" });
    const blockList = "@('focus','hover','right_click','drag','key','scroll','double_click')";
    expect(worker).toContain(blockList);
    expect(once).toContain(blockList);
  });

  it("worker 含 hover/right_click/drag 前台分支（与一次性脚本同方法名）", () => {
    const worker = buildUiaWorkerScript();
    expect(worker).toContain("Move-And-RightClick");
    expect(worker).toContain("Move-And-Drag");
    expect(worker).toContain("Move-To");
    expect(worker).toContain("GetWindowRect");
    expect(worker).toContain("In-Window");
    expect(worker).toContain("outside-window");
    expect(worker).toContain("right-click");
    expect(worker).toContain("'drag'");
    expect(worker).toContain("scroll-horizontal");
    expect(worker).toContain("horizontal");
  });

  it("worker click 无语义时后台 fail loud（绝不 bounds-click）", () => {
    const worker = buildUiaWorkerScript();
    // click 语义回退前必须有 background → foreground-required 守卫
    expect(worker).toContain("uia-select");
    expect(worker).toContain("uia-invoke");
    expect(worker).toContain("foreground-required");
    expect(worker).toContain("window-minimized");
    expect(worker).toContain("verify-failed");
    // hover/right_click 同样需要元素（与一次性脚本一致）
    expect(worker).toContain("@('click','double_click','focus','hover','right_click')");
  });

  it("worker type 回读复核与 disabled 判定与一次性脚本一致", () => {
    const worker = buildUiaWorkerScript();
    expect(worker).toContain("uia-setvalue");
    expect(worker).toContain("password-field");
    expect(worker).toContain("element-disabled");
    expect(worker).toContain("bounds-changed");
    expect(worker).toContain("element-missing");
  });
});
