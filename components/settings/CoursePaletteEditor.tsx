"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ColorSwatch } from "@/components/ui/ColorSwatch";
import { CoursePaletteDialog } from "@/components/settings/CoursePaletteDialog";

/** 紧凑预览最多展示的色块数（其余收进「共 X 色」计数 + 二级弹窗） */
const PREVIEW_COUNT = 5;

/**
 * 课程调色板行内控件（紧凑模式）。
 * - 行内只保留：重叠预览（前 5 色）+「共 X 色」+「管理」入口；
 *   完整增删走二级弹窗（portal，不会被设置滚动区裁剪）。
 * - 空调色板时诚实显示「共 0 色」，管理弹窗内引导添加。
 */
export function CoursePaletteEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const preview = value.slice(0, PREVIEW_COUNT);

  return (
    <span className="inline-flex items-center gap-2.5 min-w-0">
      <span
        className="inline-flex items-center shrink-0"
        aria-hidden="true"
      >
        {preview.length === 0 ? (
          <span className="w-6 h-6 rounded-full border border-dashed border-line-strong inline-block" />
        ) : (
          preview.map((c, i) => (
            <ColorSwatch
              key={c.toUpperCase()}
              color={c}
              size="sm"
              title={c}
              className={i > 0 ? "-ml-2 ring-2 ring-surface rounded-full" : "ring-2 ring-surface rounded-full"}
            />
          ))
        )}
      </span>
      <span className="text-[11px] font-bold text-sandrift tabular-nums whitespace-nowrap">
        共 {value.length} 色
      </span>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setDialogOpen(true)}
        aria-label="管理课程调色板"
        className="h-7 px-2.5 text-[11px]"
      >
        管理
      </Button>
      <CoursePaletteDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        value={value}
        onChange={onChange}
      />
    </span>
  );
}
