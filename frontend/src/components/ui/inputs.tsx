"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { ChevronDownIcon } from "./icons";
import { controlClasses, useControlProps } from "./form-field";

/* Text size is 16px on purpose: smaller text makes iOS zoom the page when a field gets focus. */

export function Input({ className, ...props }: ComponentProps<"input">) {
  const control = useControlProps(props);
  return <input {...props} {...control} className={cn(controlClasses, className)} />;
}

export function Textarea({ className, rows = 4, ...props }: ComponentProps<"textarea">) {
  const control = useControlProps(props);
  return (
    <textarea
      rows={rows}
      {...props}
      {...control}
      className={cn(controlClasses, "resize-y", className)}
    />
  );
}

/** Native select: best keyboard, screen-reader and mobile-picker behaviour, styled to match. */
export function Select({ className, children, ...props }: ComponentProps<"select">) {
  const control = useControlProps(props);
  return (
    <div className="relative">
      <select
        {...props}
        {...control}
        className={cn(controlClasses, "appearance-none pe-10", className)}
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-charcoal-700" />
    </div>
  );
}

/**
 * Ethiopian mobile number field. The +251 country code is shown, so people can type the national form they
 * know (0911 234 567 or 911 234 567). Characters other than digits, spaces, dashes and a leading plus are
 * dropped as they are typed. The server normalises and validates the number; this only helps people type it.
 */
export function PhoneInput({
  className,
  onChange,
  ...props
}: Omit<ComponentProps<"input">, "type" | "inputMode">) {
  const control = useControlProps(props);
  return (
    <div className="flex items-stretch">
      <span className="inline-flex min-h-11 items-center rounded-s-control border border-e-0 border-charcoal-500 bg-cream-200 px-3 font-medium text-charcoal-700">
        +251
      </span>
      <input
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        maxLength={20}
        placeholder="911 234 567"
        {...props}
        {...control}
        onChange={(event) => {
          const cleaned = event.target.value.replace(/[^\d+\s-]/g, "");
          if (cleaned !== event.target.value) event.target.value = cleaned;
          onChange?.(event);
        }}
        className={cn(controlClasses, "rounded-s-none", className)}
      />
    </div>
  );
}
