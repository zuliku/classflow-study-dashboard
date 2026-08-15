"use client";

import React from "react";
import { FileImage, FileText, Link2, Presentation } from "lucide-react";
import { Material } from "@/types";

/** Task 6A：资料类型图标与标签（仅展示，不改 Material Domain；Course/Task 共用） */
export const MATERIAL_TYPE_LABELS: Record<Material["type"], string> = {
  pdf: "PDF",
  ppt: "PPT",
  doc: "DOC",
  link: "链接",
  image: "图片",
};

export function MaterialTypeIcon({
  type,
  className,
}: {
  type: Material["type"];
  className?: string;
}) {
  switch (type) {
    case "pdf":
    case "doc":
      return <FileText className={`w-3.5 h-3.5 shrink-0 text-[#A48F82] ${className ?? ""}`} />;
    case "ppt":
      return <Presentation className={`w-3.5 h-3.5 shrink-0 text-[#A48F82] ${className ?? ""}`} />;
    case "link":
      return <Link2 className={`w-3.5 h-3.5 shrink-0 text-[#A48F82] ${className ?? ""}`} />;
    case "image":
      return <FileImage className={`w-3.5 h-3.5 shrink-0 text-[#A48F82] ${className ?? ""}`} />;
  }
}
