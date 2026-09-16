/**
 * @vitest-environment jsdom
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CoursePaletteEditor } from "@/components/settings/CoursePaletteEditor";
import { CustomColorPicker } from "@/components/settings/CustomColorPicker";
import { DEFAULT_PREFERENCES } from "@/lib/preferences";
import { hsvToHex } from "@/lib/color";

afterEach(() => cleanup());

function openManager() {
  fireEvent.click(screen.getByRole("button", { name: "管理课程调色板" }));
  expect(screen.getByTestId("course-palette-dialog")).toBeTruthy();
}

describe("CoursePaletteEditor 紧凑行 + 二级弹窗（portal，不被设置滚动区裁剪）", () => {
  it("紧凑行：显示计数 + 管理入口，不使用原生颜色输入，行内无移除按钮", () => {
    const onChange = vi.fn();
    const { container } = render(
      <CoursePaletteEditor value={[...DEFAULT_PREFERENCES.coursePalette]} onChange={onChange} />
    );
    expect(screen.getByText("共 8 色")).toBeTruthy();
    expect(screen.getByRole("button", { name: "管理课程调色板" })).toBeTruthy();
    // 行内不再堆叠全部色块操作
    expect(screen.queryByLabelText(/^移除颜色 /)).toBeNull();
    // 关键回归：彻底移除 Chrome 方形白底原生拾色器
    expect(container.querySelector('input[type="color"]')).toBeNull();
    expect(document.body.querySelector('input[type="color"]')).toBeNull();
  });

  it("点击管理 → 弹窗展示全部色块移除入口", () => {
    const onChange = vi.fn();
    render(
      <CoursePaletteEditor value={[...DEFAULT_PREFERENCES.coursePalette]} onChange={onChange} />
    );
    openManager();
    expect(screen.getAllByLabelText(/^移除颜色 /).length).toBe(8);
  });

  it("弹窗内点击色块右上 × 移除对应颜色（保留顺序）", () => {
    const onChange = vi.fn();
    render(
      <CoursePaletteEditor
        value={["#FADCD9", "#F8E9A1", "#A8E6CF"]}
        onChange={onChange}
      />
    );
    openManager();
    fireEvent.click(screen.getByLabelText("移除颜色 #F8E9A1"));
    expect(onChange).toHaveBeenCalledWith(["#FADCD9", "#A8E6CF"]);
  });

  it("仅剩 1 色时移除按钮禁用（防空调色板导致轮换失效）", () => {
    const onChange = vi.fn();
    render(<CoursePaletteEditor value={["#FADCD9"]} onChange={onChange} />);
    openManager();
    const removeBtn = screen.getByLabelText("移除颜色 #FADCD9");
    expect((removeBtn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(removeBtn);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("添加流程：预设选择 + HEX 确认（大小写归一化）", () => {
    const onChange = vi.fn();
    render(<CoursePaletteEditor value={["#FADCD9"]} onChange={onChange} />);
    openManager();
    // 预设点击写入草稿
    fireEvent.click(screen.getByLabelText("选择预设 #A8E6CF"));
    // HEX 输入框已同步为预设值
    const hexInput = screen.getByLabelText("HEX 颜色") as HTMLInputElement;
    expect(hexInput.value).toBe("#A8E6CF");
    fireEvent.click(screen.getByLabelText("确认添加颜色"));
    expect(onChange).toHaveBeenCalledWith(["#FADCD9", "#A8E6CF"]);
  });

  it("重复颜色给出诚实行内报错且不提交", () => {
    const onChange = vi.fn();
    render(<CoursePaletteEditor value={["#FADCD9"]} onChange={onChange} />);
    openManager();
    const hexInput = screen.getByLabelText("HEX 颜色") as HTMLInputElement;
    fireEvent.change(hexInput, { target: { value: "#fadcd9" } });
    fireEvent.click(screen.getByLabelText("确认添加颜色"));
    expect(screen.getByRole("alert").textContent).toMatch(/已在调色板/);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("关闭弹窗后退出场卸载（portal，无残留）", async () => {
    const onChange = vi.fn();
    render(<CoursePaletteEditor value={["#FADCD9"]} onChange={onChange} />);
    openManager();
    fireEvent.click(screen.getByLabelText("关闭课程调色板"));
    await waitFor(
      () => expect(screen.queryByTestId("course-palette-dialog")).toBeNull(),
      { timeout: 2000 }
    );
  });

  it("自绘取色器：色相条键盘微调同步 HEX 草稿，确认后提交", () => {
    const onChange = vi.fn();
    render(<CoursePaletteEditor value={["#FADCD9"]} onChange={onChange} />);
    openManager();
    expect(screen.getByTestId("custom-color-picker")).toBeTruthy();
    // 空草稿 → 默认取色 h=210；右移 3 度
    fireEvent.keyDown(screen.getByRole("slider", { name: "色相" }), { key: "ArrowRight" });
    const expected = hsvToHex(213, 60, 90);
    const hexInput = screen.getByLabelText("HEX 颜色") as HTMLInputElement;
    expect(hexInput.value).toBe(expected);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("确认添加颜色"));
    expect(onChange).toHaveBeenCalledWith(["#FADCD9", expected]);
  });

  it("自绘取色器：饱和度/明度面板点选输出 HEX（直渲染本体）", () => {
    const onChange = vi.fn();
    render(<CustomColorPicker value="" onChange={onChange} />);
    const pad = screen.getByRole("slider", { name: "颜色饱和度与明度" });
    vi.spyOn(pad, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 200, height: 150, right: 200, bottom: 150, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    // 右下角：满饱和、全黑（默认色相 210）
    pad.dispatchEvent(
      new window.MouseEvent("pointerdown", { clientX: 200, clientY: 150, buttons: 1, bubbles: true, cancelable: true })
    );
    expect(onChange).toHaveBeenCalledWith("#000000");
  });

  it("自绘取色器：面板键盘可达（方向键调饱和度/明度）", () => {
    const onChange = vi.fn();
    render(<CoursePaletteEditor value={["#FADCD9"]} onChange={onChange} />);
    openManager();
    const pad = screen.getByRole("slider", { name: "颜色饱和度与明度" });
    // 默认 h=210/s=60/v=90；左移降 3 饱和度
    fireEvent.keyDown(pad, { key: "ArrowLeft" });
    const hexInput = screen.getByLabelText("HEX 颜色") as HTMLInputElement;
    expect(hexInput.value).toBe(hsvToHex(210, 57, 90));
  });
});
