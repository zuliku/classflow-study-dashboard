"use client";

import React from "react";

interface SettingsSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

/** 设置中心通用 section 容器：平铺、无大 Card 套大 Card */
export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-charcoal">{title}</h3>
        {description && <p className="text-xs text-sandrift mt-0.5">{description}</p>}
      </div>
      {children}
    </section>
  );
}
