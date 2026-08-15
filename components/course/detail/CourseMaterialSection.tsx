"use client";

import React, { useState } from "react";
import { FileUp, Trash2 } from "lucide-react";
import { Material } from "@/types";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { Button } from "@/components/ui/Button";
import { MaterialTypeIcon, MATERIAL_TYPE_LABELS } from "@/components/ui/MaterialTypeIcon";
import { cn } from "@/lib/utils";
import { expandableSlice, formatMaterialMeta } from "@/lib/courseDetailView";

const MATERIAL_INLINE_LIMIT = 5;

/**
 * Course Material Section（Course Detail V2）：
 * - Row 轻量：type icon + title + meta（size · date）+ 查看；删除 hover 可见（mobile 常显）
 * - >5 默认前 5 + 展开全部（DisclosureRegion）
 * - 上传/删除/撤销/Blob cleanup 全部保留在 orchestration
 */
export function CourseMaterialSection({
  materials,
  uploading,
  onUploadClick,
  onPreview,
  onDelete,
  newIds,
}: {
  materials: Material[];
  uploading: boolean;
  onUploadClick: () => void;
  onPreview: (material: Material) => void;
  onDelete: (material: Material) => void;
  newIds: Set<string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const { visible, hiddenCount } = expandableSlice(materials, expanded, MATERIAL_INLINE_LIMIT);
  const extra = materials.slice(MATERIAL_INLINE_LIMIT);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-charcoal">
          课程资料
          <span className="ml-1.5 text-[11px] font-semibold text-sandrift">
            {materials.length} 份
          </span>
        </h3>
        <Button
          variant="secondary"
          size="sm"
          loading={uploading}
          loadingLabel="上传中"
          onClick={onUploadClick}
          className="h-6.5 px-2 text-[11px]"
        >
          <FileUp className="h-3 w-3" />
          上传资料
        </Button>
      </div>

      {materials.length === 0 ? (
        <button
          type="button"
          onClick={onUploadClick}
          className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-[11px] font-semibold text-sandrift transition-colors hover:bg-alabaster hover:text-charcoal"
        >
          <span>
            暂无课程资料
            <span className="block text-[10px] font-normal text-sandrift/80">
              支持 PDF、PPT、Word、图片
            </span>
          </span>
          <span className="flex items-center gap-1 font-bold">
            <FileUp className="h-3.5 w-3.5" />
            上传资料
          </span>
        </button>
      ) : (
        <div className="divide-y divide-line-soft">
          {visible.map((mat) => (
            <div
              key={mat.id}
              className={cn(
                "group flex items-center justify-between gap-2 px-1 py-2",
                newIds.has(mat.id) && "animate-enter"
              )}
            >
              <button
                type="button"
                onClick={() => onPreview(mat)}
                className="flex min-w-0 items-center gap-2 text-left"
              >
                <MaterialTypeIcon type={mat.type} />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-charcoal">
                    {mat.title}
                  </span>
                  <span className="block text-[10px] text-sandrift">
                    {formatMaterialMeta(mat)}
                    {mat.type === "link" && ` · ${MATERIAL_TYPE_LABELS[mat.type]}`}
                  </span>
                </span>
              </button>
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => onPreview(mat)}
                  className="rounded-lg border border-line bg-white px-2 py-1 text-[10px] font-bold text-charcoal transition-colors hover:bg-charcoal hover:text-white"
                >
                  查看
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(mat)}
                  aria-label={`删除资料 ${mat.title}`}
                  title="删除此资料"
                  className="rounded-lg p-1.5 text-sandrift transition-colors hover:bg-danger-bg hover:text-danger sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
          ))}
          {hiddenCount > 0 && (
            <DisclosureRegion open={expanded}>
              <div className="divide-y divide-line-soft">
                {extra.map((mat) => (
                  <div
                    key={mat.id}
                    className="group flex items-center justify-between gap-2 px-1 py-2"
                  >
                    <button
                      type="button"
                      onClick={() => onPreview(mat)}
                      className="flex min-w-0 items-center gap-2 text-left"
                    >
                      <MaterialTypeIcon type={mat.type} />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-charcoal">
                          {mat.title}
                        </span>
                        <span className="block text-[10px] text-sandrift">
                          {formatMaterialMeta(mat)}
                        </span>
                      </span>
                    </button>
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onPreview(mat)}
                        className="rounded-lg border border-line bg-white px-2 py-1 text-[10px] font-bold text-charcoal transition-colors hover:bg-charcoal hover:text-white"
                      >
                        查看
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(mat)}
                        aria-label={`删除资料 ${mat.title}`}
                        title="删除此资料"
                        className="rounded-lg p-1.5 text-sandrift transition-colors hover:bg-danger-bg hover:text-danger sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </DisclosureRegion>
          )}
          {hiddenCount > 0 && (
            <button
              type="button"
              aria-expanded={expanded}
              data-testid="materials-expand-toggle"
              onClick={() => setExpanded((v) => !v)}
              className="w-full px-1 py-2 text-left text-[11px] font-bold text-satin-grey transition-colors hover:text-charcoal"
            >
              {expanded ? "收起" : `展开全部 ${materials.length} 项`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
