"use client";

import React from "react";
import { Clock, CheckCircle2 } from "lucide-react";

type TimelineItem = { time?: string; title: string; desc?: string; done?: boolean };

export function KiroTimelineBlock({ code }: { code: string }) {
  let items: TimelineItem[] = [];
  try {
    const parsed = JSON.parse(code);
    if (Array.isArray(parsed)) items = parsed;
    else if (Array.isArray(parsed.items)) items = parsed.items;
    else throw new Error("invalid");
  } catch {
    // 降级：按行解析，每行 "时间 - 标题 - 描述" 或 "标题"
    items = code
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        // 移除列表前缀
        const clean = line.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "");
        const parts = clean.split(/\s*[-—]\s*/);
        if (parts.length >= 2) return { time: parts[0], title: parts[1], desc: parts.slice(2).join(" - ") };
        return { title: clean };
      });
  }

  if (items.length === 0) {
    return (
      <div className="my-[0.85em] rounded-xl border border-dashed border-line bg-alabaster/30 px-4 py-6 text-center text-[12px] text-sandrift">
        暂无时间轴数据
      </div>
    );
  }

  return (
    <div className="my-[0.85em] rounded-xl border border-line bg-white overflow-hidden">
      <div className="px-3 py-2 bg-alabaster border-b border-line flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5 text-sandrift" />
        <span className="text-[11px] font-bold tracking-wide text-sandrift uppercase">Timeline</span>
      </div>
      <div className="p-3 space-y-0">
        {items.map((it, idx) => (
          <div key={idx} className="relative flex gap-3 pb-4 last:pb-0">
            {/* 线 */}
            {idx < items.length - 1 && <div className="absolute left-[7px] top-4 bottom-0 w-px bg-line" />}
            <span className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 mt-0.5 flex items-center justify-center ${it.done ? "bg-charcoal border-charcoal text-white" : "bg-white border-line-strong"}`}>
              {it.done ? <CheckCircle2 className="w-3 h-3" /> : <span className="w-1.5 h-1.5 rounded-full bg-sandrift" />}
            </span>
            <div className="min-w-0 flex-1">
              {it.time && <span className="inline-block text-[10px] font-semibold text-sandrift bg-alabaster border border-line rounded px-1.5 py-0.5 mr-1.5">{it.time}</span>}
              <span className="text-[12px] font-semibold text-charcoal">{it.title}</span>
              {it.desc && <p className="text-[11px] text-satin-grey mt-0.5 leading-relaxed">{it.desc}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
