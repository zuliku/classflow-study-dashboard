import { describe, it, expect } from "vitest";
import { computeContextMenuPosition } from "@/lib/contextMenuPosition";

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
