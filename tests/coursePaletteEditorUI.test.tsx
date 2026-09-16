/**
 * @vitest-environment jsdom
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { CoursePaletteEditor } from "@/components/settings/CoursePaletteEditor";
import { DEFAULT_PREFERENCES } from "@/lib/preferences";

afterEach(() => cleanup());

describe("CoursePaletteEditor UI（ClassFlow 风格，无原生 input[type=color]）", () => {
  it("渲染当前调色板色块 + 添加按钮，不使用原生颜色输入", () => {
    const onChange = vi.fn();
    const { container } = render(
      <CoursePaletteEditor value={[...DEFAULT_PREFERENCES.coursePalette]} onChange={onChange} />
    );
    // 8 个已有色块均可移除
    expect(screen.getAllByLabelText(/^移除颜色 /).length).toBe(8);
    // 添加按钮存在
    expect(screen.getByLabelText("添加颜色")).toBeTruthy();
    // 关键回归：彻底移除 Chrome 方形白底原生拾色器
    expect(container.querySelector('input[type="color"]')).toBeNull();
  });

  it("点击色块右上 × 移除对应颜色（保留顺序）", () => {
    const onChange = vi.fn();
    render(
      <CoursePaletteEditor
        value={["#FADCD9", "#F8E9A1", "#A8E6CF"]}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByLabelText("移除颜色 #F8E9A1"));
    expect(onChange).toHaveBeenCalledWith(["#FADCD9", "#A8E6CF"]);
  });

  it("仅剩 1 色时移除按钮禁用（防空调色板导致轮换失效）", () => {
    const onChange = vi.fn();
    render(<CoursePaletteEditor value={["#FADCD9"]} onChange={onChange} />);
    const removeBtn = screen.getByLabelText("移除颜色 #FADCD9");
    expect((removeBtn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(removeBtn);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("添加流程：预设选择 + HEX 确认（大小写归一化）", () => {
    const onChange = vi.fn();
    render(<CoursePaletteEditor value={["#FADCD9"]} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("添加颜色"));
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
    fireEvent.click(screen.getByLabelText("添加颜色"));
    const hexInput = screen.getByLabelText("HEX 颜色") as HTMLInputElement;
    fireEvent.change(hexInput, { target: { value: "#fadcd9" } });
    fireEvent.click(screen.getByLabelText("确认添加颜色"));
    expect(screen.getByRole("alert").textContent).toMatch(/已在调色板/);
    expect(onChange).not.toHaveBeenCalled();
  });
});
