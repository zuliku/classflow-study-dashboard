"use client";

import React, { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Popover, PopoverPanel } from "@/components/ui/Popover";
import { Button } from "@/components/ui/Button";
import { SettingsInput } from "@/components/settings/SettingsControls";
import { ColorSwatch } from "@/components/ui/ColorSwatch";
import {
  CURATED_COLOR_PRESETS,
  MAX_COURSE_PALETTE_SIZE,
  MIN_COURSE_PALETTE_SIZE,
  normalizeHex,
  paletteIncludes,
} from "@/lib/color";
import { cn } from "@/lib/utils";

/**
 * 课程调色板统一编辑器（Settings 通用页唯一入口）。
 * - 与截图中的 Chrome 原生拾色器彻底告别：添加颜色走 ClassFlow surface
 *  （预设 16 格 + HEX 输入 + 实时预览），圆角/border/shadow 与全站一致。
 * - 诚实约束：至少保留 1 色（防空调色板导致轮换失效）、至多 12 色、重复 HEX
 *   大小写不敏感去重、非法 HEX 行内报错。计数实时显示，无“共 8 色”硬编码。
 */
export function CoursePaletteEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setDraft("");
      setError(null);
      // PopoverPanel presence 有一帧挂载延迟，下一帧再聚焦
      const raf = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(raf);
    }
  }, [open ]);

  const normalizedDraft = normalizeHex(draft);
  const isDuplicate = normalizedDraft ? paletteIncludes(value, normalizedDraft) : false;
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
    setOpen(false);
  };

  const handleRemove = (hex: string) => {
    if (value.length <= MIN_COURSE_PALETTE_SIZE) return;
    onChange(value.filter((c) => c.toUpperCase() !== hex.toUpperCase()));
  };

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2 max-w-[280px]">
        {value.map((c) => (
          <ColorSwatch
            key={c.toUpperCase()}
            color={c}
            size="md"
            removable
            removeDisabled={value.length <= MIN_COURSE_PALETTE_SIZE}
            onRemove={() => handleRemove(c)}
            title={value.length <= MIN_COURSE_PALETTE_SIZE ? `${c}（至少保留 1 种颜色）` : `${c} · 点击右上 × 移除`}
          />
        ))}
        <Popover open={open} onOpenChange={setOpen} className="inline-flex">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            disabled={isFull}
            aria-label={isFull ? `调色板已满（${MAX_COURSE_PALETTE_SIZE} 色）` : "添加颜色"}
            title={isFull ? `最多 ${MAX_COURSE_PALETTE_SIZE} 种颜色` : "添加颜色"}
            aria-expanded={open}
            aria-haspopup="dialog"
            className={cn(
              "w-8 h-8 rounded-full inline-flex items-center justify-center shrink-0",
              "border border-dashed border-line-strong text-sandrift bg-surface",
              "transition-colors duration-[var(--motion-fast)]",
              "focus-visible:outline-2 focus-visible:outline-charcoal/30 focus-visible:outline-offset-2",
              isFull
                ? "opacity-40 cursor-not-allowed"
                : "hover:text-charcoal hover:border-charcoal hover:bg-alabaster ux-press cursor-pointer"
            )}
          >
            <Plus aria-hidden="true" className="w-4 h-4" />
          </button>
          <PopoverPanel open={open} placement="bottom-start" className="w-[264px] p-3.5 space-y-3">
            <div>
              <p className="text-xs font-bold text-charcoal">添加颜色</p>
              <p className="text-[11px] text-sandrift mt-0.5">
                从预设选择或输入 HEX，共 {value.length} / {MAX_COURSE_PALETTE_SIZE} 色。
              </p>
            </div>

            <div
              role="group"
              aria-label="预设颜色"
              className="grid grid-cols-8 gap-1.5"
            >
              {CURATED_COLOR_PRESETS.map((preset) => {
                const added = paletteIncludes(value, preset);
                const isDraft = normalizedDraft === preset.toUpperCase();
                return (
                  <ColorSwatch
                    key={preset}
                    color={preset}
                    size="sm"
                    selected={isDraft}
                    disabled={added}
                    onSelect={added ? undefined : () => {
                      setDraft(preset);
                      setError(null);
                    }}
                    title={added ? `${preset}（已在调色板）` : preset}
                    ariaLabel={added ? `${preset}（已在调色板）` : `选择预设 ${preset}`}
                  />
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="w-9 h-9 rounded-full border border-line shadow-subtle shrink-0 transition-colors duration-[var(--motion-fast)]"
                style={{ backgroundColor: normalizedDraft ?? "transparent" }}
              />
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
            {error ? (
              <p role="alert" className="text-[11px] font-semibold text-danger">
                {error}
              </p>
            ) : (
              <p className="text-[10px] text-sandrift leading-relaxed">
                支持 #RRGGBB / #RGB / 缺 # 输入，点击已有色块右上 × 可移除。
              </p>
            )}

            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                关闭
              </Button>
            </div>
          </PopoverPanel>
        </Popover>
      </div>
      {value.length === 0 ? (
        <p role="alert" className="text-[11px] font-semibold text-danger mt-2">
          调色板为空时新课程将使用默认灰色，请至少保留 1 种颜色或点击右上恢复默认。
        </p>
      ) : null}
    </div>
  );
}
