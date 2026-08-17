"use client";

import React from "react";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { APP_VERSION } from "@/lib/version";

/** 关于：版本来自 package.json（build-time 注入），不虚构官网/账户/云服务 */
export function AboutSettings() {
  return (
    <SettingsSection title="关于" description="ClassFlow 的版本与数据说明。">
      <div className="p-4 bg-[#F7F5F5] border border-line rounded-xl space-y-3 text-xs" data-testid="settings-about">
        <div>
          <p className="text-sm font-bold text-charcoal flex items-center gap-2">
            ClassFlow
            <span className="text-[10px] font-semibold text-white bg-warning px-1.5 py-0.5 rounded-md leading-none">
              测试版
            </span>
          </p>
          <p className="text-[11px] text-satin-grey mt-0.5">
            课程、任务与学习日程的一体化学习工作台（demo 预览版）。
          </p>
        </div>
        <div className="pt-2 border-t border-line-soft space-y-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-sandrift shrink-0">版本</span>
            <span className="font-mono font-semibold text-charcoal text-right break-words min-w-0">
              {APP_VERSION}（测试版）
            </span>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-sandrift shrink-0">数据</span>
            <span className="font-semibold text-charcoal text-right break-words min-w-0">
              你的 ClassFlow 数据主要保存在当前设备
            </span>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-sandrift shrink-0">课程附件</span>
            <span className="font-semibold text-charcoal text-right break-words min-w-0">
              附件保存在当前设备中
            </span>
          </div>
        </div>
        <p className="pt-2 border-t border-line-soft text-[10px] text-sandrift leading-relaxed">
          测试版数据可能随版本更新重置，重要数据请及时备份。
        </p>
      </div>
    </SettingsSection>
  );
}
