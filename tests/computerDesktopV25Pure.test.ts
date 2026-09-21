// @vitest-environment node
import { describe, it, expect } from "vitest";
import { normalizeActionInput } from "@/src/main/computer/observation";
import { classifyGuiAction } from "@/lib/ai/computer/gui/risk";
import { isSystemFileDialog } from "@/src/main/computer/upload";

describe("V2.5 归一化 — hover / right_click", () => {
  it("接受 elementId / normalized；必须携带 observationId", () => {
    const hover = normalizeActionInput({
      action: "hover",
      observationId: "obs-11111111-2222-3333-4444-555555555555",
      target: { elementId: "el-2" },
    });
    expect(hover.action).toBe("hover");
    expect(hover.target).toEqual({ elementId: "el-2" });

    const rightClick = normalizeActionInput({
      action: "right_click",
      observationId: "obs-11111111-2222-3333-4444-555555555555",
      target: { normalized: { x: 0.5, y: 0.5 } },
    });
    expect(rightClick.target).toEqual({ normalized: { x: 0.5, y: 0.5 } });

    expect(() => normalizeActionInput({ action: "hover", target: { elementId: "el-2" } })).toThrow();
    expect(() => normalizeActionInput({ action: "right_click", observationId: "obs-1", target: { elementId: "el-2" } })).toThrow();
  });

  it("不允许携带 text / key / scroll / wait / to", () => {
    const base = {
      action: "hover",
      observationId: "obs-11111111-2222-3333-4444-555555555555",
      target: { elementId: "el-2" },
    };
    expect(() => normalizeActionInput({ ...base, text: "x" })).toThrow();
    expect(() => normalizeActionInput({ ...base, key: "enter" })).toThrow();
    expect(() => normalizeActionInput({ ...base, to: { elementId: "el-3" } })).toThrow();
  });
});

describe("V2.5 归一化 — 横向滚动 / 拖拽", () => {
  const OBS = "obs-11111111-2222-3333-4444-555555555555";

  it("scroll 接受 axis=horizontal，缺省 vertical", () => {
    const vertical = normalizeActionInput({ action: "scroll", observationId: OBS, scroll: -2 });
    expect(vertical.axis).toBeUndefined();
    const horizontal = normalizeActionInput({
      action: "scroll",
      observationId: OBS,
      scroll: 3,
      axis: "horizontal",
    });
    expect(horizontal.axis).toBe("horizontal");
    expect(() => normalizeActionInput({ action: "scroll", observationId: OBS, scroll: 1, axis: "diagonal" })).toThrow();
    expect(() => normalizeActionInput({ action: "click", observationId: OBS, target: { elementId: "el-1" }, axis: "horizontal" })).toThrow();
  });

  it("drag 必须同时提供 target 与 to（且各自二选一）", () => {
    const drag = normalizeActionInput({
      action: "drag",
      observationId: OBS,
      target: { elementId: "el-1" },
      to: { normalized: { x: 0.8, y: 0.2 } },
    });
    expect(drag.target).toEqual({ elementId: "el-1" });
    expect(drag.to).toEqual({ normalized: { x: 0.8, y: 0.2 } });

    expect(() => normalizeActionInput({ action: "drag", observationId: OBS, target: { elementId: "el-1" } })).toThrow();
    expect(() => normalizeActionInput({ action: "drag", observationId: OBS, to: { elementId: "el-2" } })).toThrow();
    expect(() =>
      normalizeActionInput({
        action: "drag",
        observationId: OBS,
        target: { elementId: "el-1" },
        to: { elementId: "el-2", normalized: { x: 0.1, y: 0.1 } },
      })
    ).toThrow();
  });
});

describe("V2.5 归一化 — 剪贴板", () => {
  it("clipboard 动作无需 observationId", () => {
    const read = normalizeActionInput({ action: "clipboard_read", clipboardAllowed: true });
    expect(read.action).toBe("clipboard_read");
    expect(read.clipboardAllowed).toBe(true);
  });

  it("clipboard_write 必须提供 clipboardText（≤4096）", () => {
    const write = normalizeActionInput({
      action: "clipboard_write",
      clipboardAllowed: true,
      clipboardText: "hello",
    });
    expect(write.clipboardText).toBe("hello");
    expect(() => normalizeActionInput({ action: "clipboard_write", clipboardAllowed: true })).toThrow();
    expect(() =>
      normalizeActionInput({
        action: "clipboard_write",
        clipboardAllowed: true,
        clipboardText: "x".repeat(5000),
      })
    ).toThrow();
  });

  it("clipboard 不允许 target / expect / text", () => {
    expect(() => normalizeActionInput({ action: "clipboard_read", target: { elementId: "el-1" } })).toThrow();
    expect(() =>
      normalizeActionInput({ action: "clipboard_read", expect: { textAppears: "x" } })
    ).toThrow();
    expect(() => normalizeActionInput({ action: "clipboard_read", text: "x" })).toThrow();
  });
});

describe("V2.5 归一化 — 文件上传", () => {
  const OBS = "obs-11111111-2222-3333-4444-555555555555";

  it("fileGrant 只接受相对路径 + 合法 grantId", () => {
    const upload = normalizeActionInput({
      action: "upload_file",
      observationId: OBS,
      fileGrant: { grantId: "grant_abc123", path: "docs\\报告.pdf" },
    });
    expect(upload.fileGrant).toEqual({ grantId: "grant_abc123", path: "docs/报告.pdf" });

    expect(() =>
      normalizeActionInput({
        action: "upload_file",
        observationId: OBS,
        fileGrant: { grantId: "grant_abc123", path: "C:\\secret.txt" },
      })
    ).toThrow();
    expect(() =>
      normalizeActionInput({
        action: "upload_file",
        observationId: OBS,
        fileGrant: { grantId: "grant_abc123", path: "../../escape.txt" },
      })
    ).toThrow();
    expect(() =>
      normalizeActionInput({
        action: "upload_file",
        observationId: OBS,
        fileGrant: { grantId: "../bad", path: "a.txt" },
      })
    ).toThrow();
  });

  it("fileGrant 只能用于 upload_file；upload_file 必须提供 fileGrant", () => {
    expect(() =>
      normalizeActionInput({
        action: "click",
        observationId: OBS,
        target: { elementId: "el-1" },
        fileGrant: { grantId: "grant_abc123", path: "a.txt" },
      })
    ).toThrow();
    expect(() => normalizeActionInput({ action: "upload_file", observationId: OBS })).toThrow();
  });
});

describe("V2.5 风险分类", () => {
  const base = { target: { kind: "element" as const, role: "Button", name: "确定", isPassword: false, appName: "wechat", windowTitle: "微信" } };

  it("hover / right_click → normal（坐标回退仍 external）", () => {
    expect(classifyGuiAction({ action: "hover", ...base }).level).toBe("normal");
    expect(classifyGuiAction({ action: "right_click", ...base }).level).toBe("normal");
    expect(
      classifyGuiAction({ action: "hover", target: { ...base.target, kind: "coordinates" } }).level
    ).toBe("external");
  });

  it("drag → external（ask-once）", () => {
    const decision = classifyGuiAction({ action: "drag", ...base });
    expect(decision.level).toBe("external");
    expect(decision.reason).toContain("拖拽");
  });

  it("剪贴板：未开启 → blocked；开启 → sensitive（写入提示覆盖）", () => {
    expect(classifyGuiAction({ action: "clipboard_read", target: { kind: "none", appName: "", windowTitle: "" } }).level).toBe("blocked");
    expect(
      classifyGuiAction({
        action: "clipboard_read",
        target: { kind: "none", appName: "", windowTitle: "" },
        clipboardAllowed: true,
      }).level
    ).toBe("sensitive");
    const write = classifyGuiAction({
      action: "clipboard_write",
      target: { kind: "none", appName: "", windowTitle: "" },
      clipboardAllowed: true,
    });
    expect(write.level).toBe("sensitive");
    expect(write.reason).toContain("覆盖");
  });

  it("upload_file：非文件对话框 → blocked；文件对话框 → external", () => {
    expect(
      classifyGuiAction({ action: "upload_file", ...base, fileDialog: false }).level
    ).toBe("blocked");
    expect(
      classifyGuiAction({ action: "upload_file", ...base, fileDialog: true }).level
    ).toBe("external");
  });
});

describe("V2.5 文件对话框识别", () => {
  it("标题 + 控件事实双重确认", () => {
    expect(
      isSystemFileDialog({
        appName: "explorer",
        windowTitle: "打开",
        elementNames: ["文件名(N):", "打开(O)", "取消"],
      })
    ).toBe(true);
    expect(
      isSystemFileDialog({
        appName: "winword",
        windowTitle: "另存为",
        elementNames: ["文件名", "保存"],
      })
    ).toBe(true);
    expect(
      isSystemFileDialog({
        appName: "chrome",
        windowTitle: "ClassFlow - Google 搜索",
        elementNames: ["搜索", "登录"],
      })
    ).toBe(false);
    // 标题像对话框但控件树完全没有对话框特征 → 拒绝
    expect(
      isSystemFileDialog({
        appName: "chrome",
        windowTitle: "打开",
        elementNames: ["播放", "暂停"],
      })
    ).toBe(false);
    // 无控件树（未观察 UI 树）→ 仅凭标题
    expect(isSystemFileDialog({ appName: "explorer", windowTitle: "Open" })).toBe(true);
    expect(isSystemFileDialog({ appName: "explorer", windowTitle: "文档.docx - Word" })).toBe(false);
  });
});
