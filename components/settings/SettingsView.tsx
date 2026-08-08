"use client";

import React, { useState, useMemo } from "react";
import { SettingsSection } from "@/types";
import { SettingsNav, SETTINGS_NAV, ABOUT_NAV } from "@/components/settings/SettingsNav";
import { GeneralSettings } from "@/components/settings/GeneralSettings";
import { ProfileSettings } from "@/components/settings/ProfileSettings";
import { SemesterSettings } from "@/components/settings/SemesterSettings";
import { TaskSettings } from "@/components/settings/TaskSettings";
import { InteractionSettings } from "@/components/settings/InteractionSettings";
import { DataSettings } from "@/components/settings/DataSettings";
import { AboutSettings } from "@/components/settings/AboutSettings";
import { searchSettings, SettingDefinition } from "@/lib/settingsRegistry";
import {
  getModifiedPreferenceKeys,
  getModifiedSections,
  PREFERENCE_SECTIONS,
  DEFAULT_PREFERENCES,
  resetPreferencePatch,
} from "@/lib/preferences";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

interface SettingsViewProps {
  /** SettingsModal Header 的搜索输入（空 = 未搜索） */
  searchQuery: string;
  onClearSearch: () => void;
  /** 从搜索结果跳转到某设置：切 section + 高亮 row */
  jumpToSetting: (setting: SettingDefinition) => void;
}

/**
 * 设置中心内容（常驻挂载所有 section，Profile/Semester dirty state 不因切换丢失）。
 * 搜索有内容时 Detail 临时切成搜索结果；「已修改」视图按 section 分组展示非默认偏好。
 */
export function SettingsView({ searchQuery, onClearSearch, jumpToSetting }: SettingsViewProps) {
  const [section, setSection] = useState<SettingsSection>("general");
  const [showModified, setShowModified] = useState(false);
  const preferences = useAppStore((s) => s.preferences);
  const resetPreferences = useAppStore((s) => s.resetPreferences);
  const pushToast = useToastStore((s) => s.pushToast);

  const modifiedKeys = useMemo(() => getModifiedPreferenceKeys(preferences), [preferences]);
  const modifiedSections = useMemo(
    () => getModifiedSections(preferences),
    [preferences]
  );
  const searchResults = useMemo(
    () => (searchQuery.trim() ? searchSettings(searchQuery) : []),
    [searchQuery]
  );
  const searching = searchQuery.trim().length > 0;

  // 从结果跳转：切 section + 触发 row 高亮（SettingsRow 通过 highlightedId 短暂闪烁）
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const highlightTimer = React.useRef<number | null>(null);
  const handleJump = (setting: SettingDefinition) => {
    setSection(setting.section);
    setShowModified(false);
    onClearSearch();
    setHighlightedId(setting.id);
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlightedId(null), 700);
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-setting-id="${setting.id}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  // 已修改视图：按 section 分组
  const modifiedGroups = useMemo(() => {
    const groups = new Map<
      "general" | "semester" | "tasks" | "interaction",
      { key: keyof typeof DEFAULT_PREFERENCES; default: unknown; current: unknown }[]
    >();
    for (const key of modifiedKeys) {
      const sec = PREFERENCE_SECTIONS[key];
      const arr = groups.get(sec) ?? [];
      arr.push({ key, default: DEFAULT_PREFERENCES[key], current: preferences[key] });
      groups.set(sec, arr);
    }
    return groups;
  }, [modifiedKeys, preferences]);

  const sectionLabel = (sec: SettingsSection) =>
    [...SETTINGS_NAV, ABOUT_NAV].find((n) => n.id === sec)?.label ?? sec;

  return (
    <div className="flex-1 min-h-0 flex flex-col md:flex-row" data-testid="settings-view">
      {/* 桌面/平板：左侧设置导航 */}
      <div className="hidden md:flex md:flex-col md:shrink-0 md:h-full md:w-[200px] md:p-3 md:border-r md:border-line-soft md:overflow-y-auto">
        <SettingsNav active={section} onSelect={setSection} modifiedSections={modifiedSections} />
      </div>

      {/* Mobile：横向可滚动 section tabs */}
      <div className="md:hidden shrink-0 px-4 pt-3 pb-2 overflow-x-auto border-b border-line-soft">
        <div className="flex items-center gap-1 w-max pb-1">
          {[...SETTINGS_NAV, ABOUT_NAV].map((item) => {
            const Icon = item.icon;
            const isActive = section === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-medium whitespace-nowrap transition-colors duration-[var(--motion-fast)]",
                  isActive
                    ? "bg-pastel-mint text-charcoal font-semibold"
                    : "text-satin-grey hover:bg-alabaster"
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
                {(modifiedSections as ReadonlySet<SettingsSection>).has(item.id) && (
                  <span className="w-1 h-1 rounded-full bg-charcoal" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 右侧 Workspace：Toolbar（全部设置 / 已修改 N）+ Detail Pane（唯一主要滚动区） */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col" data-testid="settings-workspace">
        {/* 顶部工具条：全部设置 / 已修改 N */}
        <div
          data-testid="settings-toolbar"
          className="shrink-0 px-4 md:px-5 pt-2 md:pt-3 md:pb-3 flex items-center justify-between"
        >
          <ToolbarTabs showModified={showModified} setShowModified={setShowModified} modifiedCount={modifiedKeys.length} />
        </div>

        {/* Detail Pane：唯一滚动区；所有 section 常驻挂载 */}
        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto p-4 md:pt-0 md:px-5 md:pb-5" data-testid="settings-detail">
        {/* ---- 搜索模式：Detail 临时切成搜索结果 ---- */}
        {searching ? (
          <div data-testid="settings-search-results">
            <p className="text-[10px] font-bold text-sandrift uppercase tracking-wider mb-2">
              搜索结果 · {searchResults.length}
            </p>
            {searchResults.length === 0 ? (
              <p className="py-8 text-center text-xs text-sandrift">未找到匹配的设置</p>
            ) : (
              (() => {
                // 按 section 分组
                const groups = new Map<SettingsSection, SettingDefinition[]>();
                for (const r of searchResults) {
                  const arr = groups.get(r.section) ?? [];
                  arr.push(r);
                  groups.set(r.section, arr);
                }
                return Array.from(groups.entries()).map(([sec, items]) => (
                  <div key={sec} className="mb-4">
                    <p className="text-[10px] font-bold text-sandrift uppercase tracking-wider mb-1.5">
                      {sectionLabel(sec)}
                    </p>
                    <div className="space-y-1">
                      {items.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => handleJump(s)}
                          className="w-full p-3 bg-[#F7F5F5] border border-line rounded-xl text-left hover:bg-alabaster transition-colors"
                        >
                          <p className="text-xs font-bold text-charcoal">{s.title}</p>
                          <p className="text-[10px] text-sandrift mt-0.5">{s.description}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                ));
              })()
            )}
          </div>
        ) : showModified && modifiedKeys.length > 0 ? (
          /* ---- 已修改视图：只显示非默认偏好，按 section 分组 ---- */
          <div data-testid="settings-modified">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-sandrift uppercase tracking-wider">
                已修改 · {modifiedKeys.length}
              </p>
              <button
                onClick={() => {
                  resetPreferences();
                  pushToast({ message: "已恢复所有默认设置" });
                }}
                className="flex items-center gap-1 text-[11px] font-semibold text-sandrift hover:text-charcoal transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                恢复所有默认设置
              </button>
            </div>
            {Array.from(modifiedGroups.entries()).map(([sec, items]) => (
              <div key={sec} className="mb-4">
                <p className="text-[10px] font-bold text-sandrift uppercase tracking-wider mb-1.5">
                  {sectionLabel(sec)}
                </p>
                <div className="space-y-1">
                  {items.map((it) => (
                    <div
                      key={it.key}
                      className="p-3 bg-[#F7F5F5] border border-line rounded-xl flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-bold text-charcoal">{preferenceTitle(it.key)}</p>
                        <p className="text-[10px] text-satin-grey mt-0.5 truncate">
                          {formatPreferenceValue(it.key, it.default as never)} →{" "}
                          {formatPreferenceValue(it.key, it.current as never)}
                        </p>
                      </div>
                      <button
                        onClick={() => useAppStore.getState().updatePreferences(resetPreferencePatch(it.key))}
                        aria-label={`将${preferenceTitle(it.key)}恢复默认`}
                        title="恢复默认"
                        className="p-1.5 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors shrink-0"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* ---- 常规 section 内容（常驻挂载） ---- */
          <>
            <div className={cn(section === "general" && "ux-fade")} hidden={section !== "general"}>
              <GeneralSettings onNavigate={setSection} />
            </div>
            <div className={cn(section === "profile" && "ux-fade")} hidden={section !== "profile"}>
              <ProfileSettings />
            </div>
            <div className={cn(section === "semester" && "ux-fade")} hidden={section !== "semester"}>
              <SemesterSettings highlightedId={highlightedId ?? undefined} />
            </div>
            <div className={cn(section === "tasks" && "ux-fade")} hidden={section !== "tasks"}>
              <TaskSettings highlightedId={highlightedId ?? undefined} />
            </div>
            <div className={cn(section === "interaction" && "ux-fade")} hidden={section !== "interaction"}>
              <InteractionSettings highlightedId={highlightedId ?? undefined} />
            </div>
            <div className={cn(section === "data" && "ux-fade")} hidden={section !== "data"}>
              <DataSettings />
            </div>
            <div className={cn(section === "about" && "ux-fade")} hidden={section !== "about"}>
              <AboutSettings />
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  );
}

function ToolbarTabs({
  showModified,
  setShowModified,
  modifiedCount,
}: {
  showModified: boolean;
  setShowModified: (v: boolean) => void;
  modifiedCount: number;
}) {
  return (
    <div className="flex items-center gap-1 bg-alabaster p-0.5 rounded-xl border border-line-strong text-[11px] font-medium">
      <button
        onClick={() => setShowModified(false)}
        aria-pressed={!showModified}
        className={cn(
          "px-2.5 py-1 rounded-lg font-bold transition-colors",
          !showModified ? "bg-white text-charcoal shadow-subtle" : "text-satin-grey hover:text-charcoal"
        )}
      >
        全部设置
      </button>
      <button
        onClick={() => setShowModified(true)}
        aria-pressed={showModified}
        className={cn(
          "px-2.5 py-1 rounded-lg font-bold transition-colors",
          showModified ? "bg-white text-charcoal shadow-subtle" : "text-satin-grey hover:text-charcoal"
        )}
      >
        已修改 {modifiedCount > 0 ? modifiedCount : ""}
      </button>
    </div>
  );
}

function preferenceTitle(key: keyof typeof DEFAULT_PREFERENCES): string {
  const map: Record<keyof typeof DEFAULT_PREFERENCES, string> = {
    showWeekends: "显示周末",
    ddlWarningDays: "临近截止提醒",
    defaultDDLTime: "默认截止时间",
    enableScheduleDirectManipulation: "课表直接操作",
    enableDDLDirectManipulation: "DDL 直接操作",
    motionPreference: "动效偏好",
    startupView: "默认打开位置",
    defaultTaskPriority: "默认优先级",
    defaultTaskStatus: "默认状态",
    enableSingleKeyShortcuts: "单键快捷键",
    contentDensity: "界面密度",
  };
  return map[key];
}

function formatPreferenceValue(key: keyof typeof DEFAULT_PREFERENCES, v: never): string {
  switch (key) {
    case "ddlWarningDays":
      return `${v} 天`;
    case "motionPreference":
      return v === "system" ? "跟随系统" : v === "full" ? "完整动效" : "减少动效";
    case "startupView":
      return v === "overview"
        ? "总览"
        : v === "timetable"
        ? "课表"
        : v === "assignments"
        ? "任务"
        : "上次使用的位置";
    case "defaultTaskPriority":
      return v === "urgent" ? "紧急" : v === "high" ? "高" : v === "medium" ? "中" : "低";
    case "defaultTaskStatus":
      return v === "doing" ? "进行中" : "待完成";
    case "contentDensity":
      return v === "compact" ? "紧凑" : "舒适";
    case "showWeekends":
    case "enableScheduleDirectManipulation":
    case "enableDDLDirectManipulation":
    case "enableSingleKeyShortcuts":
      return v ? "开" : "关";
    default:
      return String(v);
  }
}

void null;
