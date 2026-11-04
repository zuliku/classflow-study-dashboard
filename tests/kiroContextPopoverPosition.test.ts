import { describe, expect, it } from "vitest";
import { computeAnchoredPopoverX } from "@/lib/ai/ui/contextPopoverPosition";

/**
 * Kiro ContextBar +N Popover 定位回归：
 * 窄 Sidecar 中按钮靠近右缘时，弹层必须整体留在 ContextBar 边界内，
 * 不能固定 left-0 被 Shell 的 overflow-hidden 裁切。
 */
describe("computeAnchoredPopoverX", () => {
  const boundary = { boundaryLeft: 849, boundaryRight: 1243 };
  const width = 280;

  it("左侧空间充足：左缘对齐按钮左缘", () => {
    const result = computeAnchoredPopoverX({
      anchorLeft: 860,
      anchorRight: 888,
      ...boundary,
      width,
    });
    expect(result).toEqual({ left: 860, transformOriginX: "left" });
  });

  it("靠近右缘：向左收，弹层右缘保留 4px 安全间距", () => {
    const result = computeAnchoredPopoverX({
      anchorLeft: 1057,
      anchorRight: 1085,
      ...boundary,
      width,
    });
    expect(result.left).toBe(1243 - width - 4);
    expect(result.left + width).toBe(1239);
    expect(result.transformOriginX).toBe("left");
  });

  it("锚点在最右侧：不会越过左边界", () => {
    const result = computeAnchoredPopoverX({
      anchorLeft: 1230,
      anchorRight: 1243,
      ...boundary,
      width,
    });
    expect(result.left).toBe(1243 - width - 4);
    expect(result.transformOriginX).toBe("right");
  });

  it("边界比弹层还窄：保底左缘安全间距，不产生负坐标", () => {
    const result = computeAnchoredPopoverX({
      anchorLeft: 500,
      anchorRight: 528,
      boundaryLeft: 849,
      boundaryRight: 900,
      width,
      padding: 4,
    });
    expect(result.left).toBe(853);
  });

  it("锚点位于弹层右半：缩放原点切到 right", () => {
    const result = computeAnchoredPopoverX({
      anchorLeft: 1200,
      anchorRight: 1228,
      boundaryLeft: 849,
      boundaryRight: 1243,
      width,
    });
    // left = 959，弹层中心 1099，锚点中心 1214 → right
    expect(result.left).toBe(959);
    expect(result.transformOriginX).toBe("right");
  });
});
