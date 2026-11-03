// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

vi.mock("@/lib/backupPackage", () => ({
  checkMaterialAvailability: vi.fn(async () => ({ total: 0, available: 0, missing: [] })),
}));

vi.mock("@/lib/ai/computer/artifacts/db", () => ({
  artifactDbStats: vi.fn(async () => ({ artifacts: 3, sources: 2 })),
}));

import { DataHealth } from "@/components/settings/DataHealth";
import { useAppStore } from "@/store/useAppStore";
import { artifactDbStats } from "@/lib/ai/computer/artifacts/db";

const statsMock = vi.mocked(artifactDbStats);

describe("DataHealth 存储诊断", () => {
  beforeEach(() => {
    cleanup();
    useAppStore.setState({
      courses: [],
      schedules: [],
      assignments: [],
      calendarMarks: [],
      groupProjects: [],
    } as never);
    statsMock.mockResolvedValue({ artifacts: 3, sources: 2 });
  });

  afterEach(() => {
    cleanup();
  });

  it("展示 IndexedDB 可用性与 Artifact registry 记录数（只 count）", async () => {
    render(<DataHealth />);
    await waitFor(() => expect(screen.getByText("数据状态正常")).toBeTruthy());
    expect(screen.getByText("本地存储可用")).toBeTruthy();
    expect(screen.getByText("3 条记录")).toBeTruthy();
    expect(statsMock).toHaveBeenCalled();
  });

  it("Artifact registry 不可用 → 计入问题数，不显示为 0 条", async () => {
    statsMock.mockResolvedValue(null);
    render(<DataHealth />);
    await waitFor(() => expect(screen.getByText("发现 1 项需要处理")).toBeTruthy());
    expect(screen.getByText("不可用")).toBeTruthy();
    expect(screen.queryByText("0 条记录")).toBeNull();
  });
});
