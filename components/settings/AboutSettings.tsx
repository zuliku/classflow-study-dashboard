"use client";

import React from "react";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { APP_VERSION } from "@/lib/version";

/** 关于：版本来自 package.json（build-time 注入），不虚构官网/账户/云服务 */
export function AboutSettings() {
  return (
    <SettingsSection title="关于" description="ClassFlow 的版本与数据模式。">
      <div className="p-4 bg-[#F7F5F5] border border-line rounded-xl space-y-3 text-xs" data-testid="settings-about">
        <div>
          <p className="text-sm font-bold text-charcoal">ClassFlow</p>
          <p className="text-[11px] text-satin-grey mt-0.5">
            课程、任务与学习日程的本地学习工作台。
          </p>
        </div>
        <div className="pt-2 border-t border-line-soft space-y-1.5">
          <div className="flex justify-between">
            <span className="text-sandrift">版本</span>
            <span className="font-mono font-semibold text-charcoal">{APP_VERSION}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sandrift">数据模式</span>
            <span className="font-semibold text-charcoal">本地存储</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sandrift">附件存储</span>
            <span className="font-semibold text-charcoal">IndexedDB</span>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
