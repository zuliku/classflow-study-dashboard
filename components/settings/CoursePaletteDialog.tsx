"use client";

import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { SettingsInput } from "@/components/settings/SettingsControls";
import { ColorSwatch } from "@/components/ui/ColorSwatch";
import { CustomColorPicker } from "@/components/settings/CustomColorPicker";
import {
  MAX_COURSE_PALETTE_SIZE,
  MIN_COURSE_PALETTE_SIZE,
  normalizeHex,
  paletteIncludes,
} from "@/lib/color";
import { DEFAULT_PREFERENCES } from "@/lib/preferences";

/**
 * 课程调色板二级弹窗（Settings 通用页「课程调色板」行的管理入口）。
 * - 经 Dialog → OverlayLayer portal 直挂 document.body，彻底告别行内 Popover
 *   被 SettingsGroup(overflow-hidden) / Detail 滚动区裁剪的问题。
 * - 增删即时写入偏好；至少保留 1 色、至多 12 色、
 *   重复 HEX 大小写不敏感去重、非法 HEX 行内报错；
 *   页脚提供恢复默认（已是默认时禁用）。
 */
export function CoursePaletteDialog({
  open,
  onOpenChange,
  value,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setDraft("");
      setError(null);
    }
  }, [open ]);

  const normalizedDraft = normalizeHex(draft);
  const isFull = value.length >= MAX_COURSE_PALETTE_SIZE;
  // 重复时保持可点击以便给出诚实报错；仅非法/空/已满时禁用
  const canAdd = normalizedDraft !== null && !isFull;

  const handleAdd = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("请输入 HEX 颜色（如 #A8E6CF）。");
      return;
    }
    const normalized = normalizeHex(trimmed);
    if (!normalized) {
      setError("HEX 格式不正确，示例：#A8E6CF。");
      return;
    }
    if (paletteIncludes(value, normalized)) {
      setError("该颜色已在调色板中。");
      return;
    }
    if (value.length >= MAX_COURSE_PALETTE_SIZE) {
      setError(`最多保留 ${MAX_COURSE_PALETTE_SIZE} 种颜色。`);
      return;
    }
    onChange([...value, normalized]);
    setDraft("");
    setError(null);
    inputRef.current?.focus();
  };

  const handleRemove = (hex: string) => {
    if (value.length <= MIN_COURSE_PALETTE_SIZE) return;
    onChange(value.filter((c) => c.toUpperCase() !== hex.toUpperCase()));
  };

  const isDefault =
    value.length === DEFAULT_PREFERENCES.coursePalette.length &&
    value.every((c, i) => c.toUpperCase() === DEFAULT_PREFERENCES.coursePalette[i].toUpperCase());

  const handleReset = () => {
    onChange([...DEFAULT_PREFERENCES.coursePalette]);
    setDraft("");
    setError(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      overlayId="course-palette-dialog"
      stackZ={60}
      closeOnBackdrop
      trapFocus
      aria-label="管理课程调色板"
      data-testid="course-palette-dialog"
      className="max-w-md max-h-[90dvh] flex flex-col"
    >
      {/* Header */}
      <div className="shrink-0 px-5 py-3.5 border-b border-line-soft flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-charcoal">课程调色板</h3>
          <p className="text-[11px] text-sandrift mt-0.5">
            共 {value.length} / {MAX_COURSE_PALETTE_SIZE} 色 · 新课程从左到右轮换
          </p>
        </div>
        <button
          onClick={() => onOpenChange(false)}
          className="p-1.5 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors shrink-0"
          aria-label="关闭课程调色板"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5 text-xs">
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-sandrift uppercase tracking-wider">当前颜色</p>
          {value.length === 0 ? (
            <p role="alert" className="text-[11px] font-semibold text-danger">
              调色板为空时新课程将使用默认灰色，请至少添加 1 种颜色。
            </p>
          ) : (
            <div className="flex flex-wrap gap-2.5">
              {value.map((c) => (
                <ColorSwatch
                  key={c.toUpperCase()}
                  color={c}
                  size="md"
                  removable
                  removeDisabled={value.length <= MIN_COURSE_PALETTE_SIZE}
                  onRemove={() => handleRemove(c)}
                  title={
                    value.length <= MIN_COURSE_PALETTE_SIZE
                      ? `${c}（至少保留 1 种颜色）`
                      : `${c} · 点击右上 × 移除`
                  }
                />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2.5">
          <p className="text-[10px] font-bold text-sandrift uppercase tracking-wider">添加颜色</p>
          {/* 自定义取色：面板 + 色相条直接写入草稿，HEX 输入框同步显示精确值 */}
          <CustomColorPicker
            value={draft}
            onChange={(hex) => {
              setDraft(hex);
              setError(null);
            }}
          />
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <SettingsInput
                value={draft}
                onChange={(v) => {
                  setDraft(v);
                  setError(null);
                }}
                placeholder="#A8E6CF"
                ariaLabel="HEX 颜色"
                mono
                className="uppercase"
                maxLength={7}
                inputRef={inputRef}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAdd();
                  }
                }}
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              disabled={!canAdd}
              onClick={handleAdd}
              aria-label="确认添加颜色"
            >
              添加
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-[11px] font-semibold text-danger">
              {error}
            </p>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 px-5 py-3.5 border-t border-line-soft flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleReset}
          disabled={isDefault}
          aria-label="将课程调色板恢复默认"
        >
          恢复默认
        </Button>
        <Button variant="primary" size="sm" onClick={() => onOpenChange(false)}>
          完成
        </Button>
      </div>
    </Dialog>
  );
}
