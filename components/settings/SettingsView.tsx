"use client";

import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { SettingsSection } from "@/types";
import { SettingsNav, SETTINGS_NAV, ABOUT_NAV } from "@/components/settings/SettingsNav";
import { GeneralSettings } from "@/components/settings/GeneralSettings";
import { ProfileSettings } from "@/components/settings/ProfileSettings";
import { SemesterSettings } from "@/components/settings/SemesterSettings";
import { TaskSettings } from "@/components/settings/TaskSettings";
import { FocusSettings } from "@/components/settings/FocusSettings";
import { DataSettings } from "@/components/settings/DataSettings";
import { AboutSettings } from "@/components/settings/AboutSettings";
import { KiroAISettings } from "@/components/settings/KiroAISettings";
import { KiroAgentSettings } from "@/components/settings/KiroAgentSettings";
import { ExtensionsSettings } from "@/components/settings/ExtensionsSettings";
import {
  searchSettings,
  SettingDefinition,
  SettingGate,
  DisclosureKey,
  findSettingById,
  SETTING_IDS,
} from "@/lib/settingsRegistry";
import { runRegistryDomValidation } from "@/lib/settingsRegistryValidation";
import { isVisibleElement } from "@/lib/focusVisibility";
import { useAppStore } from "@/store/useAppStore";
import { useAISettingsStore } from "@/store/useAISettingsStore";
import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";
import { useReminderPreferencesStore } from "@/store/useReminderPreferencesStore";
import { useToastStore } from "@/store/useToastStore";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import { cn } from "@/lib/utils";

interface SettingsViewProps {
  /** SettingsModal 持有的搜索 query（空 = 未搜索） */
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  /** 从搜索结果跳转到某设置后：清空搜索 */
  onClearSearch: () => void;
  /** Cmd/Ctrl+F 聚焦目标：侧栏搜索输入框（只绑定当前可见的那个） */
  searchInputRef: React.Ref<HTMLInputElement>;
  /** Profile / Semester 上报脏状态（关闭确认用） */
  onDirtyChange: (section: SettingsSection, dirty: boolean) => void;
  /** Modal 决定放弃草稿时递增：触发各 section 丢弃本地草稿 */
  discardToken: number;
}

/** 绑定 ref 时只保留可见的搜索框（桌面/移动各渲染一个，另一个 display:none 会覆盖 ref） */
function bindVisibleSearchInput(ref: React.Ref<HTMLInputElement>) {
  return (el: HTMLInputElement | null) => {
    if (!el || isVisibleElement(el)) {
      if (typeof ref === "function") ref(el);
      else if (ref && typeof ref === "object" && "current" in ref) {
        (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
      }
    }
  };
}

/** 搜索跳转时的披露请求（key + 序号保证重复跳转也会重新触发） */
export interface RevealRequest {
  key: DisclosureKey;
  seq: number;
}

/**
 * 设置中心内容（常驻挂载所有 section，Profile/Semester dirty state 不因切换丢失）。
 * 搜索有内容时 Detail 临时切成搜索结果；点击结果 → 切 section + 清空搜索 +
 * 可靠滚动到目标 row（带多帧重试）并短暂高亮。
 * 条件设置（gate）：目标不可直达时跳到控制设置并提示，绝不产生死跳转；披露目标自动展开。
 */
export function SettingsView({
  searchQuery,
  setSearchQuery,
  onClearSearch,
  searchInputRef,
  onDirtyChange,
  discardToken,
}: SettingsViewProps) {
  const [section, setSection] = useState<SettingsSection>("general");
  const viewRootRef = useRef<HTMLDivElement | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  /** Mobile section tabs：active section 变化时滚入可视区（深链/搜索跳转后不留在旧位置） */
  const mobileTabRefs = useRef<Map<SettingsSection, HTMLButtonElement>>(new Map());

  // 稳定的 per-section dirty 上报回调：Profile/Semester 的 dirty effect 以 onDirtyChange 为依赖，
  // inline 箭头会在每次 render 时产生新引用并重触发上报链（Maximum update depth）。
  const handleProfileDirty = useCallback((d: boolean) => onDirtyChange("profile", d), [onDirtyChange]);
  const handleSemesterDirty = useCallback((d: boolean) => onDirtyChange("semester", d), [onDirtyChange]);

  // ---- 条件 gate 取值快照（只读；跳转逻辑绝不修改偏好） ----
  const aiProvider = useAISettingsStore((s) => s.provider);
  const missedReminderPolicy = useReminderPreferencesStore((s) => s.missedReminderPolicy);
  const webSearchEnabled = useKiroPreferencesStore((s) => s.webSearchEnabled);
  const webSearchCredentialMode = useKiroPreferencesStore((s) => s.webSearchCredentialMode);
  const hasActiveWorkspace = useKiroComputerStore((s) => s.workspaces.length > 0);
  const computerEnabled = useKiroComputerStore((s) => s.computerEnabled);
  const desktopObserveEnabled = useKiroComputerStore((s) => s.desktopControlEnabled);

  function getGateValue(controlId: string): unknown {
    switch (controlId) {
      case SETTING_IDS.kiro.provider:
        return aiProvider;
      case SETTING_IDS.tasks.missedReminderPolicy:
        return missedReminderPolicy;
      case SETTING_IDS.kiro.webSearchEnabled:
        return webSearchEnabled;
      case SETTING_IDS.kiro.webSearchCredential:
        return webSearchCredentialMode;
      case SETTING_IDS["kiro-agent"].workspace:
        return hasActiveWorkspace ? "set" : "";
      case SETTING_IDS["kiro-agent"].computerEnabled:
        return computerEnabled;
      case SETTING_IDS["kiro-agent"].desktopObserve:
        return desktopObserveEnabled;
      case SETTING_IDS.extensions.channels:
        // 渠道面板常驻渲染：门控只用于「先到渠道区再配置」的引导
        return true;
      default:
        return undefined;
    }
  }

  function isGateSatisfied(gate: SettingGate): boolean {
    const value = getGateValue(gate.control);
    if (gate.requiresValue === undefined) return Boolean(value);
    return value === gate.requiresValue;
  }

  // ---- 搜索结果 / 外部深链共用的跳转高亮状态 ----
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [reveal, setReveal] = useState<RevealRequest | null>(null);
  /** 同一 section 内重复深链也要重新滚动：递增序号触发定位 effect */
  const [targetSeq, setTargetSeq] = useState(0);
  const pendingTargetRef = useRef<string | null>(null);
  const highlightTimer = React.useRef<number | null>(null);
  const highlightedElRef = useRef<HTMLElement | null>(null);
  const pushToast = useToastStore((s) => s.pushToast);
  const reducedMotion = useEffectiveReducedMotion();

  const clearHighlight = () => {
    const prev = highlightedElRef.current;
    if (!prev) return;
    prev.classList.remove("bg-pastel-mint/60");
    prev.removeAttribute("data-highlighted");
    highlightedElRef.current = null;
  };

  /** 真正执行跳转：切 section、清搜索、必要时展开 disclosure，并触发滚动 + 高亮 */
  const jumpTo = (setting: SettingDefinition) => {
    clearHighlight();
    setSection(setting.section);
    onClearSearch();
    setHighlightedId(null);
    pendingTargetRef.current = setting.id;
    setTargetSeq((v) => v + 1);
    if (setting.disclosure) {
      setReveal((prev) => ({ key: setting.disclosure as DisclosureKey, seq: (prev?.seq ?? 0) + 1 }));
    }
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
  };

  // 外部请求跳转（如 Kiro「配置 AI 服务」/ 个人资料卡 / 时间表设置）：
  // 有目标 setting 时复用搜索跳转的滚动 + 高亮；只有 section 时仍可安全回退。
  const settingsTargetSection = useAppStore((s) => s.settingsTargetSection);
  const settingsTargetSettingId = useAppStore((s) => s.settingsTargetSettingId);
  const setSettingsTargetSection = useAppStore((s) => s.setSettingsTargetSection);
  React.useEffect(() => {
    if (!settingsTargetSection) return;
    const target = settingsTargetSettingId ? findSettingById(settingsTargetSettingId) : null;
    if (target) {
      jumpTo(target);
    } else {
      setSection(settingsTargetSection);
      setHighlightedId(null);
      pendingTargetRef.current = null;
      setTargetSeq((v) => v + 1);
    }
    setSettingsTargetSection(null);
    // jumpTo 依赖 props 回调；由 target 变化驱动，重复消费由 Store 清空保证
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsTargetSection, settingsTargetSettingId, setSettingsTargetSection]);

  const searchResults = useMemo(
    () => (searchQuery.trim() ? searchSettings(searchQuery) : []),
    [searchQuery]
  );
  const searching = searchQuery.trim().length > 0;

  // Section / 搜索态切换：同一 detail 滚动容器会被复用；不重置会让 Kiro/Agent 等长分区
  // 从上一页的滚动深度打开（实测 General 滚到底 → Kiro 仍停在 240px）。
  // 搜索跳转有 pendingTarget，交给后面的 scrollIntoView 处理，不能抢先归零。
  useLayoutEffect(() => {
    if (pendingTargetRef.current) return;
    detailRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [section, searching]);

  // Mobile tabs：section 变化时把 active tab 滚入可视区（搜索跳转/深链后不留在旧位置）。
  // 手动调整 strip.scrollLeft，避免 scrollIntoView 连带滚动 Modal/详情区。
  useLayoutEffect(() => {
    const el = mobileTabRefs.current.get(section);
    const strip = el?.parentElement;
    if (!el || !strip) return;
    const er = el.getBoundingClientRect();
    const sr = strip.getBoundingClientRect();
    if (er.left < sr.left) {
      strip.scrollLeft -= sr.left - er.left + 8;
    } else if (er.right > sr.right) {
      strip.scrollLeft += er.right - sr.right + 8;
    }
  }, [section]);

  // 开发期自动校验：Registry ID ↔ 真实 DOM（全部 section 常驻挂载，一次校验全量；只查 Settings 根）
  React.useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      // 等首帧渲染完成后再校验（React 已提交 DOM）
      requestAnimationFrame(() => {
        runRegistryDomValidation(viewRootRef.current ?? document);
      });
    }
  }, []);

  /** 搜索结果点击：gate 未满足 → 跳控制设置 + 简明提示（绝不修改用户偏好） */
  const handleJump = (setting: SettingDefinition) => {
    if (setting.gate && setting.gate.length > 0) {
      const blocked = setting.gate.find((g) => !isGateSatisfied(g));
      if (blocked) {
        const control = findSettingById(blocked.control);
        if (control) {
          pushToast({
            message: `「${setting.title}」需要先调整「${control.title}」。`,
            type: "info",
          });
          jumpTo(control);
          return;
        }
      }
    }
    jumpTo(setting);
  };

  // 目标挂载后执行滚动 + 高亮；最多重试 3 帧，仍缺失时 dev warn（作用域 = Settings 根）
  React.useEffect(() => {
    const targetId = pendingTargetRef.current;
    if (!targetId) return;
    let tries = 0;
    let raf = 0;
    const attempt = () => {
      tries += 1;
      const el = (viewRootRef.current?.querySelector(
        `[data-setting-id="${targetId}"]`
      ) ?? null) as HTMLElement | null;
      if (el) {
        pendingTargetRef.current = null;
        clearHighlight();
        el.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
        // DOM 级高亮：不依赖 row 是否接收 highlighted prop（搜索跳转 / 深链一律可用）
        el.classList.add("bg-pastel-mint/60");
        el.setAttribute("data-highlighted", "true");
        highlightedElRef.current = el;
        setHighlightedId(targetId);
        if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
        highlightTimer.current = window.setTimeout(() => {
          if (highlightedElRef.current === el) clearHighlight();
          setHighlightedId(null);
        }, 900);
        return;
      }
      if (tries < 3) {
        raf = requestAnimationFrame(attempt);
        return;
      }
      if (process.env.NODE_ENV === "development") {
        // eslint-disable-next-line no-console
        console.warn(`[SettingsRegistry] jump target not found in DOM: ${targetId}`);
      }
      pendingTargetRef.current = null;
    };
    raf = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(raf);
  }, [section, searchQuery, reveal, targetSeq]);

  const sectionLabel = (sec: SettingsSection) =>
    [...SETTINGS_NAV, ABOUT_NAV].find((n) => n.id === sec)?.label ?? sec;

  return (
    <div
      ref={viewRootRef}
      className="flex-1 min-h-0 flex flex-col md:flex-row"
      data-testid="settings-view"
    >
      {/* 桌面/平板：左侧设置导航（搜索常驻顶部） */}
      <div className="hidden md:flex md:flex-col md:shrink-0 md:h-full md:w-[220px] md:p-3 md:border-r md:border-line-soft md:overflow-y-auto">
        <label className="relative block mb-2 shrink-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-sandrift pointer-events-none" />
          <input
            ref={bindVisibleSearchInput(searchInputRef)}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索设置"
            aria-label="搜索设置"
            className="w-full h-8 pl-8 pr-2.5 bg-[#F7F5F5] border border-line rounded-lg text-xs text-charcoal placeholder-sandrift focus:outline-none focus:border-line-strong focus:bg-white transition-colors duration-[var(--motion-fast)]"
          />
        </label>
        <SettingsNav active={section} onSelect={setSection} />
      </div>

      {/* Mobile：搜索 + 横向可滚动 section tabs */}
      <div className="md:hidden shrink-0 px-4 pt-3 pb-2 space-y-2 border-b border-line-soft">
        <label className="relative block">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-sandrift pointer-events-none" />
          <input
            ref={bindVisibleSearchInput(searchInputRef)}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索设置"
            aria-label="搜索设置"
            className="w-full h-8 pl-8 pr-2.5 bg-[#F7F5F5] border border-line rounded-lg text-xs text-charcoal placeholder-sandrift focus:outline-none focus:border-line-strong focus:bg-white transition-colors duration-[var(--motion-fast)]"
          />
        </label>
        <div className="flex items-center gap-1 w-max max-w-full pb-1 overflow-x-auto scrollbar-none">
          {[...SETTINGS_NAV, ABOUT_NAV].map((item) => {
            const Icon = item.icon;
            const isActive = section === item.id;
            return (
              <button
                key={item.id}
                ref={(el) => {
                  if (el) mobileTabRefs.current.set(item.id, el);
                  else mobileTabRefs.current.delete(item.id);
                }}
                onClick={() => setSection(item.id)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-[var(--motion-fast)] active:opacity-80",
                  isActive
                    ? "bg-pastel-mint text-charcoal font-semibold"
                    : "text-satin-grey hover:bg-alabaster"
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 右侧 Workspace：Detail Pane（唯一主要滚动区） */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {/* Detail Pane：唯一滚动区；所有 section 常驻挂载 */}
        <div ref={detailRef} className="flex-1 min-w-0 min-h-0 overflow-y-auto [scrollbar-gutter:stable] p-4 md:pt-4 md:px-5 md:pb-5" data-testid="settings-detail">
          {searching ? (
            /* 搜索态进入淡入一次（key 静态——随 query 逐字重播会闪烁，故不用 query 做 key） */
            <div key="search-results" className="ux-fade" data-testid="settings-search-results">
              <p className="text-[11px] font-bold text-sandrift mb-2">
                搜索结果 · {searchResults.length}
              </p>
              {searchResults.length === 0 ? (
                <p className="py-8 text-center text-xs text-sandrift">未找到匹配的设置</p>
              ) : (
                (() => {
                  // 按 section 分组；每项显示「section › 设置名」路径，点击跳转对应 section + 滚动 + 高亮
                  const groups = new Map<SettingsSection, SettingDefinition[]>();
                  for (const r of searchResults) {
                    const arr = groups.get(r.section) ?? [];
                    arr.push(r);
                    groups.set(r.section, arr);
                  }
                  return Array.from(groups.entries()).map(([sec, items]) => (
                    <GroupedList key={sec} label={sectionLabel(sec)}>
                      {items.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => handleJump(s)}
                          className="w-full px-3 py-2.5 text-left hover:bg-alabaster transition-colors duration-[var(--motion-fast)]"
                        >
                          <p className="text-xs font-bold text-charcoal">{s.title}</p>
                          <p className="text-[11px] text-sandrift mt-0.5">{s.description}</p>
                        </button>
                      ))}
                    </GroupedList>
                  ));
                })()
              )}
            </div>
          ) : (
            /* ---- 常规 section 内容（常驻挂载） ---- */
            <>
              <div className={cn(section === "general" && "ux-fade")} hidden={section !== "general"}>
                <GeneralSettings highlightedId={highlightedId ?? undefined} />
              </div>
              <div className={cn(section === "profile" && "ux-fade")} hidden={section !== "profile"}>
                <ProfileSettings onDirtyChange={handleProfileDirty} discardToken={discardToken} />
              </div>
              <div className={cn(section === "semester" && "ux-fade")} hidden={section !== "semester"}>
                <SemesterSettings
                  highlightedId={highlightedId ?? undefined}
                  onDirtyChange={handleSemesterDirty}
                  discardToken={discardToken}
                />
              </div>
              <div className={cn(section === "tasks" && "ux-fade")} hidden={section !== "tasks"}>
                <TaskSettings highlightedId={highlightedId ?? undefined} />
              </div>
              <div className={cn(section === "focus" && "ux-fade")} hidden={section !== "focus"}>
                <FocusSettings highlightedId={highlightedId ?? undefined} />
              </div>
              <div className={cn(section === "kiro" && "ux-fade")} hidden={section !== "kiro"}>
                <KiroAISettings reveal={reveal} />
              </div>
              <div className={cn(section === "kiro-agent" && "ux-fade")} hidden={section !== "kiro-agent"}>
                <KiroAgentSettings />
              </div>
              <div className={cn(section === "extensions" && "ux-fade")} hidden={section !== "extensions"}>
                <ExtensionsSettings />
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

/**
 * Grouped Settings List：搜索结果共用的「Section label + 一个 grouped surface + divider rows」。
 * 每项无独立 Card 边框，hover 只改背景。
 */
function GroupedList({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="text-xs font-bold text-sandrift px-1 mb-1.5">{label}</p>
      <div className="bg-[#F7F5F5] border border-line rounded-xl divide-y divide-line-soft">
        {children}
      </div>
    </div>
  );
}
