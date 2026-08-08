"use client";

import React from "react";

/** 本地数据概览：紧凑 metric grid（非 Dashboard 大 Stat Card） */
export function DataOverview({
  counts,
}: {
  counts: { courses: number; schedules: number; assignments: number; groupProjects: number; materials: number };
}) {
  const rows = [
    { label: "课程", value: counts.courses },
    { label: "排课", value: counts.schedules },
    { label: "任务", value: counts.assignments },
    { label: "项目", value: counts.groupProjects },
    { label: "资料", value: counts.materials },
  ];
  return (
    <div className="p-3 bg-[#F7F5F5] border border-line rounded-xl grid grid-cols-5 gap-2 text-center" data-testid="data-overview">
      {rows.map((r) => (
        <div key={r.label} data-testid={`overview-${r.label}`} className="space-y-0.5">
          <p className="text-sm font-extrabold text-charcoal leading-none">{r.value}</p>
          <p className="text-[10px] text-sandrift">{r.label}</p>
        </div>
      ))}
    </div>
  );
}
