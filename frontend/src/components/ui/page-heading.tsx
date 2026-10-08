import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Page title block: one h1, optional supporting text and page-level actions that wrap on small screens. */
export function PageHeading({
  title,
  description,
  actions,
  eyebrow,
  id = "page-title",
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Small text above the title, e.g. a merchant or branch name. */
  eyebrow?: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="max-w-prose min-w-0">
        {eyebrow ? <p className="mb-1 text-sm font-medium text-gold-text">{eyebrow}</p> : null}
        <h1 id={id} className="text-2xl font-bold text-green-900 sm:text-3xl">
          {title}
        </h1>
        {description ? <p className="mt-2 text-charcoal-700">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </header>
  );
}
