"use client";

import React from "react";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { APP_VERSION } from "@/lib/version";
import { FONT_REGISTRY } from "@/lib/typography/fonts";

/** 关于：版本来自 package.json（build-time 注入），不虚构官网/账户/云服务 */
export function AboutSettings() {
  return (
    <>
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
              在一个地方看课表、管任务、排学习计划。
            </p>
          </div>
          <div className="pt-2 border-t border-line-soft space-y-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="text-sandrift shrink-0">版本</span>
              <span className="font-mono font-semibold text-charcoal text-right break-words min-w-0">
                {APP_VERSION}
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
            测试期间建议定期备份重要数据。
          </p>
        </div>
      </SettingsSection>

      <SettingsSection title="字体与许可" description="ClassFlow 使用的界面字体及授权说明。">
        <div
          className="p-4 bg-[#F7F5F5] border border-line rounded-xl space-y-3 text-xs"
          data-testid="settings-font-licenses"
        >
          <p className="text-[11px] leading-relaxed text-satin-grey">
            界面字体可在「设置 → 通用 → 界面 → 界面字体」中切换，切换立即生效，无需重启。以下字体不影响代码、终端与数学公式的专业字体。
          </p>
          <div className="space-y-2.5">
            {(Object.values(FONT_REGISTRY) as Array<(typeof FONT_REGISTRY)[keyof typeof FONT_REGISTRY]>).map(
              (font) => (
                <details
                  key={font.id}
                  className="group rounded-lg border border-line-soft bg-white px-3 py-2.5 open:bg-alabaster/30"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="text-xs font-semibold text-charcoal">
                        {font.displayName}
                        {font.secondaryName ? ` / ${font.secondaryName}` : ""}
                      </span>
                      {font.localOnly && (
                        <span className="ml-1.5 text-[10px] font-medium text-sandrift">（需本机安装）</span>
                      )}
                      {font.id === "harmonyos-sans-sc" && (
                        <span className="ml-1.5 inline-flex items-center rounded bg-charcoal px-1 py-0.5 text-[10px] font-semibold leading-none text-white">
                          默认
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-[11px] text-sandrift group-open:rotate-90 transition-transform">
                      ›
                    </span>
                  </summary>
                  <div className="mt-2 space-y-1.5 border-t border-line-soft pt-2">
                    <p className="text-[11px] font-medium text-charcoal">
                      {font.license}
                      <span className="ml-1.5 font-normal text-sandrift">
                        {font.bundled ? "· 随应用打包" : "· 不打包（本地）"}
                      </span>
                    </p>
                    <p className="text-[11px] leading-relaxed text-satin-grey">{font.licenseDetail}</p>
                    <p className="text-[10px] leading-relaxed text-sandrift">字重：{font.weights}</p>
                  </div>
                </details>
              )
            )}
          </div>
          <p className="pt-2 border-t border-line-soft text-[10px] leading-relaxed text-sandrift">
            字体文件遵循各自许可；ClassFlow 不引入在线字体 CDN，启动时不联网下载字体。
            MiSans 需用户自行从小米官方渠道安装本机字体后方可生效。
          </p>
        </div>
      </SettingsSection>
    </>
  );
}
