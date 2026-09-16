/**
 * @vitest-environment jsdom
 */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import {
  SHORTCUT_OVERVIEW_ROWS,
  ShortcutOverviewField,
} from "@/components/settings/ShortcutOverviewDialog";

afterEach(() => cleanup());

describe("ShortcutOverviewField 紧凑行 + 二级弹窗", () => {
  it("紧凑行只展示示例与计数，不堆叠全部说明", () => {
    render(<ShortcutOverviewField />);
    expect(screen.getByText("快速新建任务")).toBeTruthy();
    expect(screen.getByText(`等 ${SHORTCUT_OVERVIEW_ROWS.length} 项`)).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看全部快捷键说明" })).toBeTruthy();
    // 臃肿回归：其余说明收进弹窗，行内不渲染
    expect(screen.queryByText("任务列表上下移动")).toBeNull();
    expect(screen.queryByText("预览任务（桌面端）")).toBeNull();
  });

  it("点击查看全部 → 弹窗列出全部快捷键（只读）", () => {
    render(<ShortcutOverviewField />);
    fireEvent.click(screen.getByRole("button", { name: "查看全部快捷键说明" }));
    const dialog = screen.getByTestId("shortcuts-overview-dialog");
    const inDialog = within(dialog);
    for (const row of SHORTCUT_OVERVIEW_ROWS) {
      expect(inDialog.getByText(row.label)).toBeTruthy();
    }
    expect(inDialog.getAllByText("N").length).toBeGreaterThan(0);
  });

  it("关闭弹窗后退出场卸载（portal，无残留）", async () => {
    render(<ShortcutOverviewField />);
    fireEvent.click(screen.getByRole("button", { name: "查看全部快捷键说明" }));
    expect(screen.getByTestId("shortcuts-overview-dialog")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("关闭快捷键说明"));
    await waitFor(
      () => expect(screen.queryByTestId("shortcuts-overview-dialog")).toBeNull(),
      { timeout: 2000 }
    );
  });
});
