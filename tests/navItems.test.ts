import { describe, it, expect } from "vitest";
import {
  WORKSPACE_NAV_ITEMS,
  BOTTOM_NAV_MORE,
} from "@/components/layout/navItems";
import { KIRO_PROJECT_ICON } from "@/components/kiro/kiroProjectIcon";
import { Library, Layers, FolderKanban } from "lucide-react";

describe("App Chrome V2.1 — 图标语义", () => {
  it("课程资料 = Library（学习资源库语义；非 FolderKanban）", () => {
    const courses = WORKSPACE_NAV_ITEMS.find((i) => i.id === "courses");
    expect(courses).toBeDefined();
    expect(courses!.icon).toBe(Library);
    expect(courses!.icon).not.toBe(FolderKanban);
  });

  it("Bottom Nav More 的课程入口与工作区导航同源（Library）", () => {
    const courses = BOTTOM_NAV_MORE.find((i) => i.id === "courses");
    expect(courses).toBeDefined();
    expect(courses!.icon).toBe(Library);
    expect(courses!.icon).toBe(WORKSPACE_NAV_ITEMS.find((i) => i.id === "courses")!.icon);
  });

  it("Kiro Project 领域图标 = Layers（AI Context Workspace 语义；非 FolderKanban）", () => {
    expect(KIRO_PROJECT_ICON).toBe(Layers);
    expect(KIRO_PROJECT_ICON).not.toBe(FolderKanban);
  });

  it("其它导航保持原语义（总览/时间表/任务/Kiro）", () => {
    const byId = new Map(WORKSPACE_NAV_ITEMS.map((i) => [i.id, i.icon]));
    expect(byId.get("overview")).not.toBe(Library);
    expect(byId.get("assignments")).not.toBe(Library);
    expect(byId.get("timetable")).not.toBe(Library);
    expect(byId.get("kiro")).not.toBe(Library);
  });
});
