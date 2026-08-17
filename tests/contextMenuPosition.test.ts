import { describe, it, expect } from "vitest";
import { computeContextMenuPosition, computeFloatingPosition } from "@/lib/contextMenuPosition";

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
