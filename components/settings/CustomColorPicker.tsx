"use client";

import React, { useEffect, useRef, useState } from "react";
import { hexToHsv, hsvToHex, type Hsv } from "@/lib/color";
import { cn } from "@/lib/utils";

const DEFAULT_HSV: Hsv = { h: 210, s: 60, v: 90 };

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function sameHsv(a: Hsv, b: Hsv): boolean {
  return Math.round(a.h) === Math.round(b.h) && Math.round(a.s) === Math.round(b.s) && Math.round(a.v) === Math.round(b.v);
}

/**
 * 应用内自绘取色器（调色板弹窗「添加颜色」区）。
 * - 饱和度/明度面板 + 色相条，全部 ClassFlow 圆角语言；
 *   不使用原生 <input type="color">（其 Chrome 方形白底弹窗与全站视觉冲突）。
 * - 受控：value 为 HEX 草稿（可非法/为空，此时保留上次有效取色）；
 *   onChange 只在取色变化时输出归一化 HEX。
 * - 键盘可达：面板方向键调饱和度/明度，色相条方向键/Home/End；
 *   预设与 HEX 输入框是等效键盘路径。
 */
export function CustomColorPicker({
  value,
  onChange,
}: {
  /** HEX 草稿（允许非法/空：取色器保留上次有效颜色） */
  value: string;
  onChange: (hex: string) => void;
}) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value) ?? DEFAULT_HSV);
  const hsvRef = useRef<Hsv>(hexToHsv(value) ?? DEFAULT_HSV);
  const padRef = useRef<HTMLDivElement | null>(null);
  const hueRef = useRef<HTMLDivElement | null>(null);

  // 外部草稿有效且与当前取色不一致时同步（如点击预设、手动输入 HEX）
  useEffect(() => {
    const parsed = hexToHsv(value);
    if (!parsed || sameHsv(hsvRef.current, parsed)) return;
    hsvRef.current = parsed;
    setHsv(parsed);
  }, [value ]);

  const emit = (next: Hsv) => {
    const rounded: Hsv = { h: Math.round(next.h), s: Math.round(next.s), v: Math.round(next.v) };
    if (sameHsv(hsvRef.current, rounded)) return;
    hsvRef.current = rounded;
    setHsv(rounded);
    onChange(hsvToHex(rounded.h, rounded.s, rounded.v));
  };

  const padFromPointer = (clientX: number, clientY: number) => {
    const el = padRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const base = hsvRef.current;
    emit({
      h: base.h,
      s: clamp(((clientX - rect.left) / rect.width) * 100, 0, 100),
      v: clamp(100 - ((clientY - rect.top) / rect.height) * 100, 0, 100),
    });
  };

  const hueFromPointer = (clientX: number) => {
    const el = hueRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    emit({ ...hsvRef.current, h: clamp(((clientX - rect.left) / rect.width) * 360, 0, 360) });
  };

  const capture = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* jsdom / 旧环境无 pointer capture：move 仍经 buttons 守卫处理 */
    }
  };

  return (
    <div data-testid="custom-color-picker" className="space-y-2">
      {/* 饱和度 / 明度面板 */}
      <div
        ref={padRef}
        role="slider"
        tabIndex={0}
        aria-label="颜色饱和度与明度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.s)}
        aria-valuetext={`饱和度 ${Math.round(hsv.s)}%，明度 ${Math.round(hsv.v)}%`}
        onPointerDown={(e) => {
          capture(e);
          padFromPointer(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) padFromPointer(e.clientX, e.clientY);
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 10 : 3;
          if (e.key === "ArrowLeft") { e.preventDefault(); emit({ ...hsv, s: hsv.s - step }); }
          else if (e.key === "ArrowRight") { e.preventDefault(); emit({ ...hsv, s: hsv.s + step }); }
          else if (e.key === "ArrowUp") { e.preventDefault(); emit({ ...hsv, v: hsv.v + step }); }
          else if (e.key === "ArrowDown") { e.preventDefault(); emit({ ...hsv, v: hsv.v - step }); }
        }}
        className="relative h-36 w-full rounded-xl border border-line shadow-subtle cursor-crosshair touch-none select-none focus-visible:outline-2 focus-visible:outline-charcoal/30 focus-visible:outline-offset-2"
        style={{
          background: `linear-gradient(to top, #000 0%, rgba(0,0,0,0) 100%), linear-gradient(to right, #fff 0%, hsl(${Math.round(hsv.h)} 100% 50%) 100%)`,
        }}
      >
        <span
          aria-hidden="true"
          className="absolute w-4 h-4 rounded-full border-2 border-white shadow-subtle pointer-events-none"
          style={{
            left: `${clamp(hsv.s, 0, 100)}%`,
            top: `${100 - clamp(hsv.v, 0, 100)}%`,
            transform: "translate(-50%, -50%)",
            backgroundColor: hsvToHex(hsv.h, hsv.s, hsv.v),
          }}
        />
      </div>

      {/* 色相条 */}
      <div
        ref={hueRef}
        role="slider"
        tabIndex={0}
        aria-label="色相"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        aria-valuetext={`色相 ${Math.round(hsv.h)} 度`}
        onPointerDown={(e) => {
          capture(e);
          hueFromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) hueFromPointer(e.clientX);
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 15 : 3;
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); emit({ ...hsv, h: hsv.h - step }); }
          else if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); emit({ ...hsv, h: hsv.h + step }); }
          else if (e.key === "Home") { e.preventDefault(); emit({ ...hsv, h: 0 }); }
          else if (e.key === "End") { e.preventDefault(); emit({ ...hsv, h: 360 }); }
        }}
        className={cn(
          "relative h-2.5 w-full rounded-full border border-line shadow-subtle cursor-pointer touch-none select-none",
          "focus-visible:outline-2 focus-visible:outline-charcoal/30 focus-visible:outline-offset-2"
        )}
        style={{
          background:
            "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
        }}
      >
        <span
          aria-hidden="true"
          className="absolute top-1/2 w-4 h-4 rounded-full bg-white border-2 border-charcoal shadow-subtle pointer-events-none"
          style={{
            left: `${clamp((hsv.h / 360) * 100, 0, 100)}%`,
            transform: "translate(-50%, -50%)",
          }}
        />
      </div>
    </div>
  );
}
