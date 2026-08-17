"use client";

import React from "react";
import { UISelect, SelectOption } from "@/components/ui/Select";
import { Button, ButtonVariant } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Switch } from "@/components/ui/Switch";

/**
 * Settings 共享控件 compatibility layer（UI Productization Task 2A）：
 * 保留现有 Settings API（SettingsButton / SettingsInput / SettingsToggle /
 * SettingsSegmentedControl / SettingsSelect / SettingsButtonVariant），
 * 内部全部委托全局 primitives（SettingsSelect 继续走 UISelect）。
 * 禁止在本文件复制第二套完整 Tailwind 控件样式。
 */

/** 标准下拉（优先级/状态/动效等）：继续由 UISelect 承载 */
export function SettingsSelect<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: SelectOption<T>[];
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <UISelect
      value={value}
      onChange={onChange}
      options={options}
      ariaLabel={ariaLabel}
      disabled={disabled}
      triggerClassName="min-w-[150px] w-full"
      menuClassName="min-w-[150px]"
    />
  );
}

/** 开关（role=switch；pill 形态保留）→ Switch */
export function SettingsToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return <Switch checked={checked} onChange={onChange} label={label} />;
}

/** 分段选择 → SegmentedControl */
export function SettingsSegmentedControl<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  ariaLabel?: string;
}) {
  return (
    <SegmentedControl
      value={value}
      onChange={onChange}
      ariaLabel={ariaLabel}
      options={options.map((o) => ({ value: o.value, label: o.label }))}
      className="max-w-full min-w-0 overflow-x-auto scrollbar-none"
    />
  );
}

/** 统一输入框 → Input（legacy prop 适配：error → invalid；ariaLabel → aria-label） */
export function SettingsInput({
  id,
  type = "text",
  value,
  onChange,
  placeholder,
  ariaLabel,
  required,
  error,
  mono,
  min,
  autoComplete,
  spellCheck,
  className,
}: {
  id?: string;
  type?: "text" | "url" | "number" | "time" | "password";
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  required?: boolean;
  /** 表单校验错误（danger 边框） */
  error?: boolean;
  mono?: boolean;
  min?: number;
  autoComplete?: string;
  spellCheck?: boolean;
  className?: string;
}) {
  return (
    <Input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      required={required}
      min={min}
      autoComplete={autoComplete}
      spellCheck={spellCheck}
      invalid={error}
      mono={mono}
      className={className}
    />
  );
}

export type SettingsButtonVariant = ButtonVariant;

/** 动作按钮 → Button（legacy prop 适配：testid → data-testid） */
export function SettingsButton({
  variant = "secondary",
  disabled,
  onClick,
  children,
  className,
  "aria-label": ariaLabel,
  testid,
}: {
  variant?: SettingsButtonVariant;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  "aria-label"?: string;
  testid?: string;
}) {
  return (
    <Button
      variant={variant}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      data-testid={testid}
      className={className}
    >
      {children}
    </Button>
  );
}
