"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { UISelect } from "@/components/ui/Select";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { formatEstimatedMinutes } from "@/lib/tasks/taskSemantics";
import {
  analyzeStudyBlockPlacement,
  courseOverlapSuffix,
} from "@/lib/timeline/studyBlockPlacement";
import type { Assignment } from "@/types";
import { cn } from "@/lib/utils";

/**
 * Plan 安排学习块 Dialog。
 * 与旧 Timeline ArrangeSheet 同语义，但不依赖旧 Timeline 组件，支持自由学习块标题。
 */
export function PlanArrangeDialog({
  open,
  assignment,
  weekDates,
  getPlacement,
  onClose,
  onSubmit,
}: {
  open: boolean;
  assignment: Assignment | null;
  weekDates: string[];
  getPlacement?: (date: string, start: string, end: string) => ReturnType<typeof analyzeStudyBlockPlacement>;
  onClose: () => void;
  onSubmit: (input: {
    title: string;
    date: string;
    startTime: string;
    endTime: string;
  }) => void;
}) {
  const today = useMemo(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }, []);
  const defaultDate = weekDates.includes(today) ? today : weekDates[0] ?? today;
  const [date, setDate] = useState(defaultDate);
  const [start, setStart] = useState("19:00");
  const [end, setEnd] = useState("20:00");
  const [title, setTitle] = useState("");
  const prevOpenRef = useRef(open);

  useEffect(() => {
    if (!open) return;
    const freshOpen = !prevOpenRef.current;
    prevOpenRef.current = open;
    if (!freshOpen) return;
    setDate(defaultDate);
    setStart("19:00");
    setEnd("20:00");
    setTitle("");
  }, [open, defaultDate]);

  useEffect(() => {
    if (!open) prevOpenRef.current = false;
  }, [open]);

  const shown = assignment;
  const placement = getPlacement?.(date, start, end);
  const hardConflict = placement?.hardConflict ?? null;
  const overlapHint =
    placement && placement.courseOverlaps.length > 0
      ? courseOverlapSuffix(placement.courseOverlaps).replace(/^，/, "")
      : null;
  const invalidTime = end <= start;
  const disabled = !open || (!shown && title.trim().length === 0) || invalidTime || !!hardConflict;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      overlayId="plan-arrange-dialog"
      stackZ={50}
      closeOnBackdrop
      aria-label="安排学习计划"
      data-testid="plan-arrange-dialog"
      className={cn(
        "max-w-sm space-y-3 rounded-2xl border-line-strong p-4 shadow-card",
        !open && "pointer-events-none"
      )}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-charcoal">安排学习计划</h3>
        <IconButton variant="ghost" size="sm" aria-label="关闭" onClick={onClose} disabled={!open}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>

      {shown ? (
        <div className="rounded-lg border border-line-soft bg-surface-soft px-3 py-2">
          <p className="truncate text-[12px] font-semibold text-charcoal">{shown.title}</p>
          <p className="mt-0.5 text-[10px] text-sandrift">
            预计 {formatEstimatedMinutes(shown.estimatedMinutes) ?? "未估时"}
          </p>
        </div>
      ) : (
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="学习块标题"
          aria-label="学习块标题"
          disabled={!open}
        />
      )}

      <div className="grid grid-cols-3 gap-2">
        <Field label="日期">
          <UISelect
            value={date}
            onChange={setDate}
            ariaLabel="日期"
            options={weekDates.map((value) => ({
              value,
              label: value.slice(5).replace("-", "/"),
            }))}
            triggerClassName="h-8 min-w-0 w-full px-1.5 text-[11px]"
            itemClassName="h-8"
          />
        </Field>
        <Field label="开始">
          <Input
            type="time"
            value={start}
            onChange={(event) => setStart(event.target.value)}
            aria-label="开始时间"
            disabled={!open}
            className="h-8 px-1.5 text-[11px]"
          />
        </Field>
        <Field label="结束">
          <Input
            type="time"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
            aria-label="结束时间"
            disabled={!open}
            className="h-8 px-1.5 text-[11px]"
          />
        </Field>
      </div>

      <DisclosureRegion open={!!hardConflict || !!overlapHint || invalidTime}>
        <p
          className={cn(
            "text-[11px] font-semibold",
            hardConflict || invalidTime ? "text-danger" : "text-warning"
          )}
        >
          {invalidTime
            ? "结束时间需要晚于开始时间"
            : hardConflict
              ? `与《${hardConflict.title}》时间冲突`
              : overlapHint}
        </p>
      </DisclosureRegion>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={!open}>
          取消
        </Button>
        <Button
          variant="accent"
          size="sm"
          disabled={disabled}
          onClick={() => onSubmit({ title: shown?.title ?? title.trim(), date, startTime: start, endTime: end })}
        >
          确认安排
        </Button>
      </div>
    </Dialog>
  );
}
