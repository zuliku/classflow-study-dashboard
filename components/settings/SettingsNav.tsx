"use client";

import React from "react";
import { Home, User, Calendar, ListTodo, MousePointerClick, Database, Info } from "lucide-react";
import { SettingsSection } from "@/types";
import { cn } from "@/lib/utils";
import { KIRO_ICON } from "@/components/layout/navItems";

export const SETTINGS_NAV: {
  id: SettingsSection;
  label: string;
  icon: React.ElementType;
}[] = [
  { id: "general", label: "通用", icon: Home },
  { id: "profile", label: "个人资料", icon: User },
  { id: "semester", label: "学期与课表", icon: Calendar },
  { id: "tasks", label: "任务", icon: ListTodo },
  { id: "interaction", label: "交互与快捷键", icon: MousePointerClick },
  { id: "kiro", label: "Kiro 与 AI", icon: KIRO_ICON },
  { id: "data", label: "数据与存储", icon: Database },
];

export const ABOUT_NAV = { id: "about" as const, label: "关于", icon: Info };

interface SettingsNavProps {
  active: SettingsSection;
  onSelect: (section: SettingsSection) => void;
  /** 存在非默认偏好的 section（显示克制的小圆点） */
  modifiedSections: ReadonlySet<SettingsSection>;
}

/** 桌面/平板：左侧纵向导航；当前项使用 pastel-mint / charcoal selected language */
export function SettingsNav({ active, onSelect, modifiedSections }: SettingsNavProps) {
  const renderItem = (item: { id: SettingsSection; label: string; icon: React.ElementType }) => {
    const Icon = item.icon;
    const isActive = active === item.id;
    const modified = modifiedSections.has(item.id);
    return (
      <button
        key={item.id}
        onClick={() => onSelect(item.id)}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
          isActive
            ? "bg-pastel-mint text-charcoal font-semibold shadow-subtle"
            : "text-satin-grey hover:bg-alabaster hover:text-charcoal"
        )}
      >
        <Icon className="w-4 h-4 shrink-0" />
        <span className="truncate flex-1 text-left">{item.label}</span>
        {/* 已修改小圆点（克制，无数字 badge） */}
        {modified && <span className="w-1.5 h-1.5 rounded-full bg-charcoal shrink-0" aria-hidden="true" />}
      </button>
    );
  };

  return (
    <nav className="flex flex-col gap-0.5" aria-label="设置导航">
      {SETTINGS_NAV.map(renderItem)}
      <div className="my-1.5 h-px bg-line-soft" />
      {renderItem(ABOUT_NAV)}
    </nav>
  );
}
