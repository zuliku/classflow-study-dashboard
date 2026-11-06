import { describe, it, expect } from "vitest";
import {
  computeContextMenuPosition,
  computeFloatingPosition,
  computeAnchoredPopoverPosition,
} from "@/lib/contextMenuPosition";

const VW = 1440;
const VH = 900;

describe("computeContextMenuPosition", () => {
  it("默认：菜单左上角贴近鼠标右下方（offset 6）", () => {
    const pos = computeContextMenuPosition({
      anchorX: 400,
      anchorY: 300,
      menuWidth: 220,
      menuHeight: 260,
      viewportWidth: VW,
      viewportHeight: VH,
    });
    expect(pos).toEqual({ x: 406, y: 306 });
  });

  it("右侧边缘右键 → 向左展开", () => {
    const pos = computeContextMenuPosition({
      anchorX: VW - 40,
      anchorY: 300,
      menuWidth: 220,
      menuHeight: 260,
      viewportWidth: VW,
      viewportHeight: VH,
    });
    expect(pos.x).toBe(VW - 40 - 220 - 6);
    expect(pos.y).toBe(306);
  });

  it("底部右键 → 向上展开", () => {
    const pos = computeContextMenuPosition({
      anchorX: 400,
      anchorY: VH - 40,
      menuWidth: 220,
      menuHeight: 260,
      viewportWidth: VW,
      viewportHeight: VH,
    });
    expect(pos.x).toBe(406);
    expect(pos.y).toBe(VH - 40 - 260 - 6);
  });

  it("右下角同时不足 → 向左且向上展开", () => {
    const pos = computeContextMenuPosition({
      anchorX: VW - 10,
      anchorY: VH - 10,
      menuWidth: 220,
      menuHeight: 260,
      viewportWidth: VW,
      viewportHeight: VH,
    });
    expect(pos.x).toBe(VW - 10 - 220 - 6);
    expect(pos.y).toBe(VH - 10 - 260 - 6);
  });

  it("clamp 到 8px 安全边距：永不超出 viewport", () => {
    const pos = computeContextMenuPosition({
      anchorX: 0,
      anchorY: 0,
      menuWidth: 220,
      menuHeight: 260,
      viewportWidth: VW,
      viewportHeight: VH,
    });
    expect(pos.x).toBe(8);
    expect(pos.y).toBe(8);
  });

  it("菜单大于 viewport 时仍保底 8px（不产生负坐标）", () => {
    const pos = computeContextMenuPosition({
      anchorX: 100,
      anchorY: 100,
      menuWidth: 2000,
      menuHeight: 2000,
      viewportWidth: VW,
      viewportHeight: VH,
    });
    expect(pos.x).toBe(8);
    expect(pos.y).toBe(8);
  });

  it("锚点位于左/上边缘时正常 clamp（不翻转、不越界）", () => {
    const pos = computeContextMenuPosition({
      anchorX: 5,
      anchorY: 5,
      menuWidth: 220,
      menuHeight: 260,
      viewportWidth: VW,
      viewportHeight: VH,
    });
    // 右侧/底部空间充足 → 不翻转；默认 anchor+6（11）在安全区内，clamp 后保持
    expect(pos.x).toBe(11);
    expect(pos.y).toBe(11);
  });
});

describe("computeFloatingPosition（Task 6B-A：Attachment Chip Portal Menu）", () => {
  const anchor = { left: 1000, top: 700, right: 1024, bottom: 724 };

  it("preferred=top + align=end：菜单右缘对齐锚点右缘，向上展开", () => {
    const pos = computeFloatingPosition({
      anchorRect: anchor,
      menuWidth: 224,
      menuHeight: 300,
      viewportWidth: VW,
      viewportHeight: VH,
      preferredSide: "top",
      align: "end",
    });
    expect(pos.x).toBe(1024 - 224); // right - menuWidth
    expect(pos.y).toBe(700 - 300 - 8); // top - menuHeight - offset
  });

  it("顶部空间不足 → 自动翻转到锚点下方（bottom）", () => {
    const pos = computeFloatingPosition({
      anchorRect: { left: 100, top: 100, right: 124, bottom: 124 },
      menuWidth: 224,
      menuHeight: 500,
      viewportWidth: VW,
      viewportHeight: VH,
      preferredSide: "top",
      align: "end",
    });
    // 上方空间 100-8=92 < 500；下方 900-124-8=768 ≥ 500 → bottom；
    // x = 124-224 = -100 → clamp 到 8
    expect(pos.y).toBe(124 + 8);
    expect(pos.x).toBe(8);
  });

  it("靠右边缘 → x clamp 到 8px 安全边距", () => {
    const pos = computeFloatingPosition({
      anchorRect: { left: VW - 20, top: 500, right: VW, bottom: 524 },
      menuWidth: 224,
      menuHeight: 200,
      viewportWidth: VW,
      viewportHeight: VH,
      preferredSide: "top",
      align: "end",
    });
    // right(1440) - 224 = 1216，且 1216 + 224 = 1440 > 1440-8 → clamp 到 1440-224-8
    expect(pos.x).toBe(VW - 224 - 8);
    expect(pos.y).toBe(500 - 200 - 8);
  });

  it("两侧都不足 → 选择空间更大的一侧（bottom）；同时受 viewport 底部 clamp 约束", () => {
    const pos = computeFloatingPosition({
      anchorRect: { left: 100, top: 400, right: 124, bottom: 424 },
      menuWidth: 224,
      menuHeight: 500,
      viewportWidth: VW,
      viewportHeight: VH,
      preferredSide: "top",
      align: "end",
    });
    // 上方 392 < 500，下方 468 < 500；下方更大 → bottom(y=432)，
    // 但菜单不越出 viewport 底部：y ≤ 900-500-8=392
    expect(pos.y).toBe(VH - 500 - 8);
  });
});

describe("computeAnchoredPopoverPosition（PopoverPanel Portal：翻转 + clamp）", () => {
  const base = {
    menuWidth: 340,
    menuHeight: 320,
    viewportWidth: VW,
    viewportHeight: VH,
  };

  it("bottom-end：菜单右缘对齐锚点，向下展开；空间不足翻到上方", () => {
    const lower = computeAnchoredPopoverPosition({
      ...base,
      anchorRect: { left: 500, top: 797, right: 560, bottom: 829 },
      placement: "bottom-end",
    });
    // 下方 900-829-8=63 < 320，上方 789 ≥ 320 → top；右缘 560-340=220
    expect(lower.side).toBe("top");
    expect(lower.y).toBe(797 - 320 - 6);
    expect(lower.x).toBe(220);

    const upper = computeAnchoredPopoverPosition({
      ...base,
      anchorRect: { left: 500, top: 100, right: 560, bottom: 132 },
      placement: "bottom-end",
    });
    expect(upper.side).toBe("bottom");
    expect(upper.y).toBe(132 + 6);
  });

  it("top-center：菜单中心对齐锚点中心，并 clamp 到水平安全边距", () => {
    const pos = computeAnchoredPopoverPosition({
      ...base,
      anchorRect: { left: 600, top: 500, right: 640, bottom: 524 },
      placement: "top-center",
    });
    // 中心 620 - 170 = 450
    expect(pos.x).toBe(450);
    expect(pos.y).toBe(500 - 320 - 6);

    const edge = computeAnchoredPopoverPosition({
      ...base,
      anchorRect: { left: 20, top: 500, right: 60, bottom: 524 },
      placement: "top-center",
    });
    expect(edge.x).toBe(8);
  });

  it("bottom-start 右侧溢出 → x clamp 到 viewport 内", () => {
    const pos = computeAnchoredPopoverPosition({
      ...base,
      anchorRect: { left: VW - 40, top: 200, right: VW - 10, bottom: 230 },
      placement: "bottom-start",
    });
    expect(pos.x).toBe(VW - 340 - 8);
    expect(pos.side).toBe("bottom");
  });

  it("right-end：右侧不足翻到左侧；纵向底缘对齐锚点", () => {
    const right = computeAnchoredPopoverPosition({
      ...base,
      anchorRect: { left: 50, top: 200, right: 90, bottom: 230 },
      placement: "right-end",
    });
    expect(right.side).toBe("right");
    expect(right.x).toBe(90 + 6);
    // 底缘对齐锚点会越出顶部 → clamp 到 8
    expect(right.y).toBe(8);

    const left = computeAnchoredPopoverPosition({
      ...base,
      anchorRect: { left: VW - 80, top: 200, right: VW - 40, bottom: 230 },
      placement: "right-end",
    });
    expect(left.side).toBe("left");
    expect(left.x).toBe(VW - 80 - 340 - 6);
  });
});
