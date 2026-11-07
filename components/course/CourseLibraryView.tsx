"use client";

import React, { useMemo, useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { UISelect } from "@/components/ui/Select";
import { MaterialTypeIcon, MATERIAL_TYPE_LABELS } from "@/components/ui/MaterialTypeIcon";
import { Button } from "@/components/ui/Button";
import type { Course, Material } from "@/types";
import { cn } from "@/lib/utils";

type MaterialWithCourse = { material: Material; course: Course };
type TypeFilter = Material["type"] | "all";

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "pdf", label: "PDF" },
  { value: "ppt", label: "PPT" },
  { value: "doc", label: "DOC" },
  { value: "image", label: "图片" },
  { value: "link", label: "链接" },
];

export function CourseLibraryView({
  courses,
  onPreviewMaterial,
}: {
  courses: Course[];
  onPreviewMaterial: (material: Material) => void;
}) {
  const [query, setQuery] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const allMaterials = useMemo<MaterialWithCourse[]>(
    () =>
      courses.flatMap((course) =>
        course.materials.map((material) => ({ material, course }))
      ),
    [courses]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allMaterials.filter(({ material, course }) => {
      if (courseFilter !== "all" && course.id !== courseFilter) return false;
      if (typeFilter !== "all" && material.type !== typeFilter) return false;
      if (!q) return true;
      return (
        material.title.toLowerCase().includes(q) ||
        course.name.toLowerCase().includes(q) ||
        MATERIAL_TYPE_LABELS[material.type].toLowerCase().includes(q)
      );
    });
  }, [allMaterials, courseFilter, typeFilter, query]);

  const filtersActive = query.trim().length > 0 || courseFilter !== "all" || typeFilter !== "all";
  const clearFilters = () => {
    setQuery("");
    setCourseFilter("all");
    setTypeFilter("all");
  };

  return (
    <div className="ux-settle space-y-4" data-testid="course-library-view">
      <div className="dashboard-card flex flex-col gap-3 p-3.5 md:flex-row md:items-center">
        <div className="relative min-w-0 flex-1 md:max-w-md">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sandrift"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索资料名称或课程"
            aria-label="搜索课程资料"
            className="h-8 pl-8 text-[11px]"
          />
        </div>
        <UISelect
          value={courseFilter}
          onChange={setCourseFilter}
          ariaLabel="按课程筛选资料"
          options={[
            { value: "all", label: "全部课程" },
            ...courses.map((course) => ({ value: course.id, label: course.name })),
          ]}
          triggerClassName="h-8 w-full min-w-0 text-[11px] md:w-[180px]"
          itemClassName="h-8"
        />
        <div className="flex flex-wrap items-center gap-1">
          {TYPE_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setTypeFilter(option.value)}
              aria-pressed={typeFilter === option.value}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[10px] font-bold transition-colors",
                typeFilter === option.value
                  ? "border-line-strong bg-pastel-mint text-charcoal"
                  : "border-line bg-surface text-satin-grey hover:bg-alabaster hover:text-charcoal"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="ml-auto hidden shrink-0 text-[11px] tabular-nums text-sandrift md:inline">
          {filtered.length} / {allMaterials.length} 份
        </span>
      </div>

      {allMaterials.length === 0 ? (
        <div className="dashboard-card flex flex-col items-center justify-center gap-1.5 px-6 py-14 text-center">
          <p className="text-sm font-semibold text-charcoal">资料库还是空的</p>
          <p className="text-xs text-satin-grey">在课程卡片上传资料后，会汇总到这里。</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="dashboard-card flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
          <p className="text-sm font-semibold text-charcoal">没有匹配的资料</p>
          <p className="text-xs text-satin-grey">换个关键词或筛选项试试。</p>
          {filtersActive && (
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              清除筛选
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {filtered.map(({ material, course }) => (
            <button
              key={material.id}
              type="button"
              data-testid="course-library-material"
              onClick={() => onPreviewMaterial(material)}
              className="dashboard-card group flex min-h-[84px] w-full items-start gap-3 p-3.5 text-left transition-[border-color,box-shadow] duration-[var(--motion-fast)] hover:border-line-strong hover:shadow-subtle"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line-soft bg-background">
                <MaterialTypeIcon type={material.type} className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-start gap-2">
                  <span className="line-clamp-2 min-w-0 flex-1 text-[13px] font-semibold leading-snug text-charcoal">
                    {material.title}
                  </span>
                  <span className="shrink-0 rounded border border-line-soft bg-background px-1.5 py-px text-[10px] font-bold text-sandrift">
                    {MATERIAL_TYPE_LABELS[material.type]}
                  </span>
                </span>
                <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[10px] text-sandrift">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: course.bgHex }}
                  />
                  <span className="truncate">{course.name}</span>
                  {material.size && <span className="shrink-0">· {material.size}</span>}
                  <span className="ml-auto shrink-0">{material.uploadDate}</span>
                </span>
              </span>
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-sandrift opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ))}
        </div>
      )}

      {allMaterials.length > 0 && filtersActive && (
        <button
          type="button"
          onClick={clearFilters}
          className="text-[11px] font-semibold text-satin-grey transition-colors hover:text-charcoal"
        >
          清除筛选
        </button>
      )}
    </div>
  );
}
