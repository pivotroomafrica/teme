import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "lg";

const base =
  "touch-target inline-flex items-center justify-center gap-2 rounded-control px-5 text-center font-semibold " +
  "no-underline transition-colors disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "border border-green-700 bg-surface text-green-800 hover:bg-green-50",
  ghost: "text-green-800 hover:bg-cream-200",
  // Red is reserved for destructive actions.
  danger: "bg-red-600 text-white hover:bg-red-700",
};

const sizes: Record<ButtonSize, string> = {
  md: "min-h-11 text-base",
  lg: "min-h-14 text-lg",
};

export const buttonClasses = (
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  extra?: string,
) => cn(base, variants[variant], sizes[size], extra);

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks further clicks (prevents accidental double submission). */
  loading?: boolean;
  /** Announced to screen readers while loading (e.g. "Saving…"). */
  loadingLabel?: string;
  fullWidth?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  loadingLabel,
  fullWidth = false,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, cn(fullWidth && "w-full", className))}
      {...props}
    >
      {loading ? <Spinner /> : null}
      <span>{loading && loadingLabel ? loadingLabel : children}</span>
    </button>
  );
}

export interface ButtonLinkProps extends Omit<ComponentProps<typeof Link>, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  children: ReactNode;
}

/** A navigation link that looks like a button (links go somewhere; buttons do something). */
export function ButtonLink({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      className={buttonClasses(variant, size, cn(fullWidth && "w-full", className))}
      {...props}
    />
  );
}
