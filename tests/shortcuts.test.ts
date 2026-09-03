import { describe, it, expect } from "vitest";
import { SINGLE_KEY_SHORTCUTS, matchesShortcutKey } from "@/lib/shortcuts";
import { SHORTCUT_GUIDE, getCommands } from "@/lib/commands";

/**
 * V5A4 Static Shortcut Truth：canonical 定义 → 展示派生一致性（用户可观察语义）。
 * 不断言源码字符串等 implementation trivia。
 */
describe("SINGLE_KEY_SHORTCUTS 真值", () => {
  it("单键字符与 Runtime 真实行为一致", () => {
    expect(SINGLE_KEY_SHORTCUTS.quickCreateTask).toBe("N");
    expect(SINGLE_KEY_SHORTCUTS.openSearch).toBe("/");
    expect(SINGLE_KEY_SHORTCUTS.openHelp).toBe("?");
    expect(SINGLE_KEY_SHORTCUTS.assignmentMoveDown).toBe("J");
    expect(SINGLE_KEY_SHORTCUTS.assignmentMoveUp).toBe("K");
    expect(SINGLE_KEY_SHORTCUTS.assignmentToggleSelection).toBe("X");
  });

  it("不存在 delete: X 的错误语义（X 是选择，不是删除）", () => {
    const values = Object.values(SINGLE_KEY_SHORTCUTS);
    expect(values).not.toContain("delete");
    const keys = Object.keys(SINGLE_KEY_SHORTCUTS);
    expect(keys).not.toContain("delete");
    expect(SINGLE_KEY_SHORTCUTS.assignmentToggleSelection).toBe("X");
  });
});

describe("matchesShortcutKey 大小写归一", () => {
  it("字母键大小写均匹配", () => {
    expect(matchesShortcutKey("j", "J")).toBe(true);
    expect(matchesShortcutKey("J", "J")).toBe(true);
    expect(matchesShortcutKey("k", "K")).toBe(true);
    expect(matchesShortcutKey("n", "N")).toBe(true);
    expect(matchesShortcutKey("x", "X")).toBe(true);
    expect(matchesShortcutKey("X", "X")).toBe(true);
  });

  it("符号键原样比较", () => {
    expect(matchesShortcutKey("/", "/")).toBe(true);
    expect(matchesShortcutKey("?", "?")).toBe(true);
    expect(matchesShortcutKey("j", "K")).toBe(false);
    expect(matchesShortcutKey("x", "N")).toBe(false);
  });

  it("非法输入不 throw 且返回 false", () => {
    expect(matchesShortcutKey("", "J")).toBe(false);
    expect(matchesShortcutKey("Enter", "J")).toBe(false);
    expect(matchesShortcutKey("J", "")).toBe(false);
  });
});

describe("SHORTCUT_GUIDE 与 canonical 同步（无第二套手写真值）", () => {
  function allItems() {
    return SHORTCUT_GUIDE.flatMap((g) => g.items);
  }

  it("单键展示从 canonical 派生", () => {
    const items = allItems();
    expect(items.some((i) => i.keys === SINGLE_KEY_SHORTCUTS.quickCreateTask && i.label.includes("新建任务"))).toBe(true);
    expect(items.some((i) => i.keys === SINGLE_KEY_SHORTCUTS.openSearch && i.label.includes("搜索"))).toBe(true);
    expect(items.some((i) => i.keys === SINGLE_KEY_SHORTCUTS.openHelp)).toBe(true);
    expect(
      items.some((i) => i.keys === `${SINGLE_KEY_SHORTCUTS.assignmentMoveDown} / ${SINGLE_KEY_SHORTCUTS.assignmentMoveUp}`)
    ).toBe(true);
    expect(items.some((i) => i.keys === SINGLE_KEY_SHORTCUTS.assignmentToggleSelection)).toBe(true);
  });

  it("X 行语义为选择/取消选择，绝非删除", () => {
    const items = allItems();
    const xRows = items.filter((i) => i.keys === SINGLE_KEY_SHORTCUTS.assignmentToggleSelection);
    expect(xRows.length).toBeGreaterThan(0);
    for (const row of xRows) {
      expect(row.label).toContain("选择");
      expect(row.label).not.toContain("删除");
    }
  });

  it("Space 预览行保留（桌面端），Arrow/Enter 基础键保留", () => {
    const items = allItems();
    expect(items.some((i) => i.keys === "Space" && i.label.includes("预览"))).toBe(true);
    expect(items.some((i) => i.keys.includes("↑"))).toBe(true);
    expect(items.some((i) => i.keys === "Enter")).toBe(true);
    expect(items.some((i) => i.keys === "Esc")).toBe(true);
  });

  it("create-task 命令 shortcut 与 canonical 一致", () => {
    const cmd = getCommands().find((c) => c.id === "create-task");
    expect(cmd?.shortcut).toBe(SINGLE_KEY_SHORTCUTS.quickCreateTask);
  });
});
