"use client";

import { createContext, useContext, useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/client";

interface FieldState {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldState | null>(null);

/** Inputs placed inside a FormField pick up their id, description, error state and required flag from here. */
export const useFieldState = () => useContext(FieldContext);

export interface FormFieldProps {
  label: ReactNode;
  /** Help shown under the label, linked to the control with aria-describedby. */
  hint?: ReactNode;
  /** Validation message. Announced politely when it appears, and linked to the control. */
  error?: ReactNode;
  required?: boolean;
  /** Marks the field as optional in text (preferred over starring everything else). */
  optional?: boolean;
  /** Keeps the label for assistive technology but hides it visually (e.g. a search box). */
  hideLabel?: boolean;
  className?: string;
  children: ReactNode;
}

export function FormField({
  label,
  hint,
  error,
  required = false,
  optional = false,
  hideLabel = false,
  className,
  children,
}: FormFieldProps) {
  const t = useT();
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error), required }}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <label htmlFor={id} className={cn("font-medium text-foreground", hideLabel && "sr-only")}>
          {label}
          {required ? (
            <>
              <span aria-hidden="true" className="text-red-600">
                {" "}
                *
              </span>
              <span className="sr-only"> ({t("ui.required")})</span>
            </>
          ) : optional ? (
            <span className="font-normal text-muted"> ({t("ui.optional")})</span>
          ) : null}
        </label>
        {hint ? (
          <p id={hintId} className="text-sm text-muted">
            {hint}
          </p>
        ) : null}
        {children}
        {/* The live region is always present so a newly inserted message is announced. */}
        <div aria-live="polite">
          {error ? (
            <p id={errorId} className="flex items-start gap-1.5 text-sm font-medium text-red-700">
              <span aria-hidden="true">⚠</span>
              <span>{error}</span>
            </p>
          ) : null}
        </div>
      </div>
    </FieldContext.Provider>
  );
}

/** Merges a control's own props with the surrounding FormField state. */
export function useControlProps(own: {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling";
  required?: boolean;
}) {
  const field = useFieldState();
  return {
    id: own.id ?? field?.id,
    "aria-describedby":
      [own["aria-describedby"], field?.describedBy].filter(Boolean).join(" ") || undefined,
    "aria-invalid": own["aria-invalid"] ?? (field?.invalid ? true : undefined),
    required: own.required ?? field?.required,
  };
}

export const controlClasses =
  "block w-full min-h-11 rounded-control border border-charcoal-500 bg-surface px-3 py-2 text-base " +
  "text-foreground placeholder:text-charcoal-500 disabled:cursor-not-allowed disabled:bg-cream-200 " +
  "aria-[invalid=true]:border-2 aria-[invalid=true]:border-red-600";
