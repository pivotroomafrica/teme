"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Whole row is the tap target (min 44px), with the description linked for screen readers. */

export interface CheckboxProps extends Omit<ComponentProps<"input">, "type"> {
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
}

export function Checkbox({ label, description, error, className, id, ...props }: CheckboxProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const descId = `${inputId}-desc`;
  const errId = `${inputId}-err`;
  const describedBy =
    [description ? descId : null, error ? errId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      {/* The label's ::after covers the whole row, so the entire row is the tap target. */}
      <div className="relative flex min-h-11 items-start gap-3 py-2">
        <input
          id={inputId}
          type="checkbox"
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cn("mt-0.5 h-6 w-6 shrink-0 cursor-pointer accent-green-700", className)}
          {...props}
        />
        <div className="min-w-0">
          <label
            htmlFor={inputId}
            className="cursor-pointer font-medium after:absolute after:inset-0 after:content-['']"
          >
            {label}
          </label>
          {description ? (
            <p id={descId} className="mt-0.5 text-sm text-muted">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      <div aria-live="polite">
        {error ? (
          <p id={errId} className="ps-9 text-sm font-medium text-red-700">
            <span aria-hidden="true">⚠ </span>
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export interface RadioOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps {
  name: string;
  legend: ReactNode;
  options: RadioOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
}

export function RadioGroup({
  name,
  legend,
  options,
  value,
  defaultValue,
  onValueChange,
  hint,
  error,
  required,
  className,
}: RadioGroupProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy =
    [hint ? hintId : null, error ? errId : null].filter(Boolean).join(" ") || undefined;
  return (
    <fieldset
      className={cn("min-w-0", className)}
      aria-describedby={describedBy}
      aria-required={required}
    >
      <legend className="mb-1 font-medium">{legend}</legend>
      {hint ? (
        <p id={hintId} className="mb-1 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      <div role="radiogroup" className="flex flex-col">
        {options.map((option) => {
          const optionId = `${id}-${option.value}`;
          return (
            <label
              key={option.value}
              htmlFor={optionId}
              className={cn(
                "flex min-h-11 items-start gap-3 py-2",
                option.disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
              )}
            >
              <input
                id={optionId}
                type="radio"
                name={name}
                value={option.value}
                disabled={option.disabled}
                required={required}
                {...(value !== undefined
                  ? { checked: value === option.value }
                  : { defaultChecked: defaultValue === option.value })}
                onChange={() => onValueChange?.(option.value)}
                className="mt-0.5 h-6 w-6 shrink-0 accent-green-700"
              />
              <span className="min-w-0">
                <span className="font-medium">{option.label}</span>
                {option.description ? (
                  <span className="block text-sm text-muted">{option.description}</span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
      <div aria-live="polite">
        {error ? (
          <p id={errId} className="text-sm font-medium text-red-700">
            <span aria-hidden="true">⚠ </span>
            {error}
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** On/off setting that takes effect immediately (use a checkbox for choices submitted with a form). */
export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  id,
  className,
}: SwitchProps) {
  const generated = useId();
  const switchId = id ?? generated;
  const labelId = `${switchId}-label`;
  const descId = `${switchId}-desc`;
  return (
    <div className={cn("flex items-center justify-between gap-4 py-2", className)}>
      <div className="min-w-0">
        <span id={labelId} className="font-medium">
          {label}
        </span>
        {description ? (
          <span id={descId} className="block text-sm text-muted">
            {description}
          </span>
        ) : null}
      </div>
      {/* The button is the 44px tap target; the visible track inside it is smaller. */}
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description ? descId : undefined}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className="group inline-flex min-h-11 min-w-14 shrink-0 items-center justify-center disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          aria-hidden="true"
          className={cn(
            "relative inline-flex h-8 w-14 items-center rounded-full border-2 transition-colors",
            // Border, knob position and the tick all signal state, not only the fill colour.
            checked ? "border-green-700 bg-green-700" : "border-charcoal-500 bg-cream-200",
          )}
        >
          <span
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-bold text-green-700 shadow transition-transform",
              checked ? "translate-x-6 rtl:-translate-x-6" : "translate-x-0.5 rtl:-translate-x-0.5",
            )}
          >
            {checked ? "✓" : ""}
          </span>
        </span>
      </button>
    </div>
  );
}
