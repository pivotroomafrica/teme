import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/**
 * Data table. The scroll container is a focusable named region, so keyboard users can scroll wide tables and
 * screen readers announce what it contains. Columns never truncate text: long Amharic labels wrap.
 * A stacked card layout for phones is provided per screen by the feature steps.
 */
export function Table({
  label,
  className,
  children,
}: {
  /** Names the table for assistive technology (also its caption). */
  label: string;
  className?: string;
  children: ComponentProps<"table">["children"];
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn("overflow-x-auto rounded-card border border-border bg-surface", className)}
    >
      <table className="w-full min-w-[32rem] border-collapse text-start">
        <caption className="sr-only">{label}</caption>
        {children}
      </table>
    </div>
  );
}

export const THead = (props: ComponentProps<"thead">) => <thead {...props} />;
export const TBody = (props: ComponentProps<"tbody">) => <tbody {...props} />;

export const TR = ({ className, ...props }: ComponentProps<"tr">) => (
  <tr
    className={cn("border-t border-border first:border-t-0 hover:bg-cream-100", className)}
    {...props}
  />
);

export const TH = ({ className, scope = "col", ...props }: ComponentProps<"th">) => (
  <th
    scope={scope}
    className={cn(
      "bg-cream-200 px-4 py-3 text-start text-sm font-semibold text-charcoal-900",
      className,
    )}
    {...props}
  />
);

/** First cell of a row that names the row (e.g. the customer). */
export const RowHeader = ({ className, ...props }: ComponentProps<"th">) => (
  <th scope="row" className={cn("px-4 py-3 text-start font-medium", className)} {...props} />
);

export const TD = ({ className, ...props }: ComponentProps<"td">) => (
  <td className={cn("px-4 py-3 align-top", className)} {...props} />
);
