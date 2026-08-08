"use client";

import React, { useState } from "react";
import { Sparkles } from "lucide-react";
import { getVendorMeta } from "@/lib/ai/providers/vendors";
import { AIModelVendor } from "@/lib/ai/providers/types";
import { cn } from "@/lib/utils";

/**
 * Provider Logo：模型厂商图标的统一出口。
 * - 本地静态资源，object-contain 保持原始宽高比，禁止拉伸
 * - 未知厂商 / 加载失败 → neutral Sparkles fallback（不出现 broken image / 空白）
 * - 辅助识别元素：alt="" aria-hidden，模型名称仍是主要文本信息
 */
export function ProviderLogo({
  vendor,
  size = "md",
  className,
}: {
  vendor: AIModelVendor | null | undefined;
  /** sm：Composer 按钮（14~16px）；md：下拉行（18px 视觉，22px 容器） */
  size?: "sm" | "md";
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const meta = getVendorMeta(vendor);
  const box = size === "sm" ? "w-[22px] h-[22px]" : "w-[22px] h-[22px]";
  const icon = size === "sm" ? "w-3.5 h-3.5" : "w-[18px] h-[18px]";

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center shrink-0",
        box,
        className
      )}
      aria-hidden="true"
    >
      {meta.logo && !failed ? (
        // 品牌 Logo：object-contain 保比例；不套圆形/彩色容器，颜色只属于品牌本身
        <img
          src={meta.logo}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className={cn(icon, "object-contain")}
        />
      ) : (
        <Sparkles className={cn(icon, "text-sandrift")} />
      )}
    </span>
  );
}
