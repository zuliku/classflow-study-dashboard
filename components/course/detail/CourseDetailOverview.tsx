"use client";

import React from "react";
import { BookOpen, MapPin, User } from "lucide-react";
import { Course } from "@/types";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";

export interface CourseDraft {
  name: string;
  teacher: string;
  classroom: string;
  credit: number;
  description: string;
}

/**
 * Course Overview（Course Detail V2）：
 * - Readonly 摘要：说明（≤2-3 行）+ 教师/教室/学分 + 轻量统计
 * - Edit Mode：Overview 区域平滑切换为 inline 表单（DisclosureRegion 180ms）
 * - draft / validation / save 由 orchestration（CourseDetailDrawer）持有；
 *   保存/取消按钮位于 Header（[取消] [保存]），本组件只负责表单呈现。
 */
export function CourseDetailOverview({
  course,
  stats,
  editing,
  draft,
  onDraftChange,
  error,
}: {
  course: Course;
  /** 1 个时段 · 4 个任务 · 2 份资料 */
  stats: string;
  editing: boolean;
  draft: CourseDraft;
  onDraftChange: (draft: CourseDraft) => void;
  error: string | null;
}) {
  return (
    <section aria-label="课程概览">
      {/* Readonly 摘要 */}
      <DisclosureRegion open={!editing}>
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-satin-grey">
            {course.description || "暂无课程说明"}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs font-semibold text-charcoal">
            {course.teacher && (
              <span className="flex items-center gap-1">
                <User className="h-3.5 w-3.5 text-[#A48F82]" />
                {course.teacher}
              </span>
            )}
            {course.classroom && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5 text-[#A48F82]" />
                {course.classroom}
              </span>
            )}
            <span className="flex items-center gap-1">
              <BookOpen className="h-3.5 w-3.5 text-[#A48F82]" />
              {course.credit} 学分
            </span>
          </div>
          <p className="text-[11px] font-semibold text-sandrift">{stats}</p>
        </div>
      </DisclosureRegion>

      {/* Edit Mode：inline 编辑区（无 Card shell，编辑状态本身提供上下文） */}
      <DisclosureRegion open={editing}>
        <div data-testid="course-edit-form" className="space-y-3">
          <Field label="课程名称">
            <Input
              type="text"
              value={draft.name}
              onChange={(e) => onDraftChange({ ...draft, name: e.target.value })}
              placeholder="课程名称"
              aria-label="课程名称"
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="授课教师">
              <Input
                type="text"
                value={draft.teacher}
                onChange={(e) => onDraftChange({ ...draft, teacher: e.target.value })}
                placeholder="授课教师"
              />
            </Field>
            <Field label="上课教室">
              <Input
                type="text"
                value={draft.classroom}
                onChange={(e) => onDraftChange({ ...draft, classroom: e.target.value })}
                placeholder="上课教室"
              />
            </Field>
          </div>
          <Field label="学分">
            <Input
              type="number"
              min={0.5}
              step={0.5}
              value={Number.isFinite(draft.credit) ? String(draft.credit) : ""}
              onChange={(e) => onDraftChange({ ...draft, credit: Number(e.target.value) })}
              placeholder="学分"
              aria-label="学分"
            />
          </Field>
          <Field label="课程说明">
            <Textarea
              value={draft.description}
              onChange={(e) => onDraftChange({ ...draft, description: e.target.value })}
              placeholder="课程大纲与要求"
              rows={2}
            />
          </Field>
          {error && <p className="text-[11px] font-bold text-danger">{error}</p>}
        </div>
      </DisclosureRegion>
    </section>
  );
}
