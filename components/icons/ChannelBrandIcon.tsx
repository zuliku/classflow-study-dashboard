"use client";

import React from "react";
import type { InboxSource } from "@/lib/inbox/types";
import { getInboxSourcePresentation } from "@/lib/inbox/sourcePresentation";
import { cn } from "@/lib/utils";

interface ChannelBrandIconProps {
  source: InboxSource;
  size?: number;
  className?: string;
}

export function ChannelBrandIcon({ source, size = 16, className }: ChannelBrandIconProps) {
  const { iconSrc } = getInboxSourcePresentation(source);

  return (
    <img
      src={iconSrc}
      alt=""
      aria-hidden="true"
      draggable={false}
      width={size}
      height={size}
      className={cn("shrink-0 object-contain", className)}
      style={{ width: size, height: size }}
    />
  );
}
