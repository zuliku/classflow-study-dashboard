"use client";

import React from "react";
import { User, Calendar, ListTodo, Sliders, Database, Info } from "lucide-react";
import { SettingsSection } from "@/types";
import { cn } from "@/lib/utils";

export const SETTINGS_NAV: {
  id: SettingsSection;
  label: string;
  icon: React.ElementType;
}[] = [
  { id: "profile", label: "个人资料", icon: User },
  { id: "semester", label: "学期与课表", icon: Calendar },
  { id: "tasks", label: "任务与提醒", icon: ListTodo },
  { id: "interaction", label: "交互与外观", icon: Sliders },
  { id: "data", label: "数据与存储", icon: Database },
];

export const ABOUT_NAV = { id: "about" as const, label: "关于", icon: Info };

interface SettingsNavProps {
  active: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}

/** 桌面/平板：左侧纵向导航；当前项使用 pastel-mint / charcoal selected language */
export function SettingsNav({ active, onSelect }: SettingsNavProps) {
  const renderItem = (item: { id: SettingsSection; label: string; icon: React.ElementType }) => {
    const Icon = item.icon;
    const isActive = active === item.id;
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
        <span className="truncate">{item.label}</span>
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
